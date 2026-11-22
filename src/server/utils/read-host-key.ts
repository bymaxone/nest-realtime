/**
 * @fileoverview Reading an option from an object a host wrote, without taking a key planted on the root prototype for one the host set.
 * @layer utils
 *
 * Something that merges untrusted data into an object can plant a key on `Object.prototype`, and then every object
 * that lacks that key answers it. A key a host's own class prototype defines is the host's, so it is still read;
 * only a key found nowhere but on the root prototype of a realm, in this realm or another, is not.
 */
import { apply, getPrototypeOf, hasOwnProperty, objectPrototype } from './captured-builtins'

/**
 * Whether `holder` is the root prototype of a realm. This realm's is known by identity, since the payload that plants a
 * key can overwrite its `constructor` too; another realm's has no prototype and is the `prototype` of its own
 * `constructor`.
 */
function isRealmRoot(holder: object): boolean {
  if (holder === objectPrototype) return true
  if (
    getPrototypeOf(holder) !== null ||
    !(apply(hasOwnProperty, holder, ['constructor']) as boolean)
  ) {
    return false
  }
  const constructor = (holder as { constructor?: { prototype?: unknown } }).constructor
  return typeof constructor === 'function' && constructor.prototype === holder
}

/** Whether the first object of the prototype chain that holds `key` is the root prototype of a realm. */
function isPlanted(source: object, key: string): boolean {
  let holder: object | null = source
  while (holder !== null && !(apply(hasOwnProperty, holder, [key]) as boolean)) {
    holder = getPrototypeOf(holder) as object | null
  }
  return holder !== null && isRealmRoot(holder)
}

/**
 * `source[key]`, or `undefined` when the key is found only on the root prototype of a realm.
 *
 * @param source - An object a host wrote.
 * @param key - The option.
 */
export function readHostKey(source: object, key: string): unknown {
  return isPlanted(source, key) ? undefined : (source as Record<string, unknown>)[key]
}

/**
 * Whether `source` has `key` the way a host gave it: found by `in`, and not only on the root prototype of a realm.
 *
 * @param source - An object a host wrote.
 * @param key - The option.
 */
export function hasHostKey(source: object, key: string): boolean {
  return key in source && !isPlanted(source, key)
}
