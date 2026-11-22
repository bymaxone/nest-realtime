/**
 * @fileoverview The reads of the options, and the check of maxAge and extraProviders, do not depend on a built-in a host replaced.
 * @layer composition
 *
 * A host that replaces `Object.keys`, `Object.entries`, `Object.freeze`, `Object.prototype.toString`, the iterator of
 * an array, `Set`, `Array.isArray` or `Array.prototype.forEach` after the library was imported must not be able to
 * drop an option of the cors block, leave the resolved options unfrozen or let an invalid `extraProviders` through.
 * Each row replaces one built-in, runs the call, puts the built-in back and only then asserts, because the test
 * runner uses the same built-ins.
 */
import { assertExtraProviders } from './validate-shapes'
import { applyDefaults } from './default-options'
import { dropUnset } from './drop-unset'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }

/** The options of a WebSocket host with a complete cors block. */
const options = (cors: Record<string, unknown> = {}): never =>
  ({
    transport: 'websocket',
    authenticator,
    websocket: {
      namespace: undefined,
      cors: { origin: 'https://a.example', credentials: true, maxAge: 600, ...cors },
    },
  }) as never

/** What a call did with `target[key]` replaced by `stub`: its result, or the code of the error it threw. */
function withReplaced(
  target: object,
  key: PropertyKey,
  stub: unknown,
  call: () => unknown,
): { result?: unknown; code?: unknown; failure?: unknown } {
  const holder = target as Record<PropertyKey, unknown>
  const original = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor
  holder[key] = stub
  try {
    return { result: call() }
  } catch (error) {
    return { code: (error as { code?: unknown }).code, failure: error }
  } finally {
    Object.defineProperty(target, key, original)
  }
}

const throws = (): never => {
  throw new Error('replaced built-in was called')
}

const REPLACEMENTS: ReadonlyArray<readonly [string, object, PropertyKey, unknown]> = [
  ['Object.keys', Object, 'keys', () => []],
  ['Object.entries', Object, 'entries', () => []],
  ['Object.prototype.toString', Object.prototype, 'toString', () => '[object Other]'],
  ['the iterator of an array', Array.prototype, Symbol.iterator, throws],
  ['Set', globalThis, 'Set', throws],
]

describe('dropUnset does not use a built-in a host can replace', () => {
  // Scenario: one built-in the read of the options used is replaced after load. Expected: the cors block is read as
  // it is written: no option of it is dropped, and the one that holds nothing is.
  it.each(REPLACEMENTS)('keeps the cors block when %s is replaced', (_name, target, key, stub) => {
    const outcome = withReplaced(target, key, stub, () =>
      dropUnset(options({ methods: undefined })),
    )

    expect(outcome.failure).toBeUndefined()
    expect((outcome.result as { websocket: unknown }).websocket).toStrictEqual({
      cors: { origin: 'https://a.example', credentials: true, maxAge: 600 },
    })
  })

  // Scenario: Object.freeze replaced by a function that returns its argument unfrozen. Expected: the resolved
  // options are still frozen, as the one taken at load freezes them.
  it('freezes the resolved options when Object.freeze is replaced', () => {
    const outcome = withReplaced(
      Object,
      'freeze',
      (value: unknown) => value,
      () => applyDefaults(options()),
    )

    expect(outcome.failure).toBeUndefined()
    expect(Object.isFrozen(outcome.result)).toBe(true)
  })
})

describe('maxAge of the cors block', () => {
  const refusal = (received: string): Error =>
    new Error(
      `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.maxAge must be a non-negative integer, received ${received}`,
    )

  // Scenario: a maxAge that is not a count of seconds. Expected: refused at boot, naming the type and never the value.
  it.each([
    [-1, 'a number'],
    [1.5, 'a number'],
    [Number.NaN, 'a number'],
    [Number.POSITIVE_INFINITY, 'a number'],
    ['600', 'a string'],
    [true, 'a boolean'],
    [{}, 'an object'],
    [[600], 'an array'],
  ])('refuses %p', (maxAge, received) => {
    expect(() => validateOptions(options({ maxAge }))).toThrow(refusal(received))
  })

  // Scenario: a whole number of seconds, zero included, or none. Expected: accepted.
  it.each([[0], [600], [undefined]])('accepts %p', (maxAge) => {
    expect(() => validateOptions(options({ maxAge }))).not.toThrow()
  })
})

describe('extraProviders does not use a built-in a host can replace', () => {
  // Scenario: Array.isArray says yes to everything. Expected: an object is still refused, not iterated.
  it('refuses an object when Array.isArray says yes', () => {
    const outcome = withReplaced(
      Array,
      'isArray',
      () => true,
      () => assertExtraProviders({ x: 1 }),
    )

    expect(outcome.code).toBe('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: Array.prototype.forEach does nothing. Expected: an entry that is not a provider is still refused.
  it('refuses a bad entry when forEach does nothing', () => {
    const outcome = withReplaced(
      Array.prototype,
      'forEach',
      () => undefined,
      () => assertExtraProviders([null]),
    )

    expect(outcome.code).toBe('REALTIME_INVALID_OPTIONS')
  })
})
