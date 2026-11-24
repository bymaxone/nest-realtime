/**
 * @fileoverview Waiting for a call under a deadline, or for the first of two, without asking a replaceable Promise
 * built-in or a planted `then` what it settled with.
 * @layer utils
 */
import { assertBuiltinsIntact } from './builtin-baseline'

/**
 * The engine's own Promise constructor, taken from a promise an async function returns and not from the global binding:
 * a library such as Bluebird installed before this one loads makes `Promise` something else, and a wait built from it
 * would not be a native promise. A reply read through `Promise.race`, `Promise.resolve` or `.then` is whatever those
 * answer once a host has replaced them, and a decision made on it is the host's.
 */
const NativePromise = (
  Object.getPrototypeOf((async () => undefined)()) as { constructor: PromiseConstructor }
).constructor

const define = Object.defineProperty

/**
 * Gives a promise this library made an own `constructor`, the engine's own, so that awaiting it never reads the slot on
 * `Promise.prototype`: a getter that throws there, or a replaced constructor, would otherwise make the await fail before
 * it attached its handlers and leave the rejection of a promise nobody else reads unhandled. It is only for promises the
 * library created; a promise from the host is left as it is.
 *
 * @param promise - A promise this library created and has not awaited yet; anything else is returned as it is.
 * @returns The same promise.
 */
export function shielded<T>(promise: T): T {
  if (typeof promise !== 'object' || promise === null) return promise
  try {
    define(promise, 'constructor', { value: NativePromise, configurable: true, writable: true })
  } catch {
    // A promise that cannot take a property is awaited as it is.
  }
  return promise
}

/**
 * Reads a started call's rejection so that it can never be unhandled, whichever way the wait ends. It awaits, and calls no
 * `then`. The answer is not read: this is for a call whose outcome the caller reads elsewhere, or does not read at all.
 */
export async function absorbed(call: PromiseLike<unknown> | undefined): Promise<void> {
  try {
    await call
  } catch {
    // Read by whoever decides on it.
  }
}

/**
 * What a wait settles with: a box with no prototype. Resolving a promise with a plain object reads its `then`, and a
 * `then` planted on `Object.prototype` or `Array.prototype` answers for every object that has none of its own; a box
 * that inherits nothing has no `then` to find.
 */
export interface Decided<T> {
  readonly v: T
}

/** A literal, not a call to `Object.create`, so that nothing a host can replace runs while the box is made. */
function boxed<T>(value: T): Decided<T> {
  return { __proto__: null, v: value } as Decided<T>
}

/**
 * The value of a settled wait, after the baseline was checked once more: the caller returns it from an async function,
 * which resolves its own promise with it and so reads a `then` the value inherits.
 */
export function unboxed<T>(box: Decided<T>): T {
  assertBuiltinsIntact()
  return box.v
}

/** What a timeout does besides rejecting the wait. */
export interface DeadlineOptions {
  /** Builds the error the wait rejects with, when the deadline passes first. */
  readonly timeoutError: () => Error
  /** Runs right after the wait was rejected on a deadline, for example to abort the call. */
  readonly onExpire?: () => void
  /** Runs when the call itself settles, whenever that is: after a deadline too. */
  readonly onSettled?: () => void
  /**
   * Set when nobody reads what the call settles with, as a revocation: there is nothing to forge, and a refusal there
   * would leave the connection it is revoking in place. The baseline is then not asserted.
   */
  readonly outcomeUnread?: boolean
}

/**
 * One native promise that settles with a box holding what `work` settles with, or rejects when `ms` pass first. Read the
 * value with {@link unboxed}.
 *
 * The caller must `await` the result and must not call `then` on it. `await` reads `Promise.prototype.constructor` at
 * the moment it runs, so the baseline is asserted immediately before each await that feeds a decision, with nothing a
 * host can replace between the assertion and the await: the wait starts before the timer is armed, and the timer is armed
 * before the assertion that precedes the caller's own await. No Promise static is called and no `then` is called on
 * `work`.
 *
 * `work` keeps running after a deadline and its late answer, or rejection, is ignored and handled here.
 *
 * @param work - The call, already started, or a value.
 * @param ms - The deadline in milliseconds.
 * @param options - What a deadline builds and runs, and what runs when the call settles.
 * @throws Error carrying `REALTIME_TRANSPORT_UNAVAILABLE` when a built-in was replaced or a `then` planted.
 */
export function withinDeadline<T>(
  work: PromiseLike<T> | T,
  ms: number,
  options: DeadlineOptions,
): Promise<Decided<T>> {
  const { timeoutError, onExpire, onSettled, outcomeUnread } = options
  void absorbed(work as PromiseLike<T>)
  let timer: NodeJS.Timeout | undefined
  let finished = false
  let orphaned = false
  const promise = new NativePromise<Decided<T>>((resolve, reject) => {
    const wait = async (): Promise<void> => {
      try {
        if (outcomeUnread !== true) assertBuiltinsIntact()
        resolve(boxed(await work))
      } catch (error) {
        if (!orphaned) reject(error)
      } finally {
        finished = true
        clearTimeout(timer)
        onSettled?.()
      }
    }
    void wait()
    if (finished) return
    timer = setTimeout(() => {
      reject(timeoutError())
      onExpire?.()
    }, ms)
    timer.unref()
  })
  // The caller awaits the promise next, and that await asks it for its constructor. When the wait already refused, the
  // promise is rejected and is handed over as it is.
  if (!finished && outcomeUnread !== true) {
    try {
      assertBuiltinsIntact()
    } catch (error) {
      orphaned = true
      clearTimeout(timer)
      throw error
    }
  }
  return promise
}

/**
 * One native promise that settles with a box holding what the first of `first` and `second` settles with, the same way
 * and for the same reasons as {@link withinDeadline}. Nothing a host can replace runs between the assertion in each wait
 * and the caller's own await.
 *
 * @param first - A started call.
 * @param second - Another started call.
 * @throws Error carrying `REALTIME_TRANSPORT_UNAVAILABLE` when a built-in was replaced or a `then` planted.
 */
export function firstOf<A, B>(
  first: PromiseLike<A>,
  second: PromiseLike<B>,
): Promise<Decided<A | B>> {
  void absorbed(first)
  void absorbed(second)
  return new NativePromise<Decided<A | B>>((resolve, reject) => {
    const follow = async (call: PromiseLike<A | B>): Promise<void> => {
      try {
        assertBuiltinsIntact()
        resolve(boxed(await call))
      } catch (error) {
        reject(error)
      }
    }
    void follow(first)
    void follow(second)
  })
}
