/**
 * @fileoverview Waiting for a call under a deadline, or for the first of two, without asking a replaceable Promise
 * built-in or a planted `then` what it settled with.
 * @layer utils
 */
import { types } from 'node:util'
import { assertBuiltinsIntact } from './builtin-baseline'
import { apply, getPrototypeOf, hasOwnProperty } from './captured-builtins'

/**
 * The engine's own Promise constructor, taken from a promise an async function returns and not from the global binding:
 * a library such as Bluebird installed before this one loads makes `Promise` something else, and a wait built from it
 * would not be a native promise. A reply read through `Promise.race`, `Promise.resolve` or `.then` is whatever those
 * answer once a host has replaced them, and a decision made on it is the host's.
 */
const enginePromisePrototype: unknown = Object.getPrototypeOf((async () => undefined)())
const NativePromise = (enginePromisePrototype as { constructor: PromiseConstructor }).constructor

// The slot that gave the constructor is writable, so a host that ran before this module loaded may have put its own
// there. A function that is the engine's Promise has the engine's prototype and prints as native code; refusing to load
// is better than pinning a stranger's constructor on every promise a decision awaits.
if (
  NativePromise.prototype !== enginePromisePrototype ||
  NativePromise.name !== 'Promise' ||
  !Function.prototype.toString.call(NativePromise).includes('[native code]')
) {
  throw new TypeError('The Promise constructor was replaced before this module loaded.')
}

const define = Object.defineProperty
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor

/**
 * Gives a promise an own `constructor`, the engine's own, pinned: neither writable nor configurable, so that whoever
 * holds the promise cannot swap it back. Awaiting it then never reads the slot on `Promise.prototype` and never asks
 * for a `then`: a getter or a replaced constructor there would otherwise make the await route through whatever the host
 * put in them, or fail before it attached its handlers and leave the rejection of a promise nobody else reads
 * unhandled. It is for a promise about to be awaited, the library's own or a native one a host call returned.
 *
 * @param promise - A native promise about to be awaited; anything else is returned as it is.
 * @returns The same promise.
 * @throws {TypeError} When the promise holds an own `constructor` that is not the engine's and cannot be replaced, or
 *   cannot take one: awaiting it would route through that value.
 */
export function shielded<T>(promise: T): T {
  if (typeof promise !== 'object' || promise === null) return promise
  try {
    define(promise, 'constructor', { value: NativePromise, configurable: false, writable: false })
  } catch {
    // A promise that kept an own constructor of its own, or cannot take one, is checked below.
  }
  const own = getOwnPropertyDescriptor(promise, 'constructor')
  if (own?.value !== NativePromise || own.writable !== false || own.configurable !== false) {
    throw new TypeError('A promise that cannot carry the engine constructor is not awaited.')
  }
  return promise
}

/**
 * A host call's result, ready to await: a native promise is given its own constructor first, so that the await reads
 * neither the shared constructor nor a `then`. Anything else is returned as it is.
 */
export function awaitable<P extends PromiseLike<unknown>>(result: P): P
export function awaitable<T>(result: PromiseLike<T> | T): PromiseLike<T> | T
export function awaitable(result: unknown): unknown {
  if (!types.isPromise(result)) return result
  try {
    return shielded(result)
  } catch (error) {
    // Refused, and nothing else will read it: its rejection is read here so that it is not left unhandled.
    void absorbed(result)
    throw error
  }
}

/** `awaitable`, giving back the caller's place when it refuses: the promise that place was taken for will not be tracked. */
function awaitableOrGiveBack<T>(
  work: PromiseLike<T> | T,
  onSettled: (() => void) | undefined,
): PromiseLike<T> | T {
  try {
    return awaitable(work)
  } catch (error) {
    onSettled?.()
    throw error
  }
}

/**
 * Whether a host call's result has no `then` to ask for: not an object, or null, or a plain record with none of its own.
 * Awaiting any other object reads its `then`, and a `then` a host planted on a root prototype answers for a record that
 * has none; a result used as it is, with the baseline asserted before it is returned, is never asked.
 */
export function isPlainResult<T>(result: PromiseLike<T> | T): result is T {
  if (typeof result === 'function') return false
  if (typeof result !== 'object' || result === null) return true
  const proto = getPrototypeOf(result)
  return (proto === Object.prototype || proto === null) && !apply(hasOwnProperty, result, ['then'])
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
  // Before anything awaits it: a host's native promise carries no constructor of its own, and the first await of it would
  // read the shared slot ahead of the check below. A result that is not a promise is not awaited until after that check.
  const call = awaitableOrGiveBack(work, onSettled)
  if (types.isPromise(call)) void absorbed(call)
  let timer: NodeJS.Timeout | undefined
  let finished = false
  let orphaned = false
  const promise = new NativePromise<Decided<T>>((resolve, reject) => {
    const wait = async (): Promise<void> => {
      try {
        if (outcomeUnread !== true) assertBuiltinsIntact()
        resolve(boxed(await call))
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
  // The caller awaits the promise next, and that await asks it for its constructor. A wait that refused before the timer
  // was armed skips the check below, so what is handed over carries its own constructor on every path.
  if (!finished && outcomeUnread !== true) {
    try {
      assertBuiltinsIntact()
    } catch (error) {
      orphaned = true
      clearTimeout(timer)
      throw error
    }
  }
  return shielded(promise)
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
  let calls: [PromiseLike<A>, PromiseLike<B>]
  try {
    calls = [awaitable(first), awaitable(second)]
  } catch (error) {
    for (const call of [first, second]) if (types.isPromise(call)) void absorbed(call)
    throw error
  }
  for (const call of calls) if (types.isPromise(call)) void absorbed(call)
  const promise = new NativePromise<Decided<A | B>>((resolve, reject) => {
    const follow = async (call: PromiseLike<A | B>): Promise<void> => {
      try {
        assertBuiltinsIntact()
        resolve(boxed(await call))
      } catch (error) {
        reject(error)
      }
    }
    for (const call of calls) void follow(call)
  })
  return shielded(promise)
}
