/**
 * @fileoverview A standard name of `Object.prototype` made non-configurable counts as a planted change.
 * @layer transport
 *
 * Making a property non-configurable cannot be undone, and Jest gives each spec file a realm of its own, so this is the only
 * row of this file: nothing else shares the realm it leaves changed.
 */
import { plantedKeyCount } from './server-option-names'

describe('a standard name whose only change is that it can no longer be reconfigured', () => {
  // Scenario: `propertyIsEnumerable` keeps its value, writability and enumerability and loses `configurable`.
  // Expected: it counts once. Why: every other attribute compares equal, so only the `configurable` field of the
  // comparison can see it.
  it('counts once', () => {
    expect(plantedKeyCount()).toBe(0)

    Object.defineProperty(Object.prototype, 'propertyIsEnumerable', { configurable: false })

    expect(plantedKeyCount()).toBe(1)
  })
})
