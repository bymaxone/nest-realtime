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

const METHODS_KINDS = 'a string or a list of at most 1000 strings'
const ORIGIN_KINDS = 'a string, a RegExp, a function, an array of strings and RegExps, or a boolean'

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
      refusal('websocket.cors.origin', ORIGIN_KINDS, received),
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
      refusal('websocket.cors.origin', ORIGIN_KINDS, 'undefined'),
    )
  })

  // Scenario: `validateShapes` is called on its own with a null block. Expected: nothing to check, and no
  // TypeError from looking an origin up on null. A block that is a string is refused, not left to the other checks.
  it('leaves a cors block of null to the other checks', () => {
    expect(() =>
      validateShapes({ transport: 'websocket', authenticator, websocket: { cors: null } } as never),
    ).not.toThrow()
  })

  // Scenario: an origin whose `in` lookup throws, on a proxy that answers `undefined` for the name. Expected: the
  // refusal with the host's error as the cause, as for any read of the options.
  it('refuses a cors block whose has trap throws, with the host error as the cause', () => {
    const host = new Error('has boom')
    const cors = new Proxy(
      {},
      {
        get: () => undefined,
        has: () => {
          throw host
        },
      },
    )
    let caught: unknown
    try {
      validateOptions(corsOptions(cors))
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).cause).toBe(host)
  })

  // Scenario: kinds of origin Socket.IO reads as any origin. Expected: refused naming the option.
  it.each([
    [{}, 'an object'],
    [5, 'a number'],
    [[1], 'an array'],
    [[{}], 'an array'],
    [['https://a.example', false], 'an array'],
  ])('refuses an origin of %p', (origin, received) => {
    expect(() => validateOptions(corsOptions({ origin }))).toThrow(
      refusal('websocket.cors.origin', ORIGIN_KINDS, received),
    )
  })

  // Scenario: an origin list whose length is not a count of at most 1,000 entries, or that has a hole. Expected:
  // refused; the list is copied once, so a length that is read is a length that is checked.
  it.each([
    ['1,001 entries', () => Array.from({ length: 1001 }, () => 'https://a.example')],
    ['a hole', () => new Array<string>(2).fill('https://a.example', 0, 1)],
    [
      'a length that is not an integer',
      () =>
        new Proxy(['https://a.example'], {
          get: (t, k, r) => (k === 'length' ? 1.5 : Reflect.get(t, k, r)),
        }),
    ],
    [
      'a negative length',
      () =>
        new Proxy(['https://a.example'], {
          get: (t, k, r) => (k === 'length' ? -1 : Reflect.get(t, k, r)),
        }),
    ],
  ])('refuses an origin list of %s', (_name, build) => {
    expect(() => validateOptions(corsOptions({ origin: build() }))).toThrow(
      'options.websocket.cors.origin must be',
    )
  })

  // Scenario: the refusal of a list length, whole. Expected: it names the module and the code as every other
  // refusal does, the option, the kinds and the length it read.
  it.each([
    [1001, () => Array.from({ length: 1001 }, () => 'https://a.example')],
    [
      1.5,
      () =>
        new Proxy(['https://a.example'], {
          get: (t, k, r) => (k === 'length' ? 1.5 : Reflect.get(t, k, r)),
        }),
    ],
    [
      -1,
      () =>
        new Proxy(['https://a.example'], {
          get: (t, k, r) => (k === 'length' ? -1 : Reflect.get(t, k, r)),
        }),
    ],
  ])('refuses an origin list whose length is %p with the module and the code', (_length, build) => {
    expect(() => validateOptions(corsOptions({ origin: build() }))).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.origin must be ${ORIGIN_KINDS}, received a list whose length is not an integer from 0 to 1000`,
      ),
    )
  })

  // Scenario: the same refusal for `methods`, whole. Expected: the module, the code, the option and the kinds, and
  // no length in the text.
  it.each([
    [1001, () => Array.from({ length: 1001 }, () => 'GET')],
    [
      1.5,
      () => new Proxy(['GET'], { get: (t, k, r) => (k === 'length' ? 1.5 : Reflect.get(t, k, r)) }),
    ],
  ])('refuses a methods list whose length is %p with the module and the code', (_length, build) => {
    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', methods: build() })),
    ).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.methods must be ${METHODS_KINDS}, received a list whose length is not an integer from 0 to 1000`,
      ),
    )
  })

  // Scenario: a RegExp that is not a plain one, alone or in a list, refused whole. Expected: the module, the code,
  // the option, the kinds and the way out, which is a function.
  it.each([
    ['a subclass', () => new (class Mine extends RegExp {})('x')],
    ['a subclass in a list', () => [new (class Mine extends RegExp {})('x')]],
    ['one with a test of its own', () => Object.assign(/x/, { test: () => true })],
    ['a sticky one', () => /x/y],
  ])('refuses %s with the way out', (_name, build) => {
    expect(() => validateOptions(corsOptions({ origin: build() }))).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.origin must be ${ORIGIN_KINDS}, received a RegExp, or an object that looks like one, that cannot be copied faithfully: a subclass, one with a property of its own, one from another realm, one with the y flag, one whose source is longer than 1000 characters, a proxy over one or an object that only has its prototype: use a function origin for custom matching`,
      ),
    )
  })

  // Scenario: an origin that is a Proxy whose reads all throw, so it cannot be told to be a RegExp or not. Expected:
  // refused as an origin of a kind that is not allowed, without the host's text and without the way out.
  it('refuses an origin whose reads throw, without the host text', () => {
    const origin = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('host text')
        },
        get: () => {
          throw new Error('host text')
        },
      },
    )

    expect(() => validateOptions(corsOptions({ origin }))).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.origin must be ${ORIGIN_KINDS}, received a built-in object`,
      ),
    )
  })

  it('accepts an origin list of exactly 1,000 entries', () => {
    const origin = Array.from({ length: 1000 }, () => 'https://a.example')

    expect(() => validateOptions(corsOptions({ origin }))).not.toThrow()
  })

  // Scenario: `methods` of a kind that is not a string or a list of strings, or a list over the bound. Expected:
  // refused, naming the option and the kind, never a number.
  it.each([
    [5, 'a number'],
    [{}, 'an object'],
    [['GET', 1], 'an array'],
    [['GET', {}], 'an array'],
  ])('refuses methods of %p', (methods, received) => {
    expect(() => validateOptions(corsOptions({ origin: 'https://a.example', methods }))).toThrow(
      refusal('websocket.cors.methods', METHODS_KINDS, received),
    )
  })

  // Scenario: `methods`, `allowedHeaders` and `exposedHeaders` hold header tokens, which are strings. Expected: a value that is
  // not a string or a list of strings, and a list with an entry that is not a string (an object, a nested list, a
  // number, a hole), is refused whole with the type only, whichever of the three keys holds it.
  const TOKEN_KEYS = ['methods', 'allowedHeaders', 'exposedHeaders']
  const wrongTokens: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['a number', () => 5, 'a number'],
    ['a Set', () => new Set(['x-a']), 'a built-in object'],
    ['an object', () => ({}), 'an object'],
    ['a list holding an object', () => ['x-a', {}], 'an array'],
    ['a list holding a nested list', () => ['x-a', ['x-b']], 'an array'],
    ['a list holding a number', () => ['x-a', 1], 'an array'],
    ['a list with a hole', () => new Array<string>(2).fill('x-a', 0, 1), 'an array'],
  ]

  describe.each(TOKEN_KEYS)('%s', (key) => {
    it.each(wrongTokens)('refuses %s', (_name, build, received) => {
      expect(() =>
        validateOptions(corsOptions({ origin: 'https://a.example', [key]: build() })),
      ).toThrow(refusal(`websocket.cors.${key}`, METHODS_KINDS, received))
    })

    it.each([['x-a,x-b'], [['x-a', 'x-b']], [[]]])('accepts %p', (value) => {
      expect(() =>
        validateOptions(corsOptions({ origin: 'https://a.example', [key]: value })),
      ).not.toThrow()
    })
  })

  it('refuses a methods list of more than 1,000 entries, without printing the count', () => {
    const methods = Array.from({ length: 1001 }, () => 'GET')

    expect(() => validateOptions(corsOptions({ origin: 'https://a.example', methods }))).toThrow(
      'options.websocket.cors.methods must be a string or a list of at most 1000 strings, received a list whose length is not an integer from 0 to 1000',
    )
  })

  it.each([['GET,POST'], [['GET', 'POST']], [[]]])('accepts methods of %p', (methods) => {
    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', methods })),
    ).not.toThrow()
  })

  // Scenario: Array.isArray replaced after the module loaded, to say yes to everything. Expected: validation refuses
  // first, with the count of built-ins replaced, so an object for allowedHeaders, exposedHeaders, methods or origin is not
  // read as a list whose length is undefined. The assertions run after the built-in is put back.
  it.each(['allowedHeaders', 'exposedHeaders', 'methods', 'origin'])(
    'still refuses an object for %s when Array.isArray now says yes',
    (key) => {
      const original = Array.isArray
      let outcome: unknown
      Array.isArray = ((_value: unknown): boolean => true) as typeof Array.isArray
      try {
        outcome = (() => {
          try {
            validateOptions(corsOptions({ origin: 'https://a.example', [key]: {} }))
            return 'accepted'
          } catch (error) {
            return (error as { code?: string }).code
          }
        })()
      } finally {
        Array.isArray = original
      }

      expect(outcome).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    },
  )

  // Scenario: a headers list over the bound, or with a length that is not a count. Expected: refused whole, as an
  // origin list or a methods list is, whichever of the two keys holds it.
  it.each(['allowedHeaders', 'exposedHeaders'])('refuses an over-long %s list, whole', (key) => {
    const list = Array.from({ length: 1001 }, () => 'x-a')

    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', [key]: list })),
    ).toThrow(
      new Error(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.cors.${key} must be ${METHODS_KINDS}, received a list whose length is not an integer from 0 to 1000`,
      ),
    )
  })

  // Scenario: a key the options do not name. Expected: accepted; that it reaches Socket.IO is shown by a real
  // preflight in the handshake spec.
  it('accepts a key it does not name', () => {
    expect(() =>
      validateOptions(corsOptions({ origin: 'https://a.example', allowedHeaders: 'x-token' })),
    ).not.toThrow()
  })

  // Scenario: the kinds an origin may be. Expected: accepted.
  it.each([
    ['https://a.example'],
    [/a\.example$/],
    [() => undefined],
    [['https://a.example', /b\.example$/]],
    [[]],
    [true],
    [false],
  ])('accepts an origin of %p', (origin) => {
    expect(() => validateOptions(corsOptions({ origin }))).not.toThrow()
  })

  // Scenario: a cors block that is present and not an object. Expected: refused; an absent or null one is left to
  // Socket.IO's own default, which sends no CORS header.
  it.each([
    ['a', 'a string'],
    [5, 'a number'],
    [true, 'a boolean'],
    [false, 'a boolean'],
    [[], 'an array'],
    [new Map(), 'a built-in object'],
    [new Error('x'), 'a built-in object'],
    [new Date(0), 'a built-in object'],
    [new Set(), 'a built-in object'],
    [Promise.resolve(), 'a built-in object'],
    [new (class Tagged extends Map<string, string> {})(), 'a built-in object'],
  ])('refuses a cors block of %p', (cors, received) => {
    expect(() => validateOptions(corsOptions(cors))).toThrow(
      refusal('websocket.cors', 'an object', received),
    )
  })

  it.each([undefined, null])('accepts a cors block of %p', (cors) => {
    expect(() => validateOptions(corsOptions(cors))).not.toThrow()
  })

  // Scenario: no origin key. Expected: accepted, the documented `*`.
  it('accepts a block with no origin', () => {
    expect(() => validateOptions(corsOptions({ credentials: true }))).not.toThrow()
  })

  // Scenario: credentials that is a truthy or falsy non-boolean. Expected: refused, not ignored.
  it.each([
    ['true', 'a string'],
    ['false', 'a string'],
    [1, 'a number'],
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
