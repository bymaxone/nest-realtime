/**
 * @fileoverview The built-ins the option, validation and admission paths call, recorded when the library loads and compared by identity.
 * @layer utils
 */
import { types } from 'node:util'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { realtimeError } from './realtime-error'

/** One built-in the library calls: the object that holds it and its key. */
export type BuiltinSlot = readonly [target: object, key: PropertyKey]

const describe = Object.getOwnPropertyDescriptor
const hasOwn = Object.prototype.hasOwnProperty
const apply = Reflect.apply
const getProto = Object.getPrototypeOf
const isProxy = types.isProxy

/**
 * What a slot holds: its value, or the getter of an accessor, which is what a flag of a RegExp is. A descriptor is an
 * ordinary object, so a field it does not hold itself is answered by the root prototype: `value` is read only when the
 * descriptor holds it, and a descriptor with no value is an accessor's, which always holds its `get`, even when it is
 * `undefined`. A slot that is not there is `undefined`, which is what a method that must be absent holds.
 */
function held(target: object, key: PropertyKey): unknown {
  const descriptor = describe(target, key)
  if (descriptor === undefined) return undefined
  return (apply(hasOwn, descriptor, ['value']) as boolean) ? descriptor.value : descriptor.get
}

/**
 * Whether a slot is a data property: 1, an accessor: 2, or not there: 0. A data property holding a function and an accessor
 * whose getter is that function answer the same from `held`, and are not the same slot: reading the second runs the function.
 */
function kindOf(target: object, key: PropertyKey): number {
  const descriptor = describe(target, key)
  if (descriptor === undefined) return 0
  return (apply(hasOwn, descriptor, ['value']) as boolean) ? 1 : 2
}

/**
 * Every built-in the code of the options, their validation and the admission of a connection calls by name, by syntax
 * (`for...of`, spread, destructuring) or through a built-in class, apart from the iterators. A test scans those files for a
 * call that is in none of this list, so a new one cannot be added without being listed here or exempted, with the reason,
 * in the scan.
 */
