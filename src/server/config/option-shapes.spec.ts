/**
 * @fileoverview The pluggable pieces and the groups of the module options are checked for their shape at start-up.
 * @layer composition
 *
 * An implementation that lacks a required function, a hook that is not a function, a group that is not an
 * object, a flag that is not a boolean and an endpoint that is not a non-blank string are each refused by
 * `forRoot` with `REALTIME_INVALID_OPTIONS`, naming the option and describing what it received by type, instead of
 * failing later as a raw `TypeError` or being read as the opposite of what they say.
 */
import { BymaxRealtimeModule } from '../realtime.module'
import { validateOptions } from './validate-options'
import { validateShapes } from './validate-shapes'

const SENTINEL = 'SENTINEL-5c21d7'
const authenticator = { authenticate: async () => null }
const noop = async (): Promise<void> => undefined

/** A complete implementation of each pluggable piece, to take one function away at a time. */
const PUBSUB = { publish: noop, subscribe: async () => noop }
const OFFLINE_QUEUE = { append: noop, retrieveSince: async () => [], acknowledge: noop }
const PRESENCE = {
  setOnline: noop,
  setOffline: noop,
  isOnline: async () => false,
  listOnlineByTenant: async () => [],
  countOnline: async () => 0,
}

/** The message `validateOptions` throws for `path` holding something other than `expected`. */
const refusal = (path: string, expected: string, received: string): Error =>
  new Error(
    `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.${path} must be ${expected}, received ${received}`,
  )

/** Build the options with `value` at a path of one or two segments. */
function optionsWith(path: string, value: unknown, base: Record<string, unknown> = {}): never {
  const options: Record<string, unknown> = { transport: 'sse', authenticator, ...base }
  const [head, tail] = path.split('.') as [string, string | undefined]
  if (tail === undefined) options[head] = value
  else options[head] = { ...(options[head] as object | undefined), [tail]: value }
  return options as never
}

/** What a host could hand over where an object is expected, and what each reads as in the message. */
const NOT_AN_OBJECT: ReadonlyArray<readonly [unknown, string]> = [
  [SENTINEL, 'a string'],
  [7, '7'],
  [true, 'a boolean'],
  [[SENTINEL], 'an array'],
  [Symbol(SENTINEL), 'a symbol'],
  [() => SENTINEL, 'a function'],
]

/** What a host could hand over where a function is expected. */
const NOT_A_FUNCTION: ReadonlyArray<readonly [unknown, string]> = [
  [SENTINEL, 'a string'],
  [7, '7'],
  [true, 'a boolean'],
  [{ call: SENTINEL }, 'an object'],
  [[SENTINEL], 'an array'],
  [Symbol(SENTINEL), 'a symbol'],
]

describe.each([
  'sse',
  'websocket',
  'reauthenticationPolicy',
  'hooks',
  'pubsub',
  'offlineQueue',
  'presence',
])('%s', (path) => {
  // Scenario: the option holds something that is not an object. Expected: refused, by type, and
  // nothing the value held is echoed.
  it.each(NOT_AN_OBJECT)('refuses %p where an object is expected', (value, received) => {
    expect(() => validateOptions(optionsWith(path, value))).toThrow(
      refusal(path, 'an object', received),
    )
  })
})

describe.each([
  ['pubsub', PUBSUB, ['publish', 'subscribe']],
  ['offlineQueue', OFFLINE_QUEUE, ['append', 'retrieveSince', 'acknowledge']],
  [
    'presence',
    PRESENCE,
    ['setOnline', 'setOffline', 'isOnline', 'listOnlineByTenant', 'countOnline'],
  ],
] as const)('the %s implementation', (name, whole, required) => {
  it('is accepted when every required function is present', () => {
    expect(() => validateOptions(optionsWith(name, { ...whole }))).not.toThrow()
  })

  it('is accepted as a class instance whose functions are on the prototype', () => {
    class Implementation {}
    for (const key of required) {
      ;(Implementation.prototype as unknown as Record<string, unknown>)[key] = noop
    }

    expect(() => validateOptions(optionsWith(name, new Implementation()))).not.toThrow()
  })

  // Scenario: one required function is missing, or is not a function. Expected: refused by name.
  it.each(required)('refuses %s when it is missing', (fn) => {
    const without = { ...whole } as Record<string, unknown>
    delete without[fn]

    expect(() => validateOptions(optionsWith(name, without))).toThrow(
      refusal(`${name}.${fn}`, 'a function', 'undefined'),
    )
  })

  it.each(required)('refuses %s when it is not a function', (fn) => {
    for (const [value, received] of NOT_A_FUNCTION) {
      expect(() => validateOptions(optionsWith(`${name}.${fn}`, value, { [name]: whole }))).toThrow(
        refusal(`${name}.${fn}`, 'a function', received),
      )
    }
  })
})

