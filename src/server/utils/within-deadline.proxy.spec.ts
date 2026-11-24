/**
 * @fileoverview A Proxy a host call returns is refused before any trap runs, and a prototype chain a host made endless
 * is not walked without end.
 * @layer utils
 */
import { awaitable } from './within-deadline'
import { returnable } from './builtin-baseline'

const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }

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
})
