/**
 * @fileoverview Reads the text of a log call that is an event object or, for a line the library does not own, a string.
 * @layer test
 */

/** The human text of what a logger spy received: an event's `message`, or the string itself. */
export function lineOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return String((value as { message: unknown }).message)
  }
  return String(value)
}