const NAMED: readonly BuiltinSlot[] = [
  [Object, 'assign'],
  [Object, 'create'],
  [Object, 'defineProperties'],
  [Object, 'defineProperty'],
  [Object, 'entries'],
  [Object, 'freeze'],
  [Object, 'fromEntries'],
  [Object, 'getOwnPropertyDescriptor'],
  [Object, 'getOwnPropertyNames'],
  [Object, 'getPrototypeOf'],
  [Object, 'is'],
  [Object, 'keys'],
  [Object, 'values'],
  [Array, 'from'],
  [Array, 'isArray'],
  [Array.prototype, 'concat'],
  [Array.prototype, 'every'],
  [Array.prototype, 'filter'],
  [Array.prototype, 'findIndex'],
  [Array.prototype, 'find'],
  [Array.prototype, 'forEach'],
  [Array.prototype, 'includes'],
  [Array.prototype, 'indexOf'],
  [Array.prototype, 'join'],
  [Array.prototype, 'map'],
  [Array.prototype, 'push'],
  [Array.prototype, 'reduce'],
  [Array.prototype, 'shift'],
  [Array.prototype, 'slice'],
  [Array.prototype, 'some'],
  [Array.prototype, Symbol.iterator],
  [Number, 'isFinite'],
  [Number, 'isInteger'],
  [Number, 'isSafeInteger'],
  [Math, 'floor'],
  [String.prototype, 'includes'],
  [String.prototype, 'indexOf'],
  [String.prototype, 'replace'],
  [String.prototype, 'slice'],
  [String.prototype, 'split'],
  [String.prototype, 'startsWith'],
  [String.prototype, 'trim'],
  [String.prototype, Symbol.iterator],
  [Set.prototype, 'add'],
  [Set.prototype, 'delete'],
  [Set.prototype, 'size'],
  [Set.prototype, 'has'],
  [Set.prototype, 'values'],
  [Set.prototype, Symbol.iterator],
  [Reflect, 'apply'],
  [Reflect, 'getPrototypeOf'],
  [Reflect, 'ownKeys'],
  [Function.prototype, 'apply'],
  [Function.prototype, 'bind'],
  [Function.prototype, 'call'],
  [RegExp.prototype, 'exec'],
  [RegExp.prototype, 'test'],
  // What `split`, `replace`, `match`, `search` and the coercions ask a value for by symbol, and the flags `replace` reads. A
  // string primitive answers from `String.prototype`, a number from `Number.prototype`: those must have none.
  [RegExp.prototype, Symbol.match],
  [RegExp.prototype, Symbol.matchAll],
  [RegExp.prototype, Symbol.replace],
  [RegExp.prototype, Symbol.search],
  [RegExp.prototype, Symbol.split],
  [String.prototype, Symbol.match],
  [String.prototype, Symbol.matchAll],
  [String.prototype, Symbol.replace],
  [String.prototype, Symbol.search],
  [String.prototype, Symbol.split],
  [Number.prototype, Symbol.toPrimitive],
  [Date.prototype, Symbol.toPrimitive],
  // `await` of a native promise asks it for its constructor, and a replaced one sends the wait through `then` instead.
  // `then` and the statics are not listed: an APM wraps `then` by design, and nothing a decision reads calls them.
  [Object.getPrototypeOf((async () => undefined)()) as object, 'constructor'],
  [Map.prototype, 'delete'],
  [Map.prototype, 'entries'],
  [Map.prototype, 'forEach'],
  [Map.prototype, 'get'],
  [Map.prototype, 'has'],
  [Map.prototype, 'keys'],
  [Map.prototype, 'set'],
  [Map.prototype, 'size'],
  [Map.prototype, 'values'],
  [Map.prototype, Symbol.iterator],
  [RegExp.prototype, 'flags'],
  [RegExp.prototype, 'global'],
  [RegExp.prototype, 'hasIndices'],
  [RegExp.prototype, 'ignoreCase'],
  [RegExp.prototype, 'multiline'],
  [RegExp.prototype, 'dotAll'],
  [RegExp.prototype, 'unicode'],
  [RegExp.prototype, 'unicodeSets'],
  [RegExp.prototype, 'sticky'],
  [RegExp.prototype, 'source'],
  [globalThis, 'Object'],
  [globalThis, 'Reflect'],
  [globalThis, 'Array'],
  [globalThis, 'Math'],
  [globalThis, 'Number'],
  [globalThis, 'String'],
  [globalThis, 'Set'],
  [globalThis, 'Map'],
  [globalThis, 'Promise'],
  [globalThis, 'Error'],
  [globalThis, 'RegExp'],
  [globalThis, 'Function'],
]

/**
 * Slots that must hold nothing: a `then` on the root prototypes is read by every promise resolved with an object that has
 * none of its own, and a self-erasing one answers once and leaves no trace. Unlike the slots above these are not compared
 * with what the library found at load: a `then` that was already there then is refused too.
 */
const ABSENT: readonly BuiltinSlot[] = [
  [Object.prototype, 'then'],
  [Array.prototype, 'then'],
  [Function.prototype, 'then'],
]

/** The prototypes behind `for...of`, spread and destructuring, which no name in the source calls. */
function iteratorSlots(): BuiltinSlot[] {
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]()) as object
  const stringIterator = Object.getPrototypeOf(''[Symbol.iterator]()) as object
  const setIterator = Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object
  const mapIterator = Object.getPrototypeOf(new Map()[Symbol.iterator]()) as object
  return [
    [arrayIterator, 'next'],
    [stringIterator, 'next'],
    [setIterator, 'next'],
    [mapIterator, 'next'],
  ]
}

/**
 * The slots, and what each held when the library loaded. A process polluted before the import can make the work of listing
 * and recording throw: that is caught, nothing is recorded, and every use is refused with a count of one, rather than the
 * import failing.
 */
