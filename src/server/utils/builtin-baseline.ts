/**
 * @fileoverview The built-ins the option, validation and admission paths call, recorded when the library loads and compared by identity.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { realtimeError } from './realtime-error'

/** One built-in the library calls: the object that holds it and its key. */
export type BuiltinSlot = readonly [target: object, key: PropertyKey]

const describe = Object.getOwnPropertyDescriptor
const hasOwn = Object.prototype.hasOwnProperty
const apply = Reflect.apply

/** What a slot holds when it is not a data property: nothing a recorded value can equal, so such a slot counts as replaced. */
const NOT_DATA = {}

/**
 * What a slot holds. A descriptor is an ordinary object, so a field it does not hold itself is answered by the root
 * prototype: `value` is read only when the descriptor holds it, and an accessor, which holds none, is {@link NOT_DATA}.
 */
function held(target: object, key: PropertyKey): unknown {
  const descriptor = describe(target, key)
  if (descriptor === undefined) return undefined
  return (apply(hasOwn, descriptor, ['value']) as boolean) ? descriptor.value : NOT_DATA
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
  [Array, 'isArray'],
  [Array.prototype, 'concat'],
  [Array.prototype, 'every'],
  [Array.prototype, 'filter'],
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

/** The prototypes behind `for...of`, spread and destructuring, which no name in the source calls. */
function iteratorSlots(): BuiltinSlot[] {
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]()) as object
  const stringIterator = Object.getPrototypeOf(''[Symbol.iterator]()) as object
  const setIterator = Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object
  return [
    [arrayIterator, 'next'],
    [stringIterator, 'next'],
    [setIterator, 'next'],
  ]
}

/**
 * What each slot held when the library loaded. A process polluted before the import can make the work of listing and
 * recording throw: that is caught, the list is empty, and every use is refused with a count of one, rather than the
 * import failing.
 */
let broken = false
let listed: BuiltinSlot[] = []
const recorded: unknown[] = []
try {
  const iterators = iteratorSlots()
  for (let i = 0; i < NAMED.length; i += 1) listed[i] = NAMED[i] as BuiltinSlot
  for (let i = 0; i < iterators.length; i += 1)
    listed[NAMED.length + i] = iterators[i] as BuiltinSlot
  for (let i = 0; i < listed.length; i += 1) {
    const slot = listed[i] as BuiltinSlot
    recorded[i] = held(slot[0], slot[1])
  }
} catch {
  broken = true
  listed = []
}

/** The built-ins the library calls, each with where it is held; empty when the process could not be read at load. */
export const BUILTIN_SLOTS: readonly BuiltinSlot[] = listed

/**
 * How many of the built-ins the library calls are not what they were when it loaded. A replaced one is counted, not
 * named: a host that can replace one has no need of the name, and the refusal must not carry what it replaced it with.
 */
export function replacedBuiltinCount(): number {
  if (broken) return 1
  let count = 0
  for (let i = 0; i < BUILTIN_SLOTS.length; i += 1) {
    const slot = BUILTIN_SLOTS[i] as BuiltinSlot
    if (held(slot[0], slot[1]) !== recorded[i]) count += 1
  }
  return count
}

/**
 * Refuses, before the code that follows runs, when a built-in it calls was replaced after the library loaded: a replaced
 * `startsWith` or iterator makes a check pass or a loop end where it should not.
 *
 * @throws Error carrying `REALTIME_TRANSPORT_UNAVAILABLE`, with the count and nothing else.
 */
export function assertBuiltinsIntact(): void {
  const replaced = replacedBuiltinCount()
  if (replaced === 0) return
  throw realtimeError(
    REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
    `${replaced} built-in${replaced === 1 ? '' : 's'} the library calls ${replaced === 1 ? 'was' : 'were'} replaced after it was loaded`,
  )
}
