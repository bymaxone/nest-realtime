/**
 * @fileoverview A pristine copy of a RegExp, which is also the test of whether a value is one.
 * @layer utils
 */

type Getter<T> = (this: unknown) => T

/** The accessors of `RegExp.prototype`, taken once so that an own property of a value cannot replace them. */
const SOURCE = (
  Object.getOwnPropertyDescriptor(RegExp.prototype, 'source') as { get: Getter<string> }
).get
const FLAGS = (
  Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags') as { get: Getter<string> }
).get

/**
 * A new RegExp with the pattern and flags of `value`, without `g` and `y`, or `undefined` when `value` is not a
 * RegExp. The brand is tested by the `source` accessor of `RegExp.prototype`, which throws for any value without
 * the internal slots of a RegExp: an object that only has its prototype, a `Proxy` over one and a primitive all
 * fail, while a RegExp of any realm passes. The copy is of this realm and has no state between calls, because a
 * `g` or `y` flag makes `test` remember where the last match ended and answer alternately.
 *
 * @param value - What an option held.
 */
export function copyRegExp(value: unknown): RegExp | undefined {
  try {
    return new RegExp(SOURCE.call(value), FLAGS.call(value).replace(/[gy]/g, ''))
  } catch {
    return undefined
  }
}
