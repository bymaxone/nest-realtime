/**
 * @fileoverview Whether a value is an object that holds options, as opposed to a built-in such as a `Date`.
 * @layer utils
 */

/**
 * Whether a value is an object a host built to hold options: a literal, a null-prototype object or an
 * instance of the host's own class, unless that class sets its own `Symbol.toStringTag` to something other than
 * `'Object'`, which reads as a built-in. An array, a `Date`, a `Map`, a `RegExp` and a `Promise` are not,
 * because reading their keys for an option finds none and the value would be accepted for nothing.
 *
 * `Object.prototype.toString` names a primitive, `null` and `undefined` by their own tags, but a function can
 * set its own tag to `Object`, so the type is tested first.
 *
 * @param value - What an option held.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]'
}
