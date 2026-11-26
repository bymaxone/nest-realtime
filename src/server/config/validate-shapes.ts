/**
 * @fileoverview Start-up checks of the shape of the option groups and of the pluggable pieces.
 * @layer composition
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { isArray, isInteger } from '../utils/captured-builtins'
import { copyRegExp } from '../utils/copy-regexp'
import { describeReceived } from '../utils/describe-received'
import { isPlainObject, readPlainObject } from '../utils/is-plain-object'
import { readHostKey } from '../utils/read-host-key'
import { refuseObject } from '../utils/refuse-object'
import { realtimeError } from '../utils/realtime-error'
import { isCanonicalOrigin } from '../utils/canonical-origin'
import { ALLOWED_ORIGINS_KINDS, METHODS_KINDS, ORIGIN_KINDS } from './drop-unset'

/** The functions each pluggable piece must have when it is set; what it lacks would fail at its first use. */
const REQUIRED_FUNCTIONS = {
  pubsub: ['publish', 'subscribe'],
  offlineQueue: ['append', 'retrieveSince', 'acknowledge'],
  presence: ['setOnline', 'setOffline', 'isOnline', 'listOnlineByTenant', 'countOnline'],
} as const

/** The lifecycle hooks; each is optional and, when set, a function. */
const HOOK_NAMES = [
  'onConnect',
  'onDisconnect',
  'onError',
  'onReauthenticationFailed',
  'onDeliveryFailure',
] as const

/** The option groups, each an object holding the options of one concern. */
const GROUP_NAMES = ['sse', 'websocket', 'reauthenticationPolicy'] as const

/** What a refusal says of a value whose type could not be read, so the text does not depend on a second read of it. */
const UNREADABLE = 'an object that could not be read'

/** What a refusal says of a value: its kind, and for the cors options never the number itself. */
function shown(path: string, received: unknown): string {
  return path.startsWith('websocket.cors') && typeof received === 'number'
    ? 'a number'
    : describeReceived(received)
}

function refuse(
  path: string,
  expected: string,
  received: unknown,
  cause?: { readonly error: unknown },
): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `options.${path} must be ${expected}, received ${cause === undefined ? shown(path, received) : UNREADABLE}`,
    cause === undefined
      ? { who: 'BymaxRealtimeModule' }
      : { who: 'BymaxRealtimeModule', cause: cause.error },
  )
}

/** Refuse a set option that is not an object; an unset one is left to its default. */
function assertObject(path: string, value: unknown): void {
  if (value === undefined) return
  const read = readPlainObject(value)
  if (!read.plain) refuse(path, 'an object', value, read.threw ? { error: read.error } : undefined)
}

function assertFunction(path: string, value: unknown): void {
  if (typeof value !== 'function') refuse(path, 'a function', value)
}

/** Refuse a set value that is not a function; an unset one is skipped. */
function assertOptionalFunction(path: string, value: unknown): void {
  if (value !== undefined && value !== null) assertFunction(path, value)
}

function assertBoolean(path: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') refuse(path, 'a boolean', value)
}

/**
 * Refuse an endpoint that is not a non-blank string, or that holds whitespace: a space is encoded in a
 * URL and the route is not, so no request reaches it. An unset one takes its default.
 *
 * @param path - The option, without its `options.` prefix.
 * @param value - What the option held.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS`.
 */
export function assertSseEndpoint(path: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || value.trim().length === 0) {
    refuse(path, 'a non-blank string', value)
  }
  if (/\s/.test(value as string)) refuse(path, 'a string without whitespace', value)
}

/**
 * Refuse an options argument that is not an object, before any of its keys is read.
 *
 * @param value - The options argument, or what a factory answered.
 * @param who - The module the refusal is attributed to.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS`.
 */
export function assertOptionsObject(value: unknown, who = 'BymaxRealtimeModule'): void {
  const read = readPlainObject(value)
  if (!read.plain)
    refuseObject(who, 'options', value, read.threw ? { error: read.error } : undefined)
}

function validatePieces(options: BymaxRealtimeModuleOptions): void {
  for (const [name, functions] of Object.entries(REQUIRED_FUNCTIONS)) {
    const piece: unknown = options[name as keyof typeof REQUIRED_FUNCTIONS]
    assertObject(name, piece)
    if (piece === undefined) continue
    for (const fn of functions) assertFunction(`${name}.${fn}`, readHostKey(piece as object, fn))
  }
}

