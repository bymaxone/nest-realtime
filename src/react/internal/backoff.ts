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

/**
 * A reconnect delay as the caller gave it, or `fallback` when it is not a positive whole number.
 * `NaN`, an infinity, zero, a negative or a fraction would reach a timer as 1 ms, and a reconnect
 * every millisecond is a loop against the server.
 */
export function validDelay(ms: number | undefined, fallback: number): number {
  return ms !== undefined && Number.isInteger(ms) && ms > 0 ? ms : fallback
}
