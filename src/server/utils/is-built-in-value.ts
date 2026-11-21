/**
 * @fileoverview Whether a value is one of the built-in kinds that holds no options by its keys.
 * @layer utils
 */
import { types } from 'node:util'

/**
 * Whether a value is an array, a `Map`, a `Set`, a `WeakMap`, a `WeakSet`, a `Date`, a `RegExp` or a `Promise`,
 * of any realm. The test reads no property of the value, so a proxy cannot run host code through it. A host object
 * that only reports one of these tags is not one.
 *
 * @param value - What an option held.
 */
export function isBuiltInValue(value: unknown): boolean {
  return (
    Array.isArray(value) ||
    types.isMap(value) ||
    types.isSet(value) ||
    types.isWeakMap(value) ||
    types.isWeakSet(value) ||
    types.isDate(value) ||
    types.isRegExp(value) ||
    types.isPromise(value)
  )
}
