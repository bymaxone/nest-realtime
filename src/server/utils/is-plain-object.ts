/**
 * @fileoverview Whether a value is an object that holds options, as opposed to a built-in such as a `Date`.
 * @layer utils
 */

/**
 * Whether a value is an object a host built to hold options: a literal, a null-prototype object or an
 * instance of the host's own class. An array, a `Date`, a `Map`, a `RegExp` and a `Promise` are not,
 * because reading their keys for an option finds none and the value would be accepted for nothing.
 *
 * `Object.prototype.toString` names a primitive, `null`, `undefined` and a function by their own tag, so no
 * separate test for them is needed.
 *
 * @param value - What an option held.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}
