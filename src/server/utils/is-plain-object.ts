/**
 * @fileoverview Whether a value is an object that holds options, as opposed to a built-in such as a `Date`.
 * @layer utils
 */
import { apply, objectToString } from './captured-builtins'

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
  return readPlainObject(value).plain
}

/**
 * The same test as `isPlainObject`, with the error the read of the type tag raised when it did. A proxy whose reads
 * throw is the host's own object: it is refused, and its error is not ours to raise, but a caller that refuses it can
 * keep that error as the cause.
 *
 * @param value - What an option held.
 */
export function readPlainObject(value: unknown): {
  plain: boolean
  threw: boolean
  error?: unknown
} {
  if (typeof value !== 'object') return { plain: false, threw: false }
  try {
    return { plain: apply(objectToString, value, []) === '[object Object]', threw: false }
  } catch (error) {
    return { plain: false, threw: true, error }
  }
}
