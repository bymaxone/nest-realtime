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
 * The turn's end is armed before `call` runs. A promise that is already built has had its own
 * `setImmediate` callbacks queued ahead of any that the helper could add, so one that answers from
 * a `setImmediate` would be counted as answering at once; taking the call lets nothing it queues
 * come before the end of the turn.
 *
 * @param call - Starts the call under test and returns its promise.
 * @returns Its outcome, or `{ status: 'pending' }`.
 */
export function settlesInThisTurn<T>(call: () => Promise<T>): Promise<SettledOrPending<T>> {
  const turn = new Promise<SettledOrPending<T>>((resolve) => {
    setImmediate(() => resolve({ status: 'pending' }))
  })
  const outcome = call().then(
    (value): SettledOrPending<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): SettledOrPending<T> => ({ status: 'rejected', reason }),
  )
  return Promise.race([outcome, turn])
}
