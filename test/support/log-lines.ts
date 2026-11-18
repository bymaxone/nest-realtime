/**
 * @fileoverview Reads the text of a log call that is an event object or, for a line the library does not own, a string.
 * @layer test
 */

/**
 * The message of what a logger spy received together with the text of the error it carries, for a spec that looks
 * for the text of a failure: the library writes the error under `err`, never into `message`.
 */
export function lineWithError(value: unknown): string {
  const err =
    typeof value === 'object' && value !== null ? (value as { err?: unknown }).err : undefined
  if (err === undefined) return lineOf(value)
  return `${lineOf(value)} ${lineOf(err)}`
}

/** The human text of what a logger spy received: an event's `message`, or the string itself. */
export function lineOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message: unknown }).message)
  }
  return String(value)
}
