/**
 * @fileoverview Dependency-injection tokens (unique Symbols) and shared module-level constants.
 * @layer composition
 */

/**
 * Dependency-injection tokens.
 *
 * Symbols are used instead of strings so tokens are guaranteed unique at runtime
 * and cannot collide with tokens from other libraries.
 */
export const REALTIME_OPTIONS_TOKEN = Symbol('BYMAX_REALTIME_OPTIONS')
export const REALTIME_TRANSPORT_TOKEN = Symbol('BYMAX_REALTIME_TRANSPORT')
export const REALTIME_AUTHENTICATOR_TOKEN = Symbol('BYMAX_REALTIME_AUTHENTICATOR')
export const REALTIME_PUBSUB_TOKEN = Symbol('BYMAX_REALTIME_PUBSUB')
export const REALTIME_OFFLINE_QUEUE_TOKEN = Symbol('BYMAX_REALTIME_OFFLINE_QUEUE')
export const REALTIME_PRESENCE_TOKEN = Symbol('BYMAX_REALTIME_PRESENCE')
export const REALTIME_HOOKS_TOKEN = Symbol('BYMAX_REALTIME_HOOKS')
export const REALTIME_INSTANCE_ID_TOKEN = Symbol('BYMAX_REALTIME_INSTANCE_ID')

/**
 * Default heartbeat interval in milliseconds.
 *
 * Shared between `SseTransport` (heartbeat service wiring) and
 * `SseSubscriptionHandler` (fallback when `sse.heartbeatMs` is unset).
 */
export const DEFAULT_HEARTBEAT_MS = 30_000

/** How long the library waits for a lifecycle hook it awaits before giving up on it. */
export const DEFAULT_HOOK_TIMEOUT_MS = 5_000

/**
 * Minimum acceptable heartbeat interval in milliseconds.
 *
 * Five seconds is the practical floor — an interval shorter than this is likely
 * a misconfiguration and would generate unnecessary network traffic.
 */
export const HEARTBEAT_MIN_MS = 5_000

/**
 * Maximum acceptable heartbeat interval in milliseconds.
 *
 * Ninety seconds is the safe ceiling: nginx defaults to a 60 s idle timeout and
 * Cloudflare caps at 100 s on free plans.  Staying at or below 90 s ensures
 * keepalives reach both before the proxy drops the connection.
 */
export const HEARTBEAT_MAX_MS = 90_000
