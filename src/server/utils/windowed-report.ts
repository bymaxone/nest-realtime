/**
 * @fileoverview A count that is logged at most once for each window, so a flood cannot flood the log.
 * @layer utils
 */

/** How long a report stays quiet after it was written. */
export const REPORT_WINDOW_MS = 10_000

/**
 * Accumulates what happened since the last report and hands it to `emit` at most once for each
 * window. The first occurrence reports at once; later ones are folded into the next report, so the
 * line that finally appears carries everything that was left out.
 *
 * @typeParam T - What is accumulated: a number, or a record of counts.
 * @param fresh - The empty accumulator; called again after every report so none is shared.
 * @param emit - Writes one report from what was accumulated.
 * @returns The function that folds one occurrence in (`add` returns the accumulator with it counted
 *   in) and reports when the window has passed.
 */
export function windowedReport<T>(
  fresh: () => T,
  emit: (accumulated: T) => void,
): (add: (accumulated: T) => T) => void {
  let startedAt = Number.NEGATIVE_INFINITY
  let pending = fresh()
  return (add) => {
    pending = add(pending)
    const now = performance.now()
    if (now - startedAt < REPORT_WINDOW_MS) return
    startedAt = now
    const accumulated = pending
    pending = fresh()
    emit(accumulated)
  }
}
