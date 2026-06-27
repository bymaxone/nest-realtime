/**
 * @fileoverview Canonical error codes emitted by the library (the §14 catalog).
 * @layer shared
 */

/**
 * Canonical error codes emitted by the library. Map 1-to-1 with
 * `docs/technical_specification.md` §14.
 *
 * `TOO_MANY_CONNECTIONS` signals FIFO eviction: when a user exceeds
 * `maxConnectionsPerUser`, the OLDEST connection is evicted (closed with this
 * code) and the new one is admitted — it is never an HTTP 429 rejection.
 */
export const REALTIME_ERROR_CODES = {
  INVALID_OPTIONS: 'REALTIME_INVALID_OPTIONS',
  NO_AUTHENTICATOR: 'REALTIME_NO_AUTHENTICATOR',
  AUTH_FAILED: 'REALTIME_AUTH_FAILED',
  REAUTHENTICATION_FAILED: 'REALTIME_REAUTHENTICATION_FAILED',
  TOO_MANY_CONNECTIONS: 'REALTIME_TOO_MANY_CONNECTIONS',
  INVALID_TICKET: 'REALTIME_INVALID_TICKET',
  PUBSUB_UNAVAILABLE: 'REALTIME_PUBSUB_UNAVAILABLE',
  PAYLOAD_TOO_LARGE: 'REALTIME_PAYLOAD_TOO_LARGE',
  REPLAY_BUFFER_MISS: 'REALTIME_REPLAY_BUFFER_MISS',
} as const

/** Union of canonical error code values. */
export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[keyof typeof REALTIME_ERROR_CODES]
