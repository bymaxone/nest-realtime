/**
 * @fileoverview A count that is logged at most once for each window, so a flood cannot flood the log.
 * @layer utils
 */

/** How long a report stays quiet after it was written. */
export const REPORT_WINDOW_MS = 10_000

/** Folds one occurrence in, and writes what is waiting when stopped. */
export interface WindowedReport<T> {
  /** Counts one occurrence in (`add` returns the accumulator with it) and reports when due. */
  (add: (accumulated: T) => T): void
  /** Writes what is waiting for its window, at once, and drops the timer. For shutdown. */
  stop(): void
}

/**
 * Accumulates what happened since the last report and hands it to `emit` at most once for each
 * window. The first occurrence reports at once; later ones are folded into one report that is
 * written when the window ends, whether or not anything else happens. The timer that does so does
 * not keep the process alive.
 *
 * @typeParam T - What is accumulated: a number, or a record of counts.
 * @param fresh - The empty accumulator; called again after every report so none is shared.
 * @param emit - Writes one report from what was accumulated.
 */
export function windowedReport<T>(
  fresh: () => T,
  emit: (accumulated: T) => void,
): WindowedReport<T> {
  let startedAt = Number.NEGATIVE_INFINITY
  let pending = fresh()
  let timer: NodeJS.Timeout | undefined
  const write = (): void => {
    clearTimeout(timer)
    timer = undefined
    startedAt = performance.now()
    const accumulated = pending
    pending = fresh()
    emit(accumulated)
  }
  const report = (add: (accumulated: T) => T): void => {
    pending = add(pending)
    const left = startedAt + REPORT_WINDOW_MS - performance.now()
    if (left <= 0) {
      write()
    } else if (timer === undefined) {
      timer = setTimeout(write, left)
      timer.unref()
    }
  }
  // A timer is armed exactly while something is waiting.
  report.stop = (): void => {
    if (timer !== undefined) write()
  }
  return report
}
