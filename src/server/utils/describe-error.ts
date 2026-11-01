/**
 * @fileoverview Printable text for whatever a `catch` or a rejected promise delivered.
 * @layer utils
 */

/** Describe a thrown or rejected value without throwing: `.message` on `null`, or `String()` on a prototype-less object, would. */
export function describeError(reason: unknown): string {
  try {
    return reason instanceof Error ? reason.message : String(reason)
  } catch {
    return 'unprintable error'
  }
}
