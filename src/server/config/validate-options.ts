/**
 * @fileoverview Bootstrap validation of module options with typed error codes.
 * @layer composition
 */
import { Logger } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { HEARTBEAT_MAX_MS, HEARTBEAT_MIN_MS } from '../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { realtimeError } from '../utils/realtime-error'

// Format-level validation only: 'websocket' and 'both' are accepted config values,
// but the module rejects them at bootstrap until those transports are implemented.
const VALID_TRANSPORTS = new Set<string>(['sse', 'websocket', 'both'])

/**
 * Validate module options at bootstrap, throwing actionable, code-prefixed errors.
 *
 * Auth is mandatory: the library never ships a default authenticator (auth
 * inversion), so a missing authenticator would otherwise expose every connection
 * as authenticated. The check is therefore a hard failure, not a warning.
 */
export function validateOptions(options: BymaxRealtimeModuleOptions): void {
  if (!options.transport || !VALID_TRANSPORTS.has(options.transport)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.transport must be one of 'sse' | 'websocket' | 'both' (got: ${String(options.transport)})`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  if (!options.authenticator) {
    throw realtimeError(
      REALTIME_ERROR_CODES.NO_AUTHENTICATOR,
      `options.authenticator is required — the library never ships a default authenticator`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  if (typeof options.authenticator.authenticate !== 'function') {
    throw realtimeError(
      REALTIME_ERROR_CODES.NO_AUTHENTICATOR,
      `options.authenticator must implement IConnectionAuthenticator.authenticate(context)`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  validateHookTimeout(options)
  validateOnConnectFailure(options)
  validateSseOptions(options)
  validateReauthPolicy(options)
}

/**
 * The longest a Node timer can run: a delay above this is treated as 1 ms, so an option that feeds
 * a timer has to stop here or it silently means the opposite of what it says.
 */
const MAX_TIMER_MS = 2_147_483_647

/**
 * Ceilings for the options whose size is memory or descriptors. A bound this large is one in name only
 * (`Number.isInteger(1e300)` is true, and a comparison against it never fires), so each has a most.
 */
const MAX_PER_USER_CONNECTIONS = 100_000 // beyond the ports one client address has and the descriptors an instance has
const MAX_REPLAY_EVENTS = 100_000 // events held per user stream: memory is this times the size of a frame
const MAX_HTTP_BUFFER_BYTES = 100 * 1024 * 1024 // bytes one message may buffer while it assembles; Socket.IO defaults to 1,000,000

/**
 * Refuse `value` unless it is a safe integer in `[least, most]`; with no `most` the bound is the largest
 * safe integer, so `1e300` and `2 ** 53` are refused as well.
 */
function assertInteger(path: string, value: unknown, least: number, most?: number): void {
  if (value === undefined) return
  const valid =
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= least &&
    (most === undefined || value <= most)
  if (valid) return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `options.${path} must be an integer >= ${least}${most === undefined ? '' : ` and <= ${most}`}, got ${String(value)}${most === undefined && Number.isInteger(value) && !Number.isSafeInteger(value) ? ` (the most is ${Number.MAX_SAFE_INTEGER})` : ''}`,
    { who: 'BymaxRealtimeModule' },
  )
}

/** A value other than the two names is a typo that would silently mean `'ignore'`, so it is refused. */
function validateOnConnectFailure(options: BymaxRealtimeModuleOptions): void {
  const value: unknown = options.onConnectFailure
  if (value === undefined || value === 'ignore' || value === 'close') return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `options.onConnectFailure must be 'ignore' or 'close', got ${String(value)}`,
    { who: 'BymaxRealtimeModule' },
  )
}

function validateHookTimeout(options: BymaxRealtimeModuleOptions): void {
  assertInteger('hookTimeoutMs', options.hookTimeoutMs, 1, MAX_TIMER_MS)
  assertInteger('authenticateTimeoutMs', options.authenticateTimeoutMs, 1, MAX_TIMER_MS)
  assertInteger('maxPendingHandshakes', options.maxPendingHandshakes, 1)
  assertInteger('maxConnections', options.maxConnections, 1)
  // Bounds written as a comparison (`length > max`, `size > limit`) are switched off by NaN, so each is an integer.
  assertInteger(
    'websocket.maxConnectionsPerUser',
    options.websocket?.maxConnectionsPerUser,
    0,
    MAX_PER_USER_CONNECTIONS,
  )
  assertInteger(
    'websocket.maxHttpBufferSize',
    options.websocket?.maxHttpBufferSize,
    1,
    MAX_HTTP_BUFFER_BYTES,
  )
  // Socket.IO runs these two as timers.
  assertInteger('websocket.pingIntervalMs', options.websocket?.pingIntervalMs, 1, MAX_TIMER_MS)
  assertInteger('websocket.pingTimeoutMs', options.websocket?.pingTimeoutMs, 1, MAX_TIMER_MS)
}

/** The integer options of the re-authentication policy, the least each may be and, for a timer, the most. */
const REAUTH_INTEGER_OPTIONS = [
  ['intervalSeconds', 1, Math.floor(MAX_TIMER_MS / 1000)],
  ['cacheTtlMs', 0, undefined],
  ['revalidateTimeoutMs', 1, MAX_TIMER_MS],
  ['concurrency', 1, undefined],
] as const

function validateReauthPolicy(options: BymaxRealtimeModuleOptions): void {
  const policy = options.reauthenticationPolicy
  for (const [name, least, most] of REAUTH_INTEGER_OPTIONS) {
    assertInteger(`reauthenticationPolicy.${name}`, policy?.[name], least, most)
  }
  const onFailure: unknown = policy?.onFailure
  if (onFailure !== undefined && onFailure !== 'disconnect' && onFailure !== 'event') {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.reauthenticationPolicy.onFailure must be 'disconnect' or 'event', got ${String(onFailure)}`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  if (
    policy?.cacheTtlMs !== undefined &&
    policy.intervalSeconds !== undefined &&
    policy.cacheTtlMs > policy.intervalSeconds * 1000
  ) {
    Logger.warn(
      `[BymaxRealtimeModule] reauthenticationPolicy.cacheTtlMs (${policy.cacheTtlMs} ms) exceeds intervalSeconds*1000 (${policy.intervalSeconds * 1000} ms): the positive reauth cache outlives the interval, so revalidate is skipped on ticks within the cache window — reauthentication is effectively weakened`,
      'BymaxRealtimeModule',
    )
  }
}

function validateSseOptions(options: BymaxRealtimeModuleOptions): void {
  const sse = options.sse
  const heartbeatMs: unknown = sse?.heartbeatMs
  if (
    heartbeatMs !== undefined &&
    !(
      typeof heartbeatMs === 'number' &&
      heartbeatMs >= HEARTBEAT_MIN_MS &&
      heartbeatMs <= HEARTBEAT_MAX_MS
    )
  ) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.sse.heartbeatMs must be between ${HEARTBEAT_MIN_MS} and ${HEARTBEAT_MAX_MS} ms (got ${String(heartbeatMs)})`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  assertInteger('sse.replayBufferSize', sse?.replayBufferSize, 0, MAX_REPLAY_EVENTS)
  assertInteger('sse.replayTtlMs', sse?.replayTtlMs, 1, MAX_TIMER_MS)
  assertInteger('sse.replayMaxIdleUsers', sse?.replayMaxIdleUsers, 1)
  for (const name of ['maxQueuedBytes', 'maxQueuedEvents', 'stallHeartbeats'] as const) {
    const value: unknown = sse?.[name]
    if (
      value !== undefined &&
      !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    ) {
      throw realtimeError(
        REALTIME_ERROR_CODES.INVALID_OPTIONS,
        `options.sse.${name} must be an integer >= 0 (0 switches the bound off), got ${String(value)}`,
        { who: 'BymaxRealtimeModule' },
      )
    }
  }
  assertInteger(
    'sse.maxConnectionsPerUser',
    sse?.maxConnectionsPerUser,
    0,
    MAX_PER_USER_CONNECTIONS,
  )
}
