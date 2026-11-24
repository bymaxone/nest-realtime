/**
 * @fileoverview Waiting for a call under a deadline, or for the first of two, without asking a replaceable Promise
 * built-in what it settled with.
 * @layer utils
 */

/**
 * The Promise constructor as it was when the library loaded. A reply read through `Promise.race`, `Promise.resolve` or
 * `.then` is whatever those answer once a host has replaced them, and a decision made on it is the host's.
 */
const NativePromise = Promise

/** What a timeout does besides rejecting the wait. */
export interface DeadlineOptions {
  /** Builds the error the wait rejects with, when the deadline passes first. */
  readonly timeoutError: () => Error
  /** Runs right after the wait was rejected on a deadline, for example to abort the call. */
  readonly onExpire?: () => void
  /** Runs when the call itself settles, whenever that is: after a deadline too. */
  readonly onSettled?: () => void
}

/**
 * One native promise that settles with what `work` settles with, or rejects when `ms` pass first.
 *
 * The caller must `await` the result and must not call `then` on it. The value is read by `await` inside an async
 * function and handed to the resolve function of a promise built from the constructor captured at load: no Promise
 * static is called and no `then` is called on `work`, so a replaced `race`, `resolve` or `then` has nothing to
 * answer for. `await` itself reads `Promise.prototype.constructor`, which the built-in baseline guards, and callers
 * that act on the value assert it afterwards.
 *
 * `work` keeps running after a deadline and its late answer, or rejection, is ignored and handled here.
 *
 * @param work - The call, already started, or a value.
 * @param ms - The deadline in milliseconds.
 * @param options - What a deadline builds and runs, and what runs when the call settles.
 */
export function withinDeadline<T>(
  work: PromiseLike<T> | T,
  ms: number,
  options: DeadlineOptions,
): Promise<T> {
  const { timeoutError, onExpire, onSettled } = options
  return new NativePromise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(timeoutError())
      onExpire?.()
    }, ms)
    timer.unref()
    const wait = async (): Promise<void> => {
      try {
        resolve(await work)
      } catch (error) {
        reject(error)
      } finally {
        clearTimeout(timer)
        onSettled?.()
      }
    }
    void wait()
  })
}

/**
 * One native promise that settles like whichever of `first` and `second` settles first, the same way and for the
 * same reasons as {@link withinDeadline}.
 *
 * @param first - A started call.
 * @param second - Another started call.
 */
export function firstOf<A, B>(first: PromiseLike<A>, second: PromiseLike<B>): Promise<A | B> {
  return new NativePromise<A | B>((resolve, reject) => {
    const follow = async (call: PromiseLike<A | B>): Promise<void> => {
      try {
        resolve(await call)
      } catch (error) {
        reject(error)
      }
    }
    void follow(first)
    void follow(second)
  })
}
