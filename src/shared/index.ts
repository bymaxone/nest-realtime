/**
 * @fileoverview Public barrel for the zero-dependency `./shared` subpath.
 * @layer shared
 */

// Types
export type { TransportMode } from './types/transport-mode.type'
export type { RealtimeEvent } from './types/realtime-event.type'
export type { PublicConnectionMeta } from './types/connection-meta.type'

// Constants (+ derived types)
export { ROOM_PREFIXES } from './constants/room-prefixes.constants'
export type { RoomPrefix } from './constants/room-prefixes.constants'
export { RESERVED_EVENT_NAMES, PRESENCE_EVENT_NAMES } from './constants/reserved-events.constants'
export type { ReservedEventName, PresenceEventName } from './constants/reserved-events.constants'
export { REALTIME_ERROR_CODES } from './constants/error-codes.constants'
export type { RealtimeErrorCode } from './constants/error-codes.constants'
