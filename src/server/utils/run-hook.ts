/**
 * @fileoverview Runs a consumer's lifecycle hook so that its failure is a value, never an exception.
 * @layer utils
 */

/** What a hook that failed left behind, boxed so that a thrown `undefined` is still a failure. */
export interface HookFailure {
  readonly error: unknown
}

/**
 * Run a consumer's hook and settle with its failure instead of raising it.
 *
 * A hook is a consumer's notification, not a condition of the connection it is about. It may
 * throw before it returns or reject afterwards, and it runs where nothing awaits the caller (a
 * disconnect handler) or where a failure would undo the library's own work, so neither is let
 * out. The hook is called synchronously, before the first `await`.
 *
 * With `timeoutMs`, a hook that has not settled in that time is given up on: the failure says so,
 * and whatever the abandoned hook returns or throws later is ignored. A hook that nothing waits
 * for needs no bound; one the library awaits does, or a hook that never settles holds the caller.
 *
 * @param invoke - A function that calls the hook, handling its being absent.
 * @param timeoutMs - How long to wait for the hook to settle; no limit when absent.
 * @returns The failure, or `undefined` when the hook completed.
 */
export async function runHook(
  invoke: () => void | Promise<void>,
  timeoutMs?: number,
): Promise<HookFailure | undefined> {
  const run = (async () => {
    await invoke()
  })()
  let timer: NodeJS.Timeout | undefined
  try {
    if (timeoutMs === undefined) await run
    else {
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`did not settle within ${timeoutMs} ms`)),
          timeoutMs,
        )
        timer.unref()
      })
      await Promise.race([run, timedOut])
    }
    clearTimeout(timer)
    return undefined
  } catch (error) {
    clearTimeout(timer)
    return { error }
  }
}
