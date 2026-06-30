/**
 * @fileoverview Event names reserved by the library (the §13 catalog).
 * @layer shared
 */

/**
 * Event names reserved by the library.
 *
 * Consumer apps should not reuse these names for application-level events; doing
 * so will not throw, but causes confusion in logs and client-side listeners.
 *
 * Note: the SSE heartbeat is intentionally absent. It is a raw `: keepalive`
 * comment written directly to the response stream (not a named event and outside
 * the `Last-Event-ID` id-space), so it is not part of this catalog.
 */
export const RESERVED_EVENT_NAMES = {
  CONNECTION_ESTABLISHED: 'connection:established',
  CONNECTION_REAUTH_FAILED: 'connection:reauthentication-failed',
  CONNECTION_CREDENTIAL_EXPIRING: 'connection:credential-expiring',
  ROOM_JOINED: 'room:joined',
  ROOM_LEFT: 'room:left',
  ERROR: 'error',
} as const

/** Union of reserved event name values. */
export type ReservedEventName = (typeof RESERVED_EVENT_NAMES)[keyof typeof RESERVED_EVENT_NAMES]

/**
 * Application-level presence event names emitted by an `IPresenceStorage`
 * implementation and consumed by the `usePresence` client hook.
 *
 * These are named transport events — carried over the `event:` SSE field and as
 * Socket.IO event names — so a client must subscribe to them explicitly to
 * preserve the event `type`. The native `EventSource.onmessage` callback only
 * receives the default `message` event, never these named ones.
 */
export const PRESENCE_EVENT_NAMES = {
  ONLINE: 'presence:online',
  OFFLINE: 'presence:offline',
} as const

/** Union of presence event name values. */
export type PresenceEventName = (typeof PRESENCE_EVENT_NAMES)[keyof typeof PRESENCE_EVENT_NAMES]
