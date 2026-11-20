/**
 * @fileoverview What an option refusal says about the value it was given, without echoing it.
 * @layer utils
 */
import { isPlainObject } from './is-plain-object'

const KIND_OF_TYPE: Readonly<Record<string, string>> = {
  string: 'a string',
  boolean: 'a boolean',
  bigint: 'a bigint',
  symbol: 'a symbol',
  function: 'a function',
  undefined: 'undefined',
}

/** Whether a value is an array; a revoked proxy throws on the test, and is then not one. */
function isArray(value: unknown): boolean {
  try {
    return Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * Describe a value by its type, for the message of a refused option.
 *
 * A value handed to an option can be a secret pasted into the wrong field or a function whose source
 * is not meant for a log, and an error message travels into logs and responses. Only a finite number
 * is printed, because it carries nothing a reader should not see; everything else is named by type.
 *
 * @param value - What the option held.
 * @returns Text that completes "received ...".
 */
export function describeReceived(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'a number that is not finite'
  }
  if (value === null) return 'null'
  if (isArray(value)) return 'an array'
  if (typeof value === 'object' && !isPlainObject(value)) return 'a built-in object'
  return KIND_OF_TYPE[typeof value] ?? 'an object'
}
