/**
 * @fileoverview A pristine copy of a plain RegExp, and the test of whether a value is a RegExp at all.
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
 * Whether a value has the internal slots of a RegExp. The `source` accessor of `RegExp.prototype` throws for any
 * value without them, so an object that only has the prototype of a RegExp, a `Proxy` over one and a primitive all
 * fail, while a RegExp of any realm, a subclass and one with properties of its own pass.
 *
 * @param value - What an option held.
 */
export function hasRegExpBrand(value: unknown): boolean {
  try {
    SOURCE.call(value)
    return true
  } catch {
    return false
  }
}

/**
 * A new RegExp with the pattern and flags of `value`, without `g`, or `undefined` when `value` cannot be copied
 * faithfully: it is not a plain RegExp (one of this realm, whose prototype is `RegExp.prototype` and which has no
 * property but `lastIndex`, the one every RegExp has), or it has the `y` flag. A subclass, a RegExp with a `test` of
 * its own and a RegExp from another realm have behaviour a copy would lose, and Socket.IO calls their own `test`.
 * A sticky RegExp matches only at the start of what it is asked about, so a copy without the flag is unanchored and
 * accepts an origin that merely contains the pattern. A copy that is more permissive than the original would answer
 * origins the host meant to refuse, so these get no copy and the caller refuses them. The `g` flag only makes `test`
 * remember where the last match ended and answer alternately, so it is dropped and the copy has no state between
 * calls.
 *
 * @param value - What an option held.
 */
export function copyRegExp(value: unknown): RegExp | undefined {
  try {
    if (Object.getPrototypeOf(value) !== RegExp.prototype) return undefined
    if (Reflect.ownKeys(value as object).length !== 1) return undefined
    const flags = FLAGS.call(value)
    if (flags.includes('y')) return undefined
    return new RegExp(SOURCE.call(value), flags.replace('g', ''))
  } catch {
    return undefined
  }
}
