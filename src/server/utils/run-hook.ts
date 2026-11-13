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
 * @param invoke - A function that calls the hook, handling its being absent.
 * @returns The failure, or `undefined` when the hook completed.
 */
export async function runHook(
  invoke: () => void | Promise<void>,
): Promise<HookFailure | undefined> {
  try {
    await invoke()
    return undefined
  } catch (error) {
    return { error }
  }
}
