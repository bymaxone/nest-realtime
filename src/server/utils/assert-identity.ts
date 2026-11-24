/**
 * @fileoverview Tenant resolution and rejection of blank identity traits.
 * @layer utils
 */
import { types } from 'node:util'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { assertBuiltinsIntact } from './builtin-baseline'
import { readHostKey } from './read-host-key'
import { realtimeError } from './realtime-error'
import { absorbed, shielded } from './within-deadline'

/**
 * True when a trait carries no identity.
 *
 * The `typeof` check is not defensive padding. This guard exists to police what a
 * consumer's `authenticate()` returns **at runtime**, where the declared type is a
 * promise rather than a fact: a `tid` claim that is `null` in the JWT, or a numeric
 * id straight off a database row, satisfies `tsc` at the call site and arrives here
 * as a non-string. Calling `.trim()` on it would raise a `TypeError` naming `trim`
 * instead of the contract that was broken, and would refuse every connection.
 */
function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

/**
 * Resolve the tenant a connection routes on, and normalize a nullish result.
 *
 * Both transports must resolve the routing tenant through this one function. Two
 * copies of the rule can disagree, and a connection routed on one tenant by SSE and
 * another by WebSocket is a delivery to the wrong audience.
 *
 * `null` normalizes to `undefined` rather than passing through. `ConnectionRegistry`
 * guards on `!== undefined`, so a `null` tenant would otherwise be indexed under
 * `null` and compose the room `tenant:null` — the same shared-bucket defect as the
 * empty string, in a value a JWT claim produces routinely.
 *
 * @param options - The module options, read for an optional `tenantResolver`.
 * @param auth - The authentication result the consumer's authenticator returned.
 * @returns A copy of the result with `tenantId` resolved, or absent when there is none.
 */
export function resolveAuthTenant(
  options: Pick<BymaxRealtimeModuleOptions, 'tenantResolver'>,
  auth: AuthenticationResult,
): AuthenticationResult {
  assertBuiltinsIntact()
  // The record the library keeps is built here, by name, before the resolver runs: each field is read once, the way JS
  // reads it, so a field that a class default, `Object.create` or an accessor on the prototype supplies counts, and
  // the value that decides the routing room is the one that was tested. The resolver is given the authenticator's own
  // result, not a copy of it, so everything on it works as it does for the authenticator's code, and what it writes to
  // that object cannot reach the record, which is another object. The nested objects (`roles`, `rooms`, `metadata`) are
  // shared. What the resolver returns is what routes, `undefined` and `null` meaning no opinion. The resolver is
  // synchronous: a promise is not a tenant and is refused as one, and its own rejection is absorbed so that it does
  // not reach the process as an unhandled one.
  const own = readHostKey(auth, 'tenantId')
  const kept = keepByName(auth)
  const resolved: unknown = options.tenantResolver?.(auth) ?? own
  absorbRejection(resolved)
  if (resolved === undefined || resolved === null) return kept
  return { __proto__: null, ...kept, tenantId: resolved as string } as AuthenticationResult
}

/**
 * Handle the rejection of a promise a synchronous resolver returned, so it cannot end the process. The intrinsic
 * `then` is tried first: it accepts only a real promise, of any realm, so a promise from another realm, a
 * subclass that overrides `catch` and a promise with a `then` of its own are handled, and any other value is
 * refused before a property of it is read. A proxy over a promise is not one by brand, so a value that is an
 * `instanceof Promise` is then given its own `catch`; a thenable that is not a promise is never asked for its
 * `then`. A promise whose species cannot be read is given the intrinsic constructor and awaited; one whose `constructor`
 * cannot be read or replaced cannot be given a handler by any path.
 */
function absorbRejection(value: unknown): void {
  try {
    Promise.prototype.then.call(value, undefined, () => undefined)
  } catch {
    // A promise whose species cannot be read: `then` reads the species and fails before it attaches anything, and an await
    // of it goes through `then` too unless its constructor is the intrinsic one. This promise is being discarded, so it is
    // given that constructor, and the await then attaches its handlers directly.
    if (types.isPromise(value)) {
      void absorbed(shielded(value))
      return
    }
    // Not a promise by brand: its own `catch` is the last way to a handler.
    try {
      if (value instanceof Promise) value.catch(() => undefined)
    } catch {
      // The value's own `catch` or its species cannot be used: there is no handler to attach on this path.
    }
  }
}

/** The fields of a result the library keeps, besides the tenant: the ones it names, read once and left out when absent. */
function keepByName(auth: AuthenticationResult): AuthenticationResult {
  const kept = { __proto__: null } as unknown as AuthenticationResult
  for (const key of ['userId', 'roles', 'rooms', 'metadata'] as const) {
    const value: unknown = readHostKey(auth, key)
    if (value === undefined) continue
    // No prototype on the descriptor: `defineProperty` reads its fields with inheritance, and a `get` or `set` planted on
    // the root prototype would make this one an accessor, or throw.
    Object.defineProperty(kept, key, {
      __proto__: null,
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    } as PropertyDescriptor)
  }
  return kept
}

/**
 * Reject an authentication result whose identity traits are present but blank.
 *
 * `userId` and `tenantId` index the registry and compose the `user:` and `tenant:`
 * rooms, so a blank one is not a missing value — it is a shared bucket. Every
 * connection whose authenticator returned `''` lands under the same key and joins
 * the same room, and a later emit to that key reaches all of them. On a long-lived
 * subscription that is not one wrong response but a stream that keeps delivering
 * for the life of the connection.
 *
 * An absent `tenantId` stays valid and means exactly what it says: this connection
 * belongs to no tenant, so it is indexed under none and joins no tenant room. The
 * distinction drawn is between *absent* and *empty*, and only the second is refused.
 *
 * Whitespace counts as blank. `' '` composes `user: ` and indexes under `' '`, which
 * is the same defect wearing a different character.
 *
 * @param auth - The resolved authentication result, after `resolveAuthTenant`.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when a trait is present but blank.
 */
export function assertIdentityIsNotBlank(auth: AuthenticationResult): void {
  assertBuiltinsIntact()
  if (isBlank(auth.userId)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.AUTH_FAILED,
      `the authenticator returned a userId that is not a ` +
        `non-empty string. A blank identity indexes every such connection under one key and ` +
        `joins them to the same room; return a real userId, or reject the connection by ` +
        `returning null.`,
    )
  }
  if (auth.tenantId !== undefined && isBlank(auth.tenantId)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.AUTH_FAILED,
      `the authenticator returned a tenantId that is ` +
        `present but not a non-empty string. Omit it, or return undefined or null, for a ` +
        `connection that belongs to no tenant — that is indexed under none and joins no tenant ` +
        `room, which an empty string is not.`,
    )
  }
}
