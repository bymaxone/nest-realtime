/**
 * @fileoverview Validation of the rooms an authenticator asks to join a connection to at admission.
 * @layer utils
 */
import { ADMISSION_ROOM_LIMITS } from '../../shared/constants/admission-rooms.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { assertBuiltinsIntact } from './builtin-baseline'
import { readHostKey } from './read-host-key'
import { realtimeError } from './realtime-error'
import { reservedRoomPrefix } from './reserved-room'

/** The most roles one authentication result may carry. It bounds the cost of the copy, not what a user may hold; kept here rather than in the public limits table. */
const MAX_ROLES = 1024

function refuse(detail: string): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `the authenticator returned rooms that are not valid: ${detail}. Fix the authenticator; ` +
      `the limits are bounds against abuse and apply to this field only.`,
  )
}

/**
 * The roles the connection keeps: a frozen copy of an array, read once here and no further than the bound.
 * A read that throws, or an array that is not readable, is refused at admission, as the authenticator's
 * fault, with the host's error as the cause. A value that is not an array is left as it is.
 */
function admitRoles(roles: AuthenticationResult['roles']): AuthenticationResult['roles'] {
  const admitted: string[] = []
  let overflow = false
  try {
    if (!Array.isArray(roles)) return roles
    for (const role of roles as Iterable<string>) {
      if (admitted.length === MAX_ROLES) {
        overflow = true
        break
      }
      admitted.push(role)
    }
  } catch (error) {
    throw realtimeError(
      REALTIME_ERROR_CODES.AUTH_FAILED,
      'the authenticator returned roles that could not be read: a getter or a proxy on them throws',
      { cause: error },
    )
  }
  if (overflow) {
    throw realtimeError(
      REALTIME_ERROR_CODES.AUTH_FAILED,
      `the authenticator returned more than ${MAX_ROLES} roles: the limit is ${MAX_ROLES}`,
    )
  }
  return Object.freeze(admitted)
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
 * @returns `auth` itself when it has no `rooms` and no array `roles`; otherwise a result with the
 *   same fields and a frozen copy of each of those it has.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `rooms` is present and invalid, or `roles` cannot be read.
 */
export function admitRooms(auth: AuthenticationResult): AuthenticationResult {
  assertBuiltinsIntact()
  const ownRoles = readHostKey(auth, 'roles') as readonly string[] | undefined
  const roles = admitRoles(ownRoles)
  const rooms = readHostKey(auth, 'rooms')
  const kept =
    roles === ownRoles
      ? auth
      : ({ __proto__: null, ...auth, roles: roles as readonly string[] } as AuthenticationResult)
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
  return {
    __proto__: null,
    ...kept,
    rooms: Object.freeze(admitted as string[]),
  } as AuthenticationResult
}
