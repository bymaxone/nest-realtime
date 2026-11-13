/**
 * @fileoverview Unit tests for the validation of the rooms returned at admission.
 * @layer utils
 */
import { ADMISSION_ROOM_LIMITS } from '../../shared/constants/admission-rooms.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { admitRooms } from './admit-rooms'

/** Build a result the compiler would reject, as a consumer's JavaScript can. */
function untyped(rooms: unknown): AuthenticationResult {
  return { userId: 'u1', rooms } as AuthenticationResult
}

const PREFIX = `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned rooms that are not valid: `
const SUFFIX =
  '. Fix the authenticator; the limits are bounds against abuse and apply to this field only.'

describe('admitRooms', () => {
  // Absent is the ordinary case: nothing to join, nothing to check.
  it('accepts a result with no rooms', () => {
    expect(() => admitRooms({ userId: 'u1' })).not.toThrow()
  })

  it('accepts an empty list and ordinary room names', () => {
    expect(() => admitRooms(untyped([]))).not.toThrow()
    expect(() =>
      admitRooms(untyped(['workspace:w1', 'resource:invoice:1', 'users', 'tenants'])),
    ).not.toThrow()
  })

  // The bounds are inclusive, and the matching name length is counted in code units.
  it('accepts exactly the maximum count and the maximum name length', () => {
    const full = Array.from({ length: ADMISSION_ROOM_LIMITS.MAX_ROOMS }, (_v, i) => `r${i}`)
    expect(() => admitRooms(untyped(full))).not.toThrow()
    const longest = 'x'.repeat(ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH)
    expect(() => admitRooms(untyped([longest]))).not.toThrow()
  })

  it('accepts duplicates, which join once', () => {
    expect(() => admitRooms(untyped(['a', 'a']))).not.toThrow()
  })

  it('refuses a value that is not an array', () => {
    for (const bad of ['workspace:w1', {}, null, 1]) {
      expect(() => admitRooms(untyped(bad))).toThrow(`${PREFIX}\`rooms\` is not an array${SUFFIX}`)
    }
  })

  it('refuses one room more than the maximum', () => {
    const over = Array.from({ length: ADMISSION_ROOM_LIMITS.MAX_ROOMS + 1 }, (_v, i) => `r${i}`)
    expect(() => admitRooms(untyped(over))).toThrow(
      `${PREFIX}more than 32 rooms: the limit is 32${SUFFIX}`,
    )
  })

  // The count is the count of what the connection would join, which is what iterating the array
  // yields; `length` is a property an array can disagree with its own iterator about.
  it('refuses an array whose iterator yields more rooms than its length says', () => {
    const rooms = ['workspace:w1']
    Object.defineProperty(rooms, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i <= ADMISSION_ROOM_LIMITS.MAX_ROOMS; i++) yield `r${i}`
      },
    })
    expect(() => admitRooms(untyped(rooms))).toThrow(
      `${PREFIX}more than 32 rooms: the limit is 32${SUFFIX}`,
    )
  })

  // The bound has to stop the reading, not follow it: an iterator that never ends would otherwise
  // keep admission from completing.
  it('stops reading an iterator once it has yielded more than the maximum', () => {
    let pulled = 0
    const rooms = ['workspace:w1']
    Object.defineProperty(rooms, Symbol.iterator, {
      value: function* () {
        for (;;) {
          pulled += 1
          yield `r${pulled}`
        }
      },
    })

    expect(() => admitRooms(untyped(rooms))).toThrow(
      `${PREFIX}more than 32 rooms: the limit is 32${SUFFIX}`,
    )
    expect(pulled).toBe(ADMISSION_ROOM_LIMITS.MAX_ROOMS + 1)
  })

  // What is validated is what the iterator yields, because that is what the copy holds and
  // what is joined: the array's own elements are not.
  it('validates what the iterator yields, not the elements the array holds', () => {
    const rooms = ['workspace:w1']
    Object.defineProperty(rooms, Symbol.iterator, {
      value: function* () {
        yield 'user:victim'
      },
    })

    expect(() => admitRooms(untyped(rooms))).toThrow('reserved prefix "user:"')
  })

  // The list is read once: an iterator that answers differently the second time must not make
  // what was validated differ from what was copied.
  it('reads the list once, so a second read cannot change what was checked', () => {
    let reads = 0
    const rooms = ['workspace:w1']
    Object.defineProperty(rooms, Symbol.iterator, {
      value: function* () {
        reads += 1
        yield reads === 1 ? 'workspace:w1' : 'user:victim'
      },
    })

    expect(admitRooms(untyped(rooms)).rooms).toStrictEqual(['workspace:w1'])
    expect(reads).toBe(1)
  })

  it('admits what an iterator yields, up to the maximum, and nothing the array also holds', () => {
    const rooms = ['held-by-the-array']
    Object.defineProperty(rooms, Symbol.iterator, {
      value: function* () {
        for (let i = 0; i < ADMISSION_ROOM_LIMITS.MAX_ROOMS; i++) yield `r${i}`
      },
    })

    const admitted = admitRooms(untyped(rooms)).rooms
    expect(admitted).toHaveLength(ADMISSION_ROOM_LIMITS.MAX_ROOMS)
    expect(admitted).not.toContain('held-by-the-array')
  })

  // A length far beyond the bound, with holes: reading stops at the bound instead of walking it.
  it('refuses a sparse array whose length is far beyond the maximum, without walking it', () => {
    const sparse = new Array<string>(2 ** 32 - 1)
    expect(() => admitRooms(untyped(sparse))).toThrow(`more than 32 rooms: the limit is 32`)
  })

  it('refuses a name that is not a string, or is blank', () => {
    for (const bad of [1, null, undefined, {}, '', ' ', '\t\n']) {
      expect(() => admitRooms(untyped(['ok', bad]))).toThrow(
        `${PREFIX}every room must be a non-blank string${SUFFIX}`,
      )
    }
  })

  it('refuses a name one character longer than the maximum', () => {
    const tooLong = 'x'.repeat(ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH + 1)
    expect(() => admitRooms(untyped([tooLong]))).toThrow(
      `${PREFIX}a room name is longer than 256 characters${SUFFIX}`,
    )
  })

  // A prefix the library composes or reserves would join a connection as another identity.
  it.each(['user:', 'tenant:', 'connection:'])('refuses a name starting with "%s"', (prefix) => {
    expect(() => admitRooms(untyped([`${prefix}u2`]))).toThrow(
      `${PREFIX}a room name starts with the reserved prefix "${prefix}"${SUFFIX}`,
    )
    expect(() => admitRooms(untyped([prefix]))).toThrow('reserved prefix')
  })

  // The prefix is the colon form only: it is what the library composes.
  it('accepts a name that merely contains or resembles a reserved prefix', () => {
    expect(() =>
      admitRooms(untyped(['x:user:1', 'user', 'tenant', 'connection', 'users:1', 'User:1'])),
    ).not.toThrow()
  })

  it('throws an error that carries the auth-failed code', () => {
    expect(() => admitRooms(untyped([' ']))).toThrow(REALTIME_ERROR_CODES.AUTH_FAILED)
  })

  // The authenticator keeps the array it returned, and the join happens after an await: what is
  // joined must be what was validated, whatever the authenticator does with its array later.
  describe('the result it returns', () => {
    it('is the same result when there are no rooms', () => {
      const auth: AuthenticationResult = { userId: 'u1' }
      expect(admitRooms(auth)).toBe(auth)
    })

    it('carries the other fields unchanged and a frozen copy of the rooms', () => {
      const returned = ['workspace:w1']
      const admitted = admitRooms({ userId: 'u1', tenantId: 't1', rooms: returned })

      expect(admitted).toStrictEqual({ userId: 'u1', tenantId: 't1', rooms: ['workspace:w1'] })
      expect(admitted.rooms).not.toBe(returned)
      expect(Object.isFrozen(admitted.rooms)).toBe(true)
    })

    it('does not follow the original array once it has been admitted', () => {
      const returned = ['workspace:w1']
      const admitted = admitRooms({ userId: 'u1', rooms: returned })

      returned.push('user:victim')
      returned[0] = 'workspace:other'

      expect(admitted.rooms).toStrictEqual(['workspace:w1'])
    })
  })
})
