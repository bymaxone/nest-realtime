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
  validateSseOptions(options)
  validateReauthPolicy(options)
}

/** The integer options of the re-authentication policy and the least each may be. */
const REAUTH_INTEGER_OPTIONS = [
  ['intervalSeconds', 1],
  ['cacheTtlMs', 0],
  ['revalidateTimeoutMs', 1],
  ['concurrency', 1],
] as const

function validateReauthPolicy(options: BymaxRealtimeModuleOptions): void {
  const policy = options.reauthenticationPolicy
  for (const [name, least] of REAUTH_INTEGER_OPTIONS) {
    const value: unknown = policy?.[name]
    if (
      value !== undefined &&
      !(typeof value === 'number' && Number.isInteger(value) && value >= least)
    ) {
      throw realtimeError(
        REALTIME_ERROR_CODES.INVALID_OPTIONS,
        `options.reauthenticationPolicy.${name} must be an integer >= ${least}, got ${String(value)}`,
        { who: 'BymaxRealtimeModule' },
      )
    }
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
  if (sse?.replayBufferSize !== undefined && sse.replayBufferSize < 0) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.sse.replayBufferSize must be >= 0`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  for (const name of ['maxQueuedBytes', 'maxQueuedEvents', 'stallHeartbeats'] as const) {
    const value: unknown = sse?.[name]
    if (
      value !== undefined &&
      !(typeof value === 'number' && Number.isInteger(value) && value >= 0)
    ) {
      throw realtimeError(
        REALTIME_ERROR_CODES.INVALID_OPTIONS,
        `options.sse.${name} must be an integer >= 0 (0 switches the bound off), got ${String(value)}`,
        { who: 'BymaxRealtimeModule' },
      )
    }
  }
  if (sse?.maxConnectionsPerUser !== undefined && sse.maxConnectionsPerUser < 0) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.sse.maxConnectionsPerUser must be >= 0 (0 disables the per-user connection cap)`,
      { who: 'BymaxRealtimeModule' },
    )
  }
}
