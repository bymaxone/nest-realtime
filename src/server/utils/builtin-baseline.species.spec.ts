/**
 * @fileoverview `Promise[Symbol.species]` is one of the built-ins the library compares with what it was at load.
 * @layer utils
 */
import { admitRooms } from './admit-rooms'
import { BUILTIN_SLOTS, replacedBuiltinCount } from './builtin-baseline'

const define = Object.defineProperty
const describe_ = Object.getOwnPropertyDescriptor

describe('the species getter of Promise', () => {
  // Scenario: `Promise[Symbol.species]` is replaced, for good, by a getter that answers a fake constructor, so the `then`
  // of a dependency builds its promise from the host's constructor. Expected: it is a slot of its own, counted once, and
  // admission is refused while it is replaced.
  it('is listed, and admission is refused while its getter is replaced', () => {
    const original = describe_(Promise, Symbol.species) as PropertyDescriptor
    let code: unknown
    let count = -1
    define(Promise, Symbol.species, {
      configurable: true,
      get: () =>
        function Fake() {
          return undefined
        },
    })
    try {
      count = replacedBuiltinCount()
      try {
        admitRooms({ userId: 'u1', rooms: ['workspace:w1'] })
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    } finally {
      define(Promise, Symbol.species, original)
    }

    expect(BUILTIN_SLOTS.some((slot) => slot[0] === Promise && slot[1] === Symbol.species)).toBe(
      true,
    )
    expect(count).toBe(1)
    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })
})
