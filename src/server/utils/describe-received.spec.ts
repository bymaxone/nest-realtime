/**
 * @fileoverview The words an option refusal uses for what it received.
 * @layer utils
 */
import { describeReceived } from './describe-received'

describe('describeReceived', () => {
  // Scenario: each kind of value. Expected: a finite number is printed, everything else is named by type.
  it.each([
    [0, '0'],
    [-7, '-7'],
    [1.5, '1.5'],
    [1e300, '1e+300'],
    [Number.NaN, 'a number that is not finite'],
    [Infinity, 'a number that is not finite'],
    [-Infinity, 'a number that is not finite'],
    ['secret', 'a string'],
    ['', 'a string'],
    [true, 'a boolean'],
    [10n, 'a bigint'],
    [Symbol('secret'), 'a symbol'],
    [() => 'secret', 'a function'],
    [undefined, 'undefined'],
    [null, 'null'],
    [['secret'], 'an array'],
    [{ secret: 1 }, 'an object'],
    [new Map(), 'an object'],
    [Object.create(null), 'an object'],
  ])('describes %p as %s', (value, expected) => {
    expect(describeReceived(value)).toBe(expected)
  })
})
