/**
 * @fileoverview A Proxy a host call returns is refused before any trap runs, and a prototype chain a host made endless
 * is not walked without end.
 * @layer utils
 */
import { awaitable } from './within-deadline'
import { returnable, unproxied } from './builtin-baseline'

const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }
const PREFIX = 'REALTIME_TRANSPORT_UNAVAILABLE: '

/** A chain of `length` plain objects, each inheriting from the next. */
function chainOf(length: number): object {
  let node: object = {}
  for (let i = 1; i < length; i += 1) node = Object.create(node) as object
  return node
}

describe('awaitable', () => {
  // Scenario: a host call returns a Proxy over a promise, with a trap that records every property read. Expected:
  // the call is refused and no trap ran, since a trap is host code.
  it('refuses a Proxy over a promise without running a trap', () => {
    const reads: PropertyKey[] = []
    const proxy = new Proxy(Promise.resolve(1), {
      get(target, key) {
        reads.push(key)
        return Reflect.get(target, key) as unknown
      },
      getPrototypeOf(target) {
        reads.push('getPrototypeOf')
        return Reflect.getPrototypeOf(target)
      },
    })

    expect(() => awaitable(proxy)).toThrow(expect.objectContaining(REFUSED) as Error)
    expect(reads).toEqual([])
  })

  // Scenario: a plain value and a function that is not a Proxy. Expected: returned as they are.
  it.each([[1], ['x'], [undefined], [null], [{ a: 1 }], [() => 1]])(
    'passes %p through',
    (value) => {
      expect(awaitable(value as never)).toBe(value)
    },
  )

  // Scenario: a Proxy over a function. Expected: refused as well.
  it('refuses a Proxy over a function', () => {
    expect(() => awaitable(new Proxy(() => 1, {}) as never)).toThrow(
      expect.objectContaining(REFUSED) as Error,
    )
  })
})

describe('returnable', () => {
  // Scenario: a prototype chain of 200 objects. Expected: refused, not walked to its end.
  it('refuses a chain deeper than any honest object has', () => {
    expect(() => returnable(chainOf(200))).toThrow(expect.objectContaining(REFUSED) as Error)
  })

  // Scenario: a chain of 10. Expected: returned.
  it('returns an object with an ordinary chain', () => {
    const value = chainOf(10)

    expect(returnable(value)).toBe(value)
  })
  // Scenario: a chain of 63 plain objects, which with `Object.prototype` is 64 links, and one of 64, which is 65.
  // Expected: the 64 are walked and returned, the 65 are refused, with the reason named.
  it('walks a chain of 64 links and refuses one of 65', () => {
    const longest = chainOf(63)

    expect(returnable(longest)).toBe(longest)
    expect(() => returnable(chainOf(64))).toThrow(
      `${PREFIX}an object a decision returns has a prototype chain that is too deep`,
    )
  })

  // Scenario: null, and an object whose chain ends at once because it has no prototype. Expected: both are returned.
  it('returns null and an object with no prototype', () => {
    const bare = Object.create(null) as object

    expect(returnable(null)).toBeNull()
    expect(returnable(bare)).toBe(bare)
  })

  // Scenario: a Proxy as the value, and a Proxy as the prototype of a plain object. Expected: each is refused with the
  // reason named.
  it.each([
    ['as the value', () => new Proxy({}, {})],
    ['as the prototype', () => Object.create(new Proxy({}, {})) as object],
  ])('refuses a Proxy %s', (_where, make) => {
    expect(() => returnable(make())).toThrow(
      `${PREFIX}an object a decision returns, or one it inherits from, is a Proxy`,
    )
  })

  // Scenario: a `then` on the value itself. Expected: refused with the reason named.
  it('refuses a then on the value, with the reason named', () => {
    expect(() => returnable({ then: () => 1 })).toThrow(
      `${PREFIX}an object a decision returns, or one it inherits from, holds a then`,
    )
  })
})

describe('unproxied', () => {
  // Scenario: a Proxy over an object. Expected: refused with the reason named.
  it('refuses a Proxy, naming it', () => {
    expect(() => unproxied(new Proxy({}, {}))).toThrow(`${PREFIX}a host call returned a Proxy`)
  })

  // Scenario: values that are not a Proxy, among them the ones that are not objects. Expected: returned as they are.
  it.each([[1], ['x'], [undefined], [null], [{ a: 1 }], [() => 1]])(
    'passes %p through',
    (value) => {
      expect(unproxied(value)).toBe(value)
    },
  )
})
