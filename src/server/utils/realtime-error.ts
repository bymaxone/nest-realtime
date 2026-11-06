/**
 * @fileoverview The error every coded failure of this library is built with.
 * @layer utils
 */
import type { RealtimeErrorCode } from '../../shared/constants/error-codes.constants'

/** An error that carries one of the library's stable codes as a property. */
export type CodedError = Error & { readonly code: RealtimeErrorCode }

/**
 * Builds an error whose stable code is both the lead of its message and a `code` property.
 * Deriving the two from one value keeps them from disagreeing, and the property is what a caller
 * branches on without parsing text. A plain `Error` rather than a class: a class is a different
 * class in each bundle of the package, so `instanceof` would not be reliable across them.
 *
 * @param code - The stable error code to carry.
 * @param detail - What went wrong, after the code.
 * @param options - `who`: the class that raises it, shown in brackets before the code. `cause`: the
 *   failure underneath, whatever was thrown; it is kept when the key is present.
 */
export function realtimeError(
  code: RealtimeErrorCode,
  detail: string,
  options: { readonly who?: string; readonly cause?: unknown } = {},
): CodedError {
  const lead = options.who === undefined ? code : `[${options.who}] ${code}`
  const message = `${lead}: ${detail}`
  const error =
    'cause' in options ? new Error(message, { cause: options.cause }) : new Error(message)
  return Object.assign(error, { code })
}