function validateHooks(options: BymaxRealtimeModuleOptions): void {
  const hooks: unknown = options.hooks
  assertObject('hooks', hooks)
  if (hooks === undefined) return
  for (const hook of HOOK_NAMES)
    assertOptionalFunction(`hooks.${hook}`, readHostKey(hooks as object, hook))
}

/**
 * Refuse an option whose shape would fail later or do the opposite of what it says: a group that is not an
 * object, a pluggable piece without its required functions, a hook or the tenant resolver that is not a
 * function, a flag that is not a boolean (a truthy "no" reads as true) and an endpoint that is not a non-blank string. A leading slash is not required: `@Sse()` reads
 * `'events'` and `'/events'` as the same route.
 * Each refusal is `REALTIME_INVALID_OPTIONS`, names the option and describes what it received by type (a finite number is printed), and
 * echoes nothing else.
 *
 * @param options - The options with their unset keys already dropped.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS` for the first option of the wrong shape.
 */
export function validateShapes(options: BymaxRealtimeModuleOptions): void {
  for (const group of GROUP_NAMES) assertObject(group, options[group])
  validatePieces(options)
  validateHooks(options)
  assertOptionalFunction('tenantResolver', options.tenantResolver)
  assertBoolean('sse.emitConnectionEvent', options.sse?.emitConnectionEvent)
  assertBoolean('websocket.emitConnectionEvent', options.websocket?.emitConnectionEvent)
  assertSseEndpoint('sse.endpoint', options.sse?.endpoint)
  assertBoolean('websocket.websocketOnly', options.websocket?.websocketOnly)
  assertCors(options.websocket?.cors)
  assertAllowedOriginsServed(options)
  assertAllowedOrigins(options.websocket)
}

/** Refuse an `allowedOrigins` on a registration that serves SSE only, where nothing would apply it. */
function assertAllowedOriginsServed(options: BymaxRealtimeModuleOptions): void {
  if (options.transport !== 'sse') return
  if (options.websocket === undefined || !('allowedOrigins' in options.websocket)) return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    "options.websocket.allowedOrigins has no effect with transport 'sse': it governs the WebSocket handshake only, and the SSE endpoint's origin policy is app.enableCors",
    { who: 'BymaxRealtimeModule' },
  )
}

/**
 * Refuse an `allowedOrigins` that is not a non-empty list of origins in the spelling a browser sends, and one that is
 * set beside a `cors.origin` other than `false`: two lists for one decision, of which the stricter would silently
 * win. An absent one is left alone; one the host set to `undefined` or `null` is refused.
 */
function assertAllowedOrigins(websocket: BymaxRealtimeModuleOptions['websocket']): void {
  const list: unknown = websocket?.allowedOrigins
  if (websocket === undefined || !('allowedOrigins' in websocket)) return
  if (!isArray(list) || list.length === 0) {
    refuse('websocket.allowedOrigins', ALLOWED_ORIGINS_KINDS, list)
  }
  for (let index = 0; index < list.length; index += 1) {
    if (!isCanonicalOrigin(list[index])) {
      throw realtimeError(
        REALTIME_ERROR_CODES.INVALID_OPTIONS,
        `options.websocket.allowedOrigins[${index}] must be an origin as a browser sends it: a lowercase scheme, "://", a host (lowercase for http and https) and a port only when it is not the default of http or https; not ws, wss or ftp, and with no path, trailing slash, userinfo, wildcard or "null"`,
        { who: 'BymaxRealtimeModule' },
      )
    }
  }
  const cors = websocket?.cors as { origin?: unknown } | undefined
  if (cors !== undefined && 'origin' in cors && cors.origin !== false) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      'options.websocket.allowedOrigins cannot be set together with options.websocket.cors.origin: set one list, or set cors.origin to false',
      { who: 'BymaxRealtimeModule' },
    )
  }
}

/** Whether an origin entry is one Socket.IO matches by itself: a string, or a RegExp of this realm. */
function isOriginEntry(entry: unknown): boolean {
  return typeof entry === 'string' || copyRegExp(entry) !== undefined
}

/**
 * Refuse an `origin` of a kind Socket.IO does not match by itself. It reads anything else as "allow", so an
 * object, a number, a symbol, a list with such an entry and an object that only has the prototype of a RegExp would
 * each be answered with the origin that asked. `null` and `undefined` are refused here too: they are not an
 * allowlist. Only a plain RegExp is accepted, as `copyRegExp` decides; a value that is or looks like one but
 * cannot be copied gets the way out, a function origin.
 */
