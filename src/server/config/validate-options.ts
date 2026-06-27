/**
 * @fileoverview Bootstrap validation of module options with typed error codes.
 * @layer composition
 */
import { Logger } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'

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
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: options.transport must be one of 'sse' | 'websocket' | 'both' (got: ${String(options.transport)})`,
    )
  }
  if (!options.authenticator) {
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.NO_AUTHENTICATOR}: options.authenticator is required — the library never ships a default authenticator`,
    )
  }
  if (typeof options.authenticator.authenticate !== 'function') {
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.NO_AUTHENTICATOR}: options.authenticator must implement IConnectionAuthenticator.authenticate(context)`,
    )
  }
  validateSseOptions(options)
  validateReauthPolicy(options)
}

function validateReauthPolicy(options: BymaxRealtimeModuleOptions): void {
  const policy = options.reauthenticationPolicy
  if (
    policy?.cacheTtlMs !== undefined &&
    policy.intervalSeconds !== undefined &&
    policy.cacheTtlMs > policy.intervalSeconds * 1000
  ) {
    Logger.warn(
      `[BymaxRealtimeModule] reauthenticationPolicy.cacheTtlMs (${policy.cacheTtlMs} ms) is greater than intervalSeconds*1000 (${policy.intervalSeconds * 1000} ms) — every cycle will be a cache miss and revalidate will be called on every tick`,
      'BymaxRealtimeModule',
    )
  }
}

function validateSseOptions(options: BymaxRealtimeModuleOptions): void {
  const sse = options.sse
  if (sse?.heartbeatMs !== undefined && sse.heartbeatMs <= 0) {
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: options.sse.heartbeatMs must be > 0`,
    )
  }
  if (sse?.replayBufferSize !== undefined && sse.replayBufferSize < 0) {
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: options.sse.replayBufferSize must be >= 0`,
    )
  }
  if (sse?.maxConnectionsPerUser !== undefined && sse.maxConnectionsPerUser < 0) {
    throw new Error(
      `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: options.sse.maxConnectionsPerUser must be >= 0 (0 disables the per-user connection cap)`,
    )
  }
}
