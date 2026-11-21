/**
 * @fileoverview Start-up checks of the shape of the option groups and of the pluggable pieces.
 * @layer composition
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { copyRegExp } from '../utils/copy-regexp'
import { describeReceived } from '../utils/describe-received'
import { isPlainObject, readPlainObject } from '../utils/is-plain-object'
import { refuseObject } from '../utils/refuse-object'
import { realtimeError } from '../utils/realtime-error'
import { METHODS_KINDS, ORIGIN_KINDS } from './drop-unset'

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
    for (const fn of functions)
      assertFunction(`${name}.${fn}`, (piece as Record<string, unknown>)[fn])
  }
}

function validateHooks(options: BymaxRealtimeModuleOptions): void {
  const hooks: unknown = options.hooks
  assertObject('hooks', hooks)
  if (hooks === undefined) return
  for (const hook of HOOK_NAMES)
    assertOptionalFunction(`hooks.${hook}`, (hooks as Record<string, unknown>)[hook])
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
  assertCors(options.websocket?.cors)
}

/** Whether an origin entry is one Socket.IO matches by itself: a string, or a RegExp of this realm. */
function isOriginEntry(entry: unknown): boolean {
  return typeof entry === 'string' || copyRegExp(entry) !== undefined
}

/**
 * Refuse an `origin` of a kind Socket.IO does not match by itself. It reads anything else as "allow", so an
 * object, a number, a symbol, a list with such an entry and an object that only has the prototype of a RegExp would
 * each be answered with the origin that asked. `null` and `undefined` are refused here too: they are not an
 * allowlist. A RegExp is recognised by its brand, not by its prototype.
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
  if (Array.isArray(origin)) {
    for (let index = 0; index < origin.length; index += 1) {
      if (!isOriginEntry(origin[index])) refuse('websocket.cors.origin', ORIGIN_KINDS, origin)
    }
    return
  }
  refuse('websocket.cors.origin', ORIGIN_KINDS, origin)
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
  assertMethods(block.methods)
  assertBoolean('websocket.cors.credentials', block.credentials)
}

/** Refuse `methods` that is neither a string nor a list of strings; an unset one is left to Socket.IO. */
function assertMethods(methods: unknown): void {
  if (methods === undefined || typeof methods === 'string') return
  if (Array.isArray(methods)) {
    for (let index = 0; index < methods.length; index += 1) {
      if (typeof methods[index] !== 'string')
        refuse('websocket.cors.methods', METHODS_KINDS, methods)
    }
    return
  }
  refuse('websocket.cors.methods', METHODS_KINDS, methods)
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
  if (!Array.isArray(value)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `extraProviders must be an array of providers, received ${describeReceived(value)}`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  value.forEach((entry: unknown, index) => {
    if (typeof entry === 'function') return
    const read = readPlainObject(entry)
    if (read.plain && 'provide' in (entry as object)) return
    const received = read.threw
      ? UNREADABLE
      : read.plain && !Array.isArray(entry)
        ? 'an object with no provide'
        : describeReceived(entry)
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `extraProviders[${index}] must be a provider (a class or an object with provide), received ${received}`,
      read.threw
        ? { who: 'BymaxRealtimeModule', cause: read.error }
        : { who: 'BymaxRealtimeModule' },
    )
  })
}
