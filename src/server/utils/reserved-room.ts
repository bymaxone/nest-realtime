/**
 * @fileoverview The room names the library composes itself, shared by admission and `joinRoom`.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { ROOM_PREFIXES } from '../../shared/constants/room-prefixes.constants'
import { assertBuiltinsIntact } from './builtin-baseline'
import { realtimeError } from './realtime-error'

/**
 * Prefixes an application may not name. `user:` and `tenant:` are composed from the identity the
 * library resolved, so naming them would join a connection as another user or tenant; `connection:`
 * is the per-connection room the WebSocket transport uses to revoke one.
 */
const RESERVED_ROOM_PREFIXES: readonly string[] = [
  `${ROOM_PREFIXES.USER}:`,
  `${ROOM_PREFIXES.TENANT}:`,
  'connection:',
]

/**
 * The reserved prefix a room name starts with, or `undefined` when the name is free.
 *
 * One rule for the rooms an authenticator returns and for `joinRoom` and `leaveRoom`, so the two
 * cannot disagree. The caller has already checked that the name is a string.
 *
 * @param room - The room name.
 */
export function reservedRoomPrefix(room: string): string | undefined {
  assertBuiltinsIntact()
  return RESERVED_ROOM_PREFIXES.find((prefix) => room.startsWith(prefix))
}

/** What a value is, for a message that must not carry the value itself. */
function describeShape(value: unknown): string {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'an array' : typeof value
}

/**
 * Refuse a room name that is not a non-empty string.
 *
 * socket.io's room calls take an array of names, so a value that is not a string would
 * skip every check written for strings and still reach the rooms. The public type is `string`;
 * the shape is refused rather than each element checked.
 *
 * @param operation - The public call that was made.
 * @param roomId - The room name it was given.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `roomId` is not a non-empty string.
 */
export function requireRoomName(operation: string, roomId: unknown): asserts roomId is string {
  if (typeof roomId === 'string' && roomId.length > 0) return
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `${operation}: \`roomId\` must be a non-empty string, got ${describeShape(roomId)}`,
    { who: 'RealtimeService' },
  )
}

/**
 * Refuse a user id that is not a non-empty string: it names the room `user:{userId}`.
 *
 * @param operation - The public call that was made.
 * @param userId - The user id it was given.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `userId` is not a non-empty string.
 */
export function requireUserId(operation: string, userId: unknown): asserts userId is string {
  if (typeof userId === 'string' && userId.length > 0) return
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `${operation}: \`userId\` must be a non-empty string, got ${describeShape(userId)}`,
    { who: 'RealtimeService' },
  )
}

/**
 * Refuse a room name the library composes, for a call that would put a connection in it or take
 * it out. The message names the operation, the field and the prefix, never the room id, which is
 * the caller's input.
 *
 * @param operation - The public call that was made.
 * @param roomId - The room name it was given.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `roomId` is not a non-empty string, or starts
 *   with a reserved prefix.
 */
export function refuseReservedRoom(operation: string, roomId: unknown): void {
  requireRoomName(operation, roomId)
  const prefix = reservedRoomPrefix(roomId)
  if (prefix === undefined) return
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `${operation}: \`roomId\` starts with the reserved prefix "${prefix}", which the library composes itself`,
    { who: 'RealtimeService' },
  )
}
