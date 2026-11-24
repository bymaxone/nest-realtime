/**
 * @fileoverview A `then` that is already on a root prototype when the library loads is a replaced built-in from the
 * first call on.
 * @layer utils
 *
 * Constraint under test: the slots that must hold no `then` are recorded as absent, whatever the process held at load, so
 * a process that was polluted before the import is refused instead of having its `then` taken for the baseline.
 */
import type * as BuiltinBaseline from './builtin-baseline'

type Baseline = typeof BuiltinBaseline

const HOLDERS: Array<[string, object]> = [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype],
  ['Function.prototype', Function.prototype],
]

describe('a process with a then on a root prototype before the library loaded', () => {
  // Scenario: a `then` sits on one root prototype while the module loads, and stays there. Expected: that slot counts as
  // replaced, so every use is refused with a count of one; a baseline that took the planted `then` as its own would count
  // nothing.
  it.each(HOLDERS)('counts the then on %s as a replaced built-in', (_name, holder) => {
    let count: number | undefined
    let refusal: unknown
    Object.defineProperty(holder, 'then', {
      value: () => undefined,
      configurable: true,
      writable: true,
    })
    try {
      jest.isolateModules(() => {
        const loaded = require('./builtin-baseline') as Baseline
        count = loaded.replacedBuiltinCount()
        try {
          loaded.assertBuiltinsIntact()
        } catch (error) {
          refusal = error
        }
      })
    } finally {
      Reflect.deleteProperty(holder, 'then')
    }

    expect(count).toBe(1)
    expect((refusal as Error).message).toBe(
      'REALTIME_TRANSPORT_UNAVAILABLE: 1 built-in the library calls is not as the library expects',
    )
  })
})
