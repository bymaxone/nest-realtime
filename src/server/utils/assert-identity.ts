/**
 * @fileoverview Tenant resolution and rejection of blank identity traits.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { realtimeError } from './realtime-error'

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
 * @returns The same result with `tenantId` resolved, or absent when there is none.
 */
export function resolveAuthTenant(
  options: Pick<BymaxRealtimeModuleOptions, 'tenantResolver'>,
  auth: AuthenticationResult,
): AuthenticationResult {
  // The record the library keeps is built here, by name, before the resolver runs: each field is read once, the way JS
  // reads it, so a field that a class default, `Object.create` or an accessor on the prototype supplies counts, and
  // the value that decides the routing room is the one that was tested. The resolver is given the authenticator's own
  // result, not a copy of it, so everything on it works as it does for the authenticator's code, and what it writes to
  // that object cannot reach the record, which is another object. The nested objects (`roles`, `rooms`, `metadata`) are
  // shared. What the resolver returns is what routes, `undefined` and `null` meaning no opinion.
  const own = auth.tenantId
  const kept = keepByName(auth)
  const resolved = options.tenantResolver?.(auth) ?? own
  if (resolved === undefined || resolved === null) return kept
  return { ...kept, tenantId: resolved }
}

/** The fields of a result the library keeps, besides the tenant: the ones it names, read once and left out when absent. */
function keepByName(auth: AuthenticationResult): AuthenticationResult {
  const kept = {} as AuthenticationResult
  for (const key of ['userId', 'roles', 'rooms', 'metadata'] as const) {
    const value: unknown = auth[key]
    if (value === undefined) continue
    Object.defineProperty(kept, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
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
