/**
 * @fileoverview Dependency-injection tokens (unique Symbols).
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
