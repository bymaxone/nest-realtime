/**
 * @fileoverview The built-ins the copy and the check of a list rely on, taken when the module loads.
 * @layer utils
 */

/**
 * `Array.isArray`, `Number.isInteger`, `Object.freeze`, `Array.prototype.push` and `Reflect.apply` as they were
 * when the library was imported, so one a host replaces afterwards can neither change what is copied or accepted nor
 * watch it. A host that changes them has to do it before the library is imported.
 */
export const isArray = Array.isArray
export const isInteger = Number.isInteger
export const freeze = Object.freeze
export const push = Array.prototype.push
export const apply = Reflect.apply