function assertOrigin(origin: unknown): void {
  const kind = typeof origin
  if (
    kind === 'string' ||
    kind === 'function' ||
    kind === 'boolean' ||
    copyRegExp(origin) !== undefined
  ) {
    return
  }
  if (isArray(origin)) {
    for (let index = 0; index < origin.length; index += 1) {
      const entry: unknown = origin[index]
      if (isOriginEntry(entry)) continue
      refuseCustomRegExp(entry)
      refuse('websocket.cors.origin', ORIGIN_KINDS, origin)
    }
    return
  }
  refuseCustomRegExp(origin)
  refuse('websocket.cors.origin', ORIGIN_KINDS, origin)
}

/**
 * Whether a value is a RegExp or looks like one: it has the prototype of one, or a `test` function, which every
 * RegExp has, of any realm. A read that throws, as the read of `test` on `null` or on a hostile proxy does, is not.
 */
function looksLikeRegExp(value: unknown): boolean {
  try {
    return value instanceof RegExp || typeof (value as { test?: unknown }).test === 'function'
  } catch {
    return false
  }
}

/** Refuse a RegExp that cannot be copied faithfully, or one that looks like it, and say how to get custom matching. */
function refuseCustomRegExp(value: unknown): void {
  if (!looksLikeRegExp(value)) return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `options.websocket.cors.origin must be ${ORIGIN_KINDS}, received a RegExp, or an object that looks like one, that cannot be copied faithfully: a subclass, one with a property of its own, one from another realm, one with the y flag, one whose source is longer than 1000 characters, a proxy over one or an object that only has its prototype: use a function origin for custom matching`,
    { who: 'BymaxRealtimeModule' },
  )
}

/**
 * Refuse a `cors` that is present and not an object, an `origin` of a kind Socket.IO reads as "any origin", and a
 * `credentials` that is not a boolean. An absent or `null` block is left to Socket.IO's own default, which sends no
 * CORS header; a block with no `origin` key answers `*`, as documented.
 */
function assertCors(cors: unknown): void {
  if (cors === undefined || cors === null) return
  if (!isPlainObject(cors)) refuse('websocket.cors', 'an object', cors)
  const block = cors as Record<string, unknown>
  if ('origin' in block) assertOrigin(block.origin)
  assertStringList('methods', block.methods)
  assertStringList('allowedHeaders', block.allowedHeaders)
  assertStringList('exposedHeaders', block.exposedHeaders)
  assertBoolean('websocket.cors.credentials', block.credentials)
  assertMaxAge(block.maxAge)
}

/** Refuse a `maxAge` that is not a whole number of seconds, zero or more; an unset one is left to Socket.IO. */
function assertMaxAge(value: unknown): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !isInteger(value) || value < 0) {
    refuse('websocket.cors.maxAge', 'a non-negative integer', value)
  }
}

/** Refuse `methods`, `allowedHeaders` or `exposedHeaders` that is neither a string nor a list of strings; an unset one is left to Socket.IO. */
function assertStringList(key: string, value: unknown): void {
  if (value === undefined || typeof value === 'string') return
  if (isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] !== 'string') refuse(`websocket.cors.${key}`, METHODS_KINDS, value)
    }
    return
  }
  refuse(`websocket.cors.${key}`, METHODS_KINDS, value)
}

/**
 * Refuse `extraProviders` that is not an array of providers: a class, or an object with `provide`. Nest would
 * spread a value that is not iterable and fail with a raw `TypeError`, and would accept an entry that is not a
 * provider until the container reached it.
 *
 * @param value - The `extraProviders` of a `forRootAsync` registration.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS`.
 */
export function assertExtraProviders(value: unknown): void {
  if (value === undefined || value === null) return
  if (!isArray(value)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `extraProviders must be an array of providers, received ${describeReceived(value)}`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  const length: number = value.length
  for (let index = 0; index < length; index += 1) {
    const entry: unknown = value[index]
    if (typeof entry === 'function') continue
    const read = readPlainObject(entry)
    if (read.plain && 'provide' in (entry as object)) continue
    const received = read.threw
      ? UNREADABLE
      : read.plain && !isArray(entry)
        ? 'an object with no provide'
        : describeReceived(entry)
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `extraProviders[${index}] must be a provider (a class or an object with provide), received ${received}`,
      read.threw
        ? { who: 'BymaxRealtimeModule', cause: read.error }
        : { who: 'BymaxRealtimeModule' },
    )
  }
}
