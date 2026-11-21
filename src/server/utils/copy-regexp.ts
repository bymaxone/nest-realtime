/**
 * @fileoverview A pristine copy of a plain RegExp, which is also the test of whether a value is one.
 * @layer utils
 */

type Getter<T> = (this: unknown) => T

/** The accessor of `RegExp.prototype` named `name`, taken once so that a later change to the prototype cannot replace it. */
function accessor<T>(name: string): Getter<T> | undefined {
  return (
    Object.getOwnPropertyDescriptor(RegExp.prototype, name) as { get?: Getter<T> } | undefined
  )?.get
}

/** The accessors, the constructor and the introspection the copy relies on, all taken when the module loads. */
const SOURCE = accessor<string>('source') as Getter<string>
/** The accessors of the flags a copy keeps and the one it refuses; `global` is not here, because the copy drops it. */
const FLAG_ACCESSORS: ReadonlyArray<readonly [string, Getter<boolean> | undefined]> = [
  ['d', accessor<boolean>('hasIndices')],
  ['i', accessor<boolean>('ignoreCase')],
  ['m', accessor<boolean>('multiline')],
  ['s', accessor<boolean>('dotAll')],
  ['u', accessor<boolean>('unicode')],
  ['v', accessor<boolean>('unicodeSets')],
  ['y', accessor<boolean>('sticky')],
]
/** The longest pattern a copy is made of: a bound on the cost of reading and keeping one, not a judgement of how it runs. */
const MAX_SOURCE_LENGTH = 1000
const NewRegExp = RegExp
const PROTOTYPE = RegExp.prototype
const getPrototypeOf = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys

/**
 * A new RegExp with the pattern and flags of `value`, without `g`, or `undefined` when `value` cannot be copied
 * faithfully: it is not a plain RegExp (one of this realm, whose prototype is `RegExp.prototype` and which has no
 * property but `lastIndex`, the one every RegExp has), it has the `y` flag, or its source is over 1,000 characters. A subclass, a RegExp with a `test` of
 * its own and a RegExp from another realm have behaviour a copy would lose, and Socket.IO calls their own `test`.
 * A sticky RegExp matches only at the start of what it is asked about, so a copy without the flag is unanchored and
 * accepts an origin that merely contains the pattern. A copy that is more permissive than the original would answer
 * origins the host meant to refuse, so these get no copy and the caller refuses them. The `g` flag only makes `test`
 * remember where the last match ended and answer alternately, so it is dropped and the copy has no state between
 * calls. The flags are built from the accessors taken at load, one by one, never through the `flags` accessor, which
 * reads whatever `RegExp.prototype` holds at the time.
 *
 * @param value - What an option held.
 */
export function copyRegExp(value: unknown): RegExp | undefined {
  try {
    if (getPrototypeOf(value) !== PROTOTYPE) return undefined
    if (ownKeys(value as object).length !== 1) return undefined
    const source = SOURCE.call(value)
    if (source.length > MAX_SOURCE_LENGTH) return undefined
    let flags = ''
    for (const [letter, get] of FLAG_ACCESSORS) {
      if (get === undefined || !get.call(value)) continue
      if (letter === 'y') return undefined
      flags += letter
    }
    return new NewRegExp(source, flags)
  } catch {
    return undefined
  }
}
