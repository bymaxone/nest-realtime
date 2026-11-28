/**
 * @fileoverview The built-ins the reads and checks of the options rely on, taken when the module loads.
 * @layer utils
 *
 * One a host replaces afterwards can neither change what is copied or accepted nor watch it. A host that
 * changes them has to do it before the library is imported.
 */

/** `JSON.stringify` as it was when the library was imported: it serializes, and takes no part in a decision about admission. */
export const stringify = JSON.stringify

/** `Error` as it was when the library was imported. */
export const NativeError = Error

/** `Object.assign` as it was when the library was imported. */
export const assign = Object.assign

/** `Array.isArray` as it was when the library was imported. */
export const isArray = Array.isArray

/** `Number.isInteger` as it was when the library was imported. */
export const isInteger = Number.isInteger

/** `Object.freeze` as it was when the library was imported. */
export const freeze = Object.freeze

/** `Array.prototype.push` as it was when the library was imported. */
export const push = Array.prototype.push

/** `Reflect.apply` as it was when the library was imported. */
export const apply = Reflect.apply

/** `Object.keys` as it was when the library was imported. */
export const keys = Object.keys

/** The type tag of a value, by `Object.prototype.toString` as it was when the library was imported. */
export const typeTag: (value: unknown) => string = Function.prototype.call.bind(
  Object.prototype.toString,
)

/** `Array.prototype.includes` as it was when the library was imported. */
export const includes = Array.prototype.includes

/** `Array.prototype.some` as it was when the library was imported. */
export const some = Array.prototype.some

/** `Object.getPrototypeOf` as it was when the library was imported. */
export const getPrototypeOf = Object.getPrototypeOf

/** `Object.prototype.hasOwnProperty` as it was when the library was imported. */
export const hasOwnProperty = Object.prototype.hasOwnProperty
