/**
 * @fileoverview The mark the baseline puts on its own refusal, which lets a `catch` that sorts failures tell it from a
 * store's own.
 * @layer test
 */
import { assertBuiltinsIntact, isBuiltinsRefusal } from './builtin-baseline'

// Scenario: the refusal is thrown while a built-in is replaced, and the built-in is put back before it is sorted.
// Expected: it is still recognised, and an error of a host's own, or anything that is not an object, is not.
describe('the mark on the refusal', () => {
  it('stays on the refusal after the replaced built-in was put back, and on nothing else', () => {
    const original = String.prototype.startsWith
    let refusal: unknown
    String.prototype.startsWith = function replaced(this: string): boolean {
      return true
    }
    try {
      assertBuiltinsIntact()
    } catch (error) {
      refusal = error
    } finally {
      String.prototype.startsWith = original
    }

    expect(isBuiltinsRefusal(refusal)).toBe(true)
    expect(
      isBuiltinsRefusal(Object.assign(new Error('x'), { code: 'REALTIME_TRANSPORT_UNAVAILABLE' })),
    ).toBe(false)
    expect(isBuiltinsRefusal(null)).toBe(false)
    expect(isBuiltinsRefusal(undefined)).toBe(false)
    expect(isBuiltinsRefusal(() => 1)).toBe(false)
    expect(isBuiltinsRefusal('REALTIME_TRANSPORT_UNAVAILABLE')).toBe(false)
  })
})
