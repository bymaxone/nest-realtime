/**
 * Whether a promise settles before the event loop takes its next turn.
 *
 * Layer: test support. A call that is refused at once, or answered from what is already in memory,
 * settles in microtasks, which all run before the next macrotask. A call that waits for something
 * outside the process, a reconnect or a reply, does not, and neither does one that answers from a
 * `setImmediate` or a timer. That ordering is what "at once" means, and it holds on a loaded machine
 * where a bound on elapsed milliseconds does not.
 */

/** What a promise came to, or that it was still waiting when the loop turned. */
export type SettledOrPending<T> = PromiseSettledResult<T> | { readonly status: 'pending' }

/**
 * Settles with the outcome of `call()` if it settles before the next turn of the event loop, and
 * with `{ status: 'pending' }` if it does not. The call is left alone: a pending one keeps going,
 * and the caller decides what to do with it.
 *
 * The turn's end is armed before `call` runs, twice: as a `setImmediate` and as a timer. A promise
 * that is already built has had its own `setImmediate` callbacks queued ahead of any that the
 * helper could add, so one that answers from a `setImmediate` would be counted as answering at
 * once; taking the call lets nothing it queues come before the end of the turn. The timer covers
 * the call being made from a `setImmediate` callback: the loop then runs the timers that are due
 * before the immediates of its next iteration, and a timer the call started would otherwise run
 * first. Timers of one duration run in the order they were started, so the one armed here runs
 * before any the call starts. A reply that the loop reaches before either of them, a socket that
 * already holds its data, still counts as settling in this turn.
 *
 * @param call - Starts the call under test and returns its promise.
 * @returns Its outcome, or `{ status: 'pending' }`.
 */
export function settlesInThisTurn<T>(call: () => Promise<T>): Promise<SettledOrPending<T>> {
  let immediate: NodeJS.Immediate | undefined
  let timer: NodeJS.Timeout | undefined
  const turn = new Promise<SettledOrPending<T>>((resolve) => {
    const pending = (): void => resolve({ status: 'pending' })
    immediate = setImmediate(pending)
    timer = setTimeout(pending, 0)
  })
  const outcome = call().then(
    (value): SettledOrPending<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): SettledOrPending<T> => ({ status: 'rejected', reason }),
  )
  return Promise.race([outcome, turn]).finally(() => {
    clearImmediate(immediate)
    clearTimeout(timer)
  })
}
