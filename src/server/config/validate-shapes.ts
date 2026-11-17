/**
 * @fileoverview Start-up checks of the shape of the option groups and of the pluggable pieces.
 * @layer composition
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { describeReceived } from '../utils/describe-received'
import { realtimeError } from '../utils/realtime-error'

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

function refuse(path: string, expected: string, received: unknown): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `options.${path} must be ${expected}, received ${describeReceived(received)}`,
    { who: 'BymaxRealtimeModule' },
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Refuse a set option that is not an object; an unset one is left to its default. */
function assertObject(path: string, value: unknown): void {
  if (value !== undefined && !isObject(value)) refuse(path, 'an object', value)
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

function assertEndpoint(path: string, value: unknown): void {
  if (value !== undefined && !(typeof value === 'string' && value.trim().length > 0)) {
    refuse(path, 'a non-blank string', value)
  }
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
  assertEndpoint('sse.endpoint', options.sse?.endpoint)
}
