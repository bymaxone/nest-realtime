/**
 * Whether a promise settles before the event loop takes its next turn.
 *
 * Layer: test support. A call that is refused at once, or answered from what is already in memory,
 * settles in microtasks, which all run before the next macrotask. A call that waits for something
 * outside the process, a reconnect or a reply, does not. That ordering is what "at once" means,
 * and it holds on a loaded machine where a bound on elapsed milliseconds does not.
 */

/** What a promise came to, or that it was still waiting when the loop turned. */
export type SettledOrPending<T> = PromiseSettledResult<T> | { readonly status: 'pending' }

/**
 * Settles with the outcome of `promise` if it settles before the next turn of the event loop, and
 * with `{ status: 'pending' }` if it does not. The promise is left alone: a pending one keeps
 * going, and the caller decides what to do with it.
 *
 * @param promise - The call under test.
 * @returns Its outcome, or `{ status: 'pending' }`.
 */
export function settlesInThisTurn<T>(promise: Promise<T>): Promise<SettledOrPending<T>> {
  const outcome = promise.then(
    (value): SettledOrPending<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): SettledOrPending<T> => ({ status: 'rejected', reason }),
  )
  const turn = new Promise<SettledOrPending<T>>((resolve) => {
    setImmediate(() => resolve({ status: 'pending' }))
  })
  return Promise.race([outcome, turn])
}
