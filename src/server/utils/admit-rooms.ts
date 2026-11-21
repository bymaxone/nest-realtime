/**
 * @fileoverview Validation of the rooms an authenticator asks to join a connection to at admission.
 * @layer utils
 */
import { ADMISSION_ROOM_LIMITS } from '../../shared/constants/admission-rooms.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { realtimeError } from './realtime-error'
import { reservedRoomPrefix } from './reserved-room'

function refuse(detail: string): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `the authenticator returned rooms that are not valid: ${detail}. Fix the authenticator; ` +
      `the limits are bounds against abuse and apply to this field only.`,
  )
}

/**
 * The roles the connection keeps: a frozen copy of an array, read once here. Roles reach the client and every
 * hook after the admission, so a read that throws is refused now, as the authenticator's fault, with the host's
 * error as the cause. A value that is not an array is left as it is.
 */
function admitRoles(roles: AuthenticationResult['roles']): AuthenticationResult['roles'] {
  if (!Array.isArray(roles)) return roles
  try {
    return Object.freeze([...(roles as readonly string[])])
  } catch (error) {
    throw realtimeError(
      REALTIME_ERROR_CODES.AUTH_FAILED,
      'the authenticator returned roles that could not be read: a getter or a proxy on them throws',
      { cause: error },
    )
  }
}

/**
 * Validate the `rooms` of an authentication result and return the result the connection is
 * admitted with.
 *
 * Like a blank identity, a bad room is a contract violation by the authenticator, so it
 * is refused at admission rather than trimmed or skipped: a connection quietly missing a
 * room it was meant to join would be live and unscoped. Every check is on the runtime
 * value, because the declared type is a promise, not a fact.
 *
 * The rooms that are joined are the ones validated: the list is copied once, reading stops at
 * the bound, the copy is what is checked, and the returned result carries the frozen copy.
 * The authenticator keeps a reference to the array it returned, and the join happens after an
 * await, so reading the original there would join whatever it holds by then.
 *
 * @param auth - The resolved authentication result.
 * @returns `auth` itself when it has no `rooms`; otherwise a result with the same fields and a
 *   frozen copy of its `rooms`.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `rooms` is present and invalid.
 */
export function admitRooms(auth: AuthenticationResult): AuthenticationResult {
  const roles = admitRoles(auth.roles)
  const { rooms } = auth
  const kept = roles === auth.roles ? auth : { ...auth, roles: roles as readonly string[] }
  if (rooms === undefined) return kept
  if (!Array.isArray(rooms)) refuse('`rooms` is not an array')
  const admitted: unknown[] = []
  for (const room of rooms as Iterable<unknown>) {
    if (admitted.length === ADMISSION_ROOM_LIMITS.MAX_ROOMS) {
      refuse(
        `more than ${ADMISSION_ROOM_LIMITS.MAX_ROOMS} rooms: the limit is ${ADMISSION_ROOM_LIMITS.MAX_ROOMS}`,
      )
    }
    admitted.push(room)
  }
  for (const room of admitted) {
    if (typeof room !== 'string' || room.trim().length === 0) {
      refuse('every room must be a non-blank string')
    }
    if (room.length > ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH) {
      refuse(`a room name is longer than ${ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH} characters`)
    }
    const reserved = reservedRoomPrefix(room)
    if (reserved !== undefined) refuse(`a room name starts with the reserved prefix "${reserved}"`)
  }
  return { ...kept, rooms: Object.freeze(admitted as string[]) }
}
