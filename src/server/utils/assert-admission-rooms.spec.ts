/**
 * @fileoverview Unit tests for the validation of the rooms returned at admission.
 * @layer utils
 */
import { ADMISSION_ROOM_LIMITS } from '../../shared/constants/admission-rooms.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { assertAdmissionRooms } from './assert-admission-rooms'

/** Build a result the compiler would reject, as a consumer's JavaScript can. */
function untyped(rooms: unknown): AuthenticationResult {
  return { userId: 'u1', rooms } as AuthenticationResult
}

const PREFIX = `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned rooms that are not valid: `
const SUFFIX =
  '. Fix the authenticator; the limits are bounds against abuse and apply to this field only.'

describe('assertAdmissionRooms', () => {
  // Absent is the ordinary case: nothing to join, nothing to check.
  it('accepts a result with no rooms', () => {
    expect(() => assertAdmissionRooms({ userId: 'u1' })).not.toThrow()
  })

  it('accepts an empty list and ordinary room names', () => {
    expect(() => assertAdmissionRooms(untyped([]))).not.toThrow()
    expect(() =>
      assertAdmissionRooms(untyped(['workspace:w1', 'resource:invoice:1', 'users', 'tenants'])),
    ).not.toThrow()
  })

  // The bounds are inclusive, and the matching name length is counted in code units.
  it('accepts exactly the maximum count and the maximum name length', () => {
    const full = Array.from({ length: ADMISSION_ROOM_LIMITS.MAX_ROOMS }, (_v, i) => `r${i}`)
    expect(() => assertAdmissionRooms(untyped(full))).not.toThrow()
    const longest = 'x'.repeat(ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH)
    expect(() => assertAdmissionRooms(untyped([longest]))).not.toThrow()
  })

  it('accepts duplicates, which join once', () => {
    expect(() => assertAdmissionRooms(untyped(['a', 'a']))).not.toThrow()
  })

  it('refuses a value that is not an array', () => {
    for (const bad of ['workspace:w1', {}, null, 1]) {
      expect(() => assertAdmissionRooms(untyped(bad))).toThrow(
        `${PREFIX}\`rooms\` is not an array${SUFFIX}`,
      )
    }
  })

  it('refuses one room more than the maximum', () => {
    const over = Array.from({ length: ADMISSION_ROOM_LIMITS.MAX_ROOMS + 1 }, (_v, i) => `r${i}`)
    expect(() => assertAdmissionRooms(untyped(over))).toThrow(
      `${PREFIX}33 rooms exceeds the limit of 32${SUFFIX}`,
    )
  })

  it('refuses a name that is not a string, or is blank', () => {
    for (const bad of [1, null, undefined, {}, '', ' ', '\t\n']) {
      expect(() => assertAdmissionRooms(untyped(['ok', bad]))).toThrow(
        `${PREFIX}every room must be a non-blank string${SUFFIX}`,
      )
    }
  })

  it('refuses a name one character longer than the maximum', () => {
    const tooLong = 'x'.repeat(ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH + 1)
    expect(() => assertAdmissionRooms(untyped([tooLong]))).toThrow(
      `${PREFIX}a room name is longer than 256 characters${SUFFIX}`,
    )
  })

  // A prefix the library composes or reserves would join a connection as another identity.
  it.each(['user:', 'tenant:', 'connection:'])('refuses a name starting with "%s"', (prefix) => {
    expect(() => assertAdmissionRooms(untyped([`${prefix}u2`]))).toThrow(
      `${PREFIX}a room name starts with the reserved prefix "${prefix}"${SUFFIX}`,
    )
    expect(() => assertAdmissionRooms(untyped([prefix]))).toThrow('reserved prefix')
  })

  // The prefix is the colon form only: it is what the library composes.
  it('accepts a name that merely contains or resembles a reserved prefix', () => {
    expect(() =>
      assertAdmissionRooms(
        untyped(['x:user:1', 'user', 'tenant', 'connection', 'users:1', 'User:1']),
      ),
    ).not.toThrow()
  })

  it('throws an error that carries the auth-failed code', () => {
    expect(() => assertAdmissionRooms(untyped([' ']))).toThrow(REALTIME_ERROR_CODES.AUTH_FAILED)
  })
})