describe('the lifecycle hooks and the tenant resolver', () => {
  it.each([
    'onConnect',
    'onDisconnect',
    'onError',
    'onReauthenticationFailed',
    'onDeliveryFailure',
  ])('refuses hooks.%s when it is not a function', (hook) => {
    for (const [value, received] of NOT_A_FUNCTION) {
      expect(() => validateOptions(optionsWith(`hooks.${hook}`, value))).toThrow(
        refusal(`hooks.${hook}`, 'a function', received),
      )
    }
  })

  it('accepts every hook as a function, and none at all', () => {
    expect(() =>
      validateOptions(
        optionsWith('hooks', {
          onConnect: noop,
          onDisconnect: noop,
          onError: noop,
          onReauthenticationFailed: noop,
          onDeliveryFailure: noop,
        }),
      ),
    ).not.toThrow()
    expect(() => validateOptions(optionsWith('hooks', {}))).not.toThrow()
  })

  it('refuses a tenantResolver that is not a function', () => {
    for (const [value, received] of NOT_A_FUNCTION) {
      expect(() => validateOptions(optionsWith('tenantResolver', value))).toThrow(
        refusal('tenantResolver', 'a function', received),
      )
    }
  })

  it('accepts a tenantResolver that is a function', () => {
    expect(() => validateOptions(optionsWith('tenantResolver', () => 't'))).not.toThrow()
  })
})

describe.each(['sse.emitConnectionEvent', 'websocket.emitConnectionEvent'])('%s', (path) => {
  // Scenario: a flag that is not a boolean ("no" is truthy). Expected: refused, not read as true.
  it.each([
    [SENTINEL, 'a string'],
    [0, '0'],
    [1, '1'],
    [{}, 'an object'],
    [[], 'an array'],
  ])('refuses %p where a boolean is expected', (value, received) => {
    expect(() => validateOptions(optionsWith(path, value))).toThrow(
      refusal(path, 'a boolean', received),
    )
  })

  it.each([true, false])('accepts %p', (value) => {
    expect(() => validateOptions(optionsWith(path, value))).not.toThrow()
  })
})

describe('sse.endpoint', () => {
  // Scenario: an endpoint that is not a non-blank string. Expected: refused with a typed error naming the option.
  it.each([
    ['', 'a string'],
    ['   ', 'a string'],
    ['\t\n', 'a string'],
    [5, '5'],
    [true, 'a boolean'],
    [['/x'], 'an array'],
    [{}, 'an object'],
  ])('refuses %p', (value, received) => {
    expect(() => validateOptions(optionsWith('sse.endpoint', value))).toThrow(
      refusal('sse.endpoint', 'a non-blank string', received),
    )
  })

  // A leading slash is not required: `@Sse()` reads 'events' and '/events' as the same route.
  it.each(['/', '/events', '/realtime/sse', 'events'])('accepts %s', (value) => {
    expect(() => validateOptions(optionsWith('sse.endpoint', value))).not.toThrow()
  })
})

describe('forRoot', () => {
  // Scenario: an implementation without its required functions. Expected: forRoot itself refuses it with
  // the stable code, not the application at init.
  it.each([
    ['pubsub', {}],
    ['offlineQueue', {}],
    ['presence', {}],
    ['hooks', 'x'],
    ['sse', 'x'],
  ])('refuses %s %p at registration, with the stable code', (path, value) => {
    expect(() => BymaxRealtimeModule.forRoot(optionsWith(path, value))).toThrow(
      'REALTIME_INVALID_OPTIONS',
    )
  })
})

