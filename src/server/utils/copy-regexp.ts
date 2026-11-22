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

/** A flag the copy keeps, and the accessor that says whether a RegExp has it. */
interface FlagAccessor {
  readonly letter: string
  readonly get: Getter<boolean> | undefined
}

/**
 * The accessors of the flags a copy keeps; `global` is not here, because the copy drops it, and `sticky` has its own
 * constant, because the copy refuses it. The table is walked by index, so no iterator of a built-in array is asked for.
 */
const FLAG_ACCESSORS: readonly FlagAccessor[] = [
  { letter: 'd', get: accessor<boolean>('hasIndices') },
  { letter: 'i', get: accessor<boolean>('ignoreCase') },
  { letter: 'm', get: accessor<boolean>('multiline') },
  { letter: 's', get: accessor<boolean>('dotAll') },
  { letter: 'u', get: accessor<boolean>('unicode') },
  { letter: 'v', get: accessor<boolean>('unicodeSets') },
]
const FLAG_COUNT = 6
/** The accessor of the `y` flag; absent, it refuses every RegExp, because a sticky one could not be told from a plain one. */
const STICKY = accessor<boolean>('sticky')
/** The longest pattern a copy is made of: a bound on the cost of reading and keeping one, not a judgement of how it runs. */
const MAX_SOURCE_LENGTH = 1000
const NewRegExp = RegExp
const PROTOTYPE = RegExp.prototype
const getPrototypeOf = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const apply = Reflect.apply

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
 * reads whatever `RegExp.prototype` holds at the time. The built-ins the copy itself uses (`Reflect.apply`, the
 * constructor, the introspection) are taken at load too, the table is walked by index, and a `sticky` accessor that
 * was absent at load refuses every RegExp, because a sticky one could not be told from a plain one. The module trusts
 * the built-ins as they were when it loaded, so a host that changes them has to do it before the library is imported.
 *
 * @param value - What an option held.
 */
export function copyRegExp(value: unknown): RegExp | undefined {
  try {
    if (getPrototypeOf(value) !== PROTOTYPE) return undefined
    if (ownKeys(value as object).length !== 1) return undefined
    const source = apply(SOURCE, value, []) as string
    if (source.length > MAX_SOURCE_LENGTH) return undefined
    if (STICKY === undefined || apply(STICKY, value, [])) return undefined
    let flags = ''
    for (let index = 0; index < FLAG_COUNT; index += 1) {
      const entry = FLAG_ACCESSORS[index] as FlagAccessor
      if (entry.get !== undefined && apply(entry.get, value, [])) flags += entry.letter
    }
    return new NewRegExp(source, flags)
  } catch {
    return undefined
  }
}
