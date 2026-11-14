/**
 * @fileoverview The reconnect delay of the SSE hook, kept inside what a timer can run.
 * @layer react
 */

/** The longest a timer can run: a longer delay runs as 1 ms, which would turn the backoff into a storm. */
export const MAX_TIMER_MS = 2_147_483_647

/**
 * The next reconnect delay: double the last one, never more than `maxMs`, and never more than a
 * timer can run, whatever `maxMs` asks for.
 */
export function nextBackoff(lastMs: number, maxMs: number): number {
  return Math.min(lastMs * 2, maxMs, MAX_TIMER_MS)
}
