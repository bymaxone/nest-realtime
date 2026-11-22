/**
 * @fileoverview Reading an option from an object a host wrote, without taking a key planted on the root prototype for one the host set.
 * @layer utils
 *
 * Something that merges untrusted data into an object can plant a key on `Object.prototype`, and then every object
 * that lacks that key answers it. A key a host's own class prototype defines is the host's, so it is still read;
 * only a key found nowhere but on a prototype with no prototype of its own, which is what the root prototype of a
 * realm is, is not.
 */
import { apply, getPrototypeOf, hasOwnProperty } from './captured-builtins'

/**
 * Whether the first object of the prototype chain that holds `key` is not `source` and has no prototype of its own.
 * That is what the root prototype of a realm is, this one or another, and nothing it holds can be trusted once a
 * payload that plants a key has run, so it is told by that alone. A class prototype has a prototype, and an object
 * that holds the key itself is `source`.
 */
function isPlanted(source: object, key: string): boolean {
  let holder: object | null = source
  while (holder !== null && !(apply(hasOwnProperty, holder, [key]) as boolean)) {
    holder = getPrototypeOf(holder) as object | null
  }
  return holder !== null && holder !== source && getPrototypeOf(holder) === null
}

/**
 * `source[key]`, or `undefined` when the key is found only on a prototype with no prototype of its own.
 *
 * @param source - An object a host wrote.
 * @param key - The option.
 */
export function readHostKey(source: object, key: string): unknown {
  return isPlanted(source, key) ? undefined : (source as Record<string, unknown>)[key]
}

/**
 * Whether `source` has `key` the way a host gave it: found by `in`, and not only on a prototype with no prototype of its own.
 *
 * @param source - An object a host wrote.
 * @param key - The option.
 */
export function hasHostKey(source: object, key: string): boolean {
  return key in source && !isPlanted(source, key)
}

/**
 * The function `owner` holds under `name` the way a host gave it, or `undefined` when it holds none: a method of its
 * own or of its class counts, and one found only on a prototype with no prototype of its own does not.
 *
 * @param owner - An object a host wrote, such as the authenticator or the hook table.
 * @param name - The optional method.
 */
export function hostMethod(
  owner: object | null | undefined,
  name: string,
): ((...args: never[]) => unknown) | undefined {
  if (owner === null || owner === undefined) return undefined
  const method = readHostKey(owner, name)
  return typeof method === 'function' ? (method as (...args: never[]) => unknown) : undefined
}

/**
 * Calls the method `owner` holds under `name` with `owner` as `this`, as `owner.name(...args)` would; `undefined` when
 * it holds none, by the same rule as `hostMethod`.
 *
 * @param owner - An object a host wrote, such as the hook table.
 * @param name - The optional method.
 * @param args - What the method is given.
 */
export function callHostMethod<Result = void | Promise<void>>(
  owner: object | null | undefined,
  name: string,
  args: readonly unknown[],
): Result | undefined {
  const method = hostMethod(owner, name)
  return method === undefined ? undefined : (apply(method, owner, args) as Result)
}