describe('what the refusals never echo', () => {
  it.each([
    'sse',
    'websocket',
    'reauthenticationPolicy',
    'hooks',
    'pubsub',
    'offlineQueue',
    'presence',
    'tenantResolver',
    'sse.emitConnectionEvent',
    'hooks.onConnect',
    'pubsub.publish',
  ])('%s does not print what it was given', (path) => {
    let message = ''
    try {
      validateOptions(
        optionsWith(path, SENTINEL, path.startsWith('pubsub.') ? { pubsub: PUBSUB } : {}),
      )
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain(`options.${path}`)
    expect(message).not.toContain(SENTINEL)
  })
})

describe('validateShapes called on options that still hold null', () => {
  // `validateOptions` drops null before it calls `validateShapes`, so these cases call it directly: a
  // null group or piece is not an object, and a null hook or resolver is unset.
  it.each([
    'sse',
    'websocket',
    'reauthenticationPolicy',
    'hooks',
    'pubsub',
    'offlineQueue',
    'presence',
  ])('refuses %s set to null as not an object', (name) => {
    expect(() =>
      validateShapes({ transport: 'sse', authenticator, [name]: null } as never),
    ).toThrow(refusal(name, 'an object', 'null'))
  })

  it.each([
    'onConnect',
    'onDisconnect',
    'onError',
    'onReauthenticationFailed',
    'onDeliveryFailure',
  ])('reads hooks.%s set to null as unset', (hook) => {
    expect(() =>
      validateShapes({ transport: 'sse', authenticator, hooks: { [hook]: null } } as never),
    ).not.toThrow()
  })

  it('reads a tenantResolver set to null as unset', () => {
    expect(() =>
      validateShapes({ transport: 'sse', authenticator, tenantResolver: null } as never),
    ).not.toThrow()
  })
})

describe('websocket.cors', () => {
  const corsOptions = (cors: unknown): never =>
    ({ transport: 'websocket', authenticator, websocket: { cors } }) as never

  // Scenario: an origin that is present and holds nothing. Expected: refused, naming the option, because the
  // library cannot tell it from an allowlist that was meant to be there.
  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
  ])('refuses an origin that is set to %p', (origin, received) => {
    expect(() => validateOptions(corsOptions({ origin }))).toThrow(
      refusal(
        'websocket.cors.origin',
        'a string, a RegExp, a function, an array or false',
        received,
      ),
    )
  })

  // Scenario: an origin of undefined that is not an enumerable own key. Expected: refused like the plain key.
  it.each([
    [
      'a non-enumerable own property',
      () => Object.defineProperty({}, 'origin', { value: undefined }),
    ],
    [
      'a getter on the prototype',
      () =>
        new (class {
          get origin(): undefined {
            return undefined
          }
        })(),
    ],
  ])('refuses an origin of undefined held as %s', (_name, build) => {
    expect(() => validateOptions(corsOptions(build()))).toThrow(
      refusal(
        'websocket.cors.origin',
        'a string, a RegExp, a function, an array or false',
        'undefined',
      ),
    )
  })

  // Scenario: no origin key. Expected: accepted, the documented `*`.
  it('accepts a block with no origin', () => {
    expect(() => validateOptions(corsOptions({ credentials: true }))).not.toThrow()
  })

  // Scenario: credentials that is a truthy or falsy non-boolean. Expected: refused, not ignored.
  it.each([
    ['true', 'a string'],
    ['false', 'a string'],
    [1, '1'],
    [{}, 'an object'],
  ])('refuses credentials %p', (value, received) => {
    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', credentials: value })),
    ).toThrow(refusal('websocket.cors.credentials', 'a boolean', received))
  })

  it.each([true, false])('accepts credentials %p', (value) => {
    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', credentials: value })),
    ).not.toThrow()
  })
})