function readBaseline():
  { listed: BuiltinSlot[]; recorded: unknown[]; kinds: number[] } | undefined {
  try {
    const iterators = iteratorSlots()
    const listed = NAMED.concat(iterators, ABSENT)
    const recorded = listed.map((slot, i) =>
      i < NAMED.length + iterators.length ? held(slot[0], slot[1]) : undefined,
    )
    const kinds = listed.map((slot, i) =>
      i < NAMED.length + iterators.length ? kindOf(slot[0], slot[1]) : 0,
    )
    // `concat` and `map` are the process's own, and a process polluted before the import can make them answer what it likes:
    // a list or a record of the wrong size is not a baseline.
    if (
      listed.length !== NAMED.length + iterators.length + ABSENT.length ||
      recorded.length !== listed.length ||
      kinds.length !== listed.length
    ) {
      return undefined
    }
    return { listed, recorded, kinds }
  } catch {
    return undefined
  }
}

const baseline = readBaseline()

/** The built-ins the library calls, each with where it is held; empty when the process could not be read at load. */
export const BUILTIN_SLOTS: readonly BuiltinSlot[] = baseline?.listed ?? []

/**
 * How many of the built-ins the library calls are not what they were when it loaded. A replaced one is counted, not
 * named: a host that can replace one has no need of the name, and the refusal must not carry what it replaced it with.
 */
export function replacedBuiltinCount(): number {
  if (baseline === undefined) return 1
  let count = 0
  for (let i = 0; i < baseline.listed.length; i += 1) {
    const slot = baseline.listed[i] as BuiltinSlot
    if (
      held(slot[0], slot[1]) !== baseline.recorded[i] ||
      kindOf(slot[0], slot[1]) !== baseline.kinds[i]
    )
      count += 1
  }
  return count
}

/** Marks the error this module throws, so that a `catch` that sorts failures can tell it from a store's own. */
const REFUSAL = Symbol('builtins-refusal')

/** Taken at load: the refusal is raised while `Object` may be the thing that was replaced. */
const defineProperty = Object.defineProperty

/**
 * Refuses, before the code that follows runs, when a built-in it calls was replaced after the library loaded: a replaced
 * `startsWith` or iterator makes a check pass or a loop end where it should not.
 *
 * @throws Error carrying `REALTIME_TRANSPORT_UNAVAILABLE`, with the count and nothing else.
 */
export function assertBuiltinsIntact(): void {
  const replaced = replacedBuiltinCount()
  if (replaced === 0) return
  throw refusal(
    `${replaced} built-in${replaced === 1 ? '' : 's'} the library calls ${replaced === 1 ? 'was' : 'were'} replaced after it was loaded`,
  )
}

/** The error both checks throw, marked so that {@link isBuiltinsRefusal} can tell it from a store's own failure. */
function refusal(message: string): Error {
  const error = realtimeError(REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE, message)
  defineProperty(error, REFUSAL, { __proto__: null, value: true } as PropertyDescriptor)
  return error
}

/**
 * The value an async function is about to return, after the baseline was checked and its whole prototype chain was
 * walked: returning an object from an async function makes the engine ask it for a `then`, and it asks the object's own
 * chain, which is a class, a `Buffer`, a typed array or a stream as often as a plain record. A `then` on any object of the
 * chain would answer for the value; it is refused, and no `then` is read, so none runs. It is the last thing evaluated
 * before the `return`, with nothing in between a host can run: a Proxy is refused before any of its traps is asked a
 * question, since a trap is host code. It is not a defence against a `then` that is put in
 * place after it returns. The walk uses the functions taken at load, not the ones on `Object`.
 *
 * @param value - What the function returns; a primitive is returned as it is.
 * @returns The same value.
 * @throws Error carrying `REALTIME_TRANSPORT_UNAVAILABLE` when a built-in was replaced or an object of the chain holds a
 *   `then` or is a Proxy.
 */
export function returnable<T>(value: T): T {
  assertBuiltinsIntact()
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value
  for (let node: unknown = value; node !== null; node = getProto(node as object)) {
    if (isProxy(node))
      throw refusal('an object a decision returns, or one it inherits from, is a Proxy')
    if (apply(hasOwn, node, ['then']) as boolean) {
      throw refusal('an object a decision returns, or one it inherits from, holds a then')
    }
  }
  return value
}

/**
 * Whether `error` is the refusal {@link assertBuiltinsIntact} throws. The mark is a symbol private to this module, so
 * a failure of a host's own cannot carry it, and it stays true after the replaced built-in was put back.
 */
export function isBuiltinsRefusal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[REFUSAL] === true
  )
}
