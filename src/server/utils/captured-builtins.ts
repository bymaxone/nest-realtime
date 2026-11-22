/**
 * @fileoverview The built-ins the copy and the check of a list rely on, taken when the module loads.
 * @layer utils
 *
 * One a host replaces afterwards can neither change what is copied or accepted nor watch it. A host that
 * changes them has to do it before the library is imported.
 */

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

/** `Object.prototype.toString` as it was when the library was imported. */
export const objectToString = Object.prototype.toString
