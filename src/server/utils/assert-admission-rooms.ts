/**
 * @fileoverview Validation of the rooms an authenticator asks to join a connection to at admission.
 * @layer utils
 */
import { ADMISSION_ROOM_LIMITS } from '../../shared/constants/admission-rooms.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { ROOM_PREFIXES } from '../../shared/constants/room-prefixes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { realtimeError } from './realtime-error'

/**
 * Prefixes `rooms` may not use. `user:` and `tenant:` are composed from the identity the
 * library resolved, so naming them would join a connection as another user or tenant;
 * `connection:` is the per-connection room the WebSocket transport uses to revoke one.
 */
const RESERVED_ROOM_PREFIXES: readonly string[] = [
  `${ROOM_PREFIXES.USER}:`,
  `${ROOM_PREFIXES.TENANT}:`,
  'connection:',
]

function refuse(detail: string): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.AUTH_FAILED,
    `the authenticator returned rooms that are not valid: ${detail}. Fix the authenticator; ` +
      `the limits are bounds against abuse and apply to this field only.`,
  )
}

/**
 * Refuse an authentication result whose `rooms` break the admission rules.
 *
 * Like a blank identity, a bad room is a contract violation by the authenticator, so it
 * is refused at admission rather than trimmed or skipped: a connection quietly missing a
 * room it was meant to join would be live and unscoped. Every check is on the runtime
 * value, because the declared type is a promise, not a fact.
 *
 * @param auth - The resolved authentication result.
 * @throws Error carrying `REALTIME_AUTH_FAILED` when `rooms` is present and invalid.
 */
export function assertAdmissionRooms(auth: AuthenticationResult): void {
  const { rooms } = auth
  if (rooms === undefined) return
  if (!Array.isArray(rooms)) refuse('`rooms` is not an array')
  if (rooms.length > ADMISSION_ROOM_LIMITS.MAX_ROOMS) {
    refuse(`${rooms.length} rooms exceeds the limit of ${ADMISSION_ROOM_LIMITS.MAX_ROOMS}`)
  }
  for (const room of rooms as unknown[]) {
    if (typeof room !== 'string' || room.trim().length === 0) {
      refuse('every room must be a non-blank string')
    }
    if (room.length > ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH) {
      refuse(`a room name is longer than ${ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH} characters`)
    }
    const reserved = RESERVED_ROOM_PREFIXES.find((prefix) => room.startsWith(prefix))
    if (reserved !== undefined) refuse(`a room name starts with the reserved prefix "${reserved}"`)
  }
}
