/**
 * @fileoverview `dropUnset` removes the own keys that hold nothing, in the options and in each group.
 * @layer composition
 */
import type { CorsConfig } from '../interfaces/realtime-module-options.interface'
import { dropUnset } from './drop-unset'

describe('dropUnset', () => {
  // Scenario: undefined and null at the top level and in the three groups. Expected: those keys are
  // absent from the copy, and every other key keeps its value.
  it('removes undefined and null keys at the top level and in every group', () => {
    const result = dropUnset({
      maxConnections: undefined,
      hookTimeoutMs: null,
      authenticateTimeoutMs: 5,
      sse: { heartbeatMs: undefined, replayBufferSize: null, maxQueuedEvents: 0 },
      websocket: { maxConnectionsPerUser: undefined, namespace: '/x' },
      reauthenticationPolicy: { concurrency: null, intervalSeconds: 60 },
    })

    expect(structuredClone(result)).toStrictEqual({
      authenticateTimeoutMs: 5,
      sse: { maxQueuedEvents: 0 },
      websocket: { namespace: '/x' },
      reauthenticationPolicy: { intervalSeconds: 60 },
    })
  })

  // Scenario: values that carry behaviour. Expected: they are kept by reference, not copied.
  it('keeps the authenticator and the hooks by reference', () => {
    const authenticator = { authenticate: async () => null }
    const hooks = { onConnect: () => undefined }
    const result = dropUnset({ authenticator, hooks })

    expect(result.authenticator).toBe(authenticator)
    expect(result.hooks).toBe(hooks)
  })

  // Scenario: a group that is a string, a number or an array. Expected: it is left as it is.
  it.each([['text'], [5], [[1]]])('leaves the group %p untouched', (group) => {
    expect(dropUnset({ sse: group }).sse).toBe(group)
  })

  it('does not change what it was given', () => {
    const given = { sse: { heartbeatMs: undefined } }

    dropUnset(given)

    expect(given).toStrictEqual({ sse: { heartbeatMs: undefined } })
  })
})

describe('dropUnset, the CORS block of websocket', () => {
  const ORIGIN = ['https://good.example']

  /** The ways a host can define `origin`; each is readable by property access and invisible to a spread. */
  const shapes: ReadonlyArray<readonly [string, () => object]> = [
    ['an own data property', () => ({ origin: ORIGIN, credentials: true })],
    [
      'a class getter',
      () =>
        new (class {
          credentials = true
          get origin(): readonly string[] {
            return ORIGIN
          }
        })(),
    ],
    [
      'a non-enumerable property',
      () => Object.defineProperties({ credentials: true }, { origin: { value: ORIGIN } }),
    ],
    [
      'a non-enumerable getter',
      () =>
        Object.defineProperties(
          { credentials: true },
          { origin: { get: () => ORIGIN, enumerable: false } },
        ),
    ],
    [
      'a prototype property',
      () => Object.assign(Object.create({ origin: ORIGIN }), { credentials: true }),
    ],
    [
      'a prototype getter',
      () =>
        Object.assign(Object.create(Object.defineProperty({}, 'origin', { get: () => ORIGIN })), {
          credentials: true,
        }),
    ],
  ]

  // Scenario: the allowlist is defined in a way a spread cannot copy. Expected: the record the library keeps
  // still names it, so the Socket.IO server never falls back to "any origin".
  it.each(shapes)('keeps origin and credentials when origin is %s', (_name, build) => {
    const cors = dropUnset({ websocket: { cors: build() } }).websocket?.cors

    expect({ ...cors }).toStrictEqual({ origin: ORIGIN, credentials: true })
  })

  // Scenario: methods supplied the same way, and a key the interface does not name. Expected: both kept.
  it('keeps methods from a prototype and an enumerable key the interface does not name', () => {
    const cors = dropUnset({
      websocket: {
        cors: Object.assign(Object.create({ methods: ['GET'] }), { allowedHeaders: 'x' }),
      },
    }).websocket?.cors

    expect({ ...cors }).toStrictEqual({ methods: ['GET'], allowedHeaders: 'x' })
  })

  // Scenario: the block holds nothing for a key other than the origin. Expected: the key is absent, as at every
  // other level.
  it('drops an unset key of the block', () => {
    const cors = dropUnset({ websocket: { cors: { credentials: null, methods: undefined } } })
      .websocket?.cors

    expect({ ...cors }).toStrictEqual({})
  })

  // Scenario: the origin is set to nothing. Expected: it stays in the copy, so validation can refuse it; read as
  // unset it would answer every origin. An origin that is not set at all stays absent.
  it.each([
    ['null', { origin: null }, { origin: null }],
    ['undefined as a key of its own', { origin: undefined }, { origin: undefined }],
    ['absent', {}, {}],
  ])('keeps an origin that is %s as the host set it', (_name, cors, expected) => {
    const kept = dropUnset({ websocket: { cors } }).websocket?.cors

    expect({ ...kept }).toStrictEqual(expected)
  })

  // Scenario: an object that is not a plain one, such as an Error, an array or a Map, and holds none of the CORS names.
  // Expected: left as it is, so validation refuses it; copied, it would read as an empty block and answer every
  // origin. One that holds a CORS name is read like any other block.
  it.each([
    ['an Error', () => new Error('x')],
    ['an array', () => ['https://a.example']],
    ['a Map', () => new Map([['origin', 'https://a.example']])],
  ])('leaves %s without a CORS name as it is', (_name, build) => {
    const cors = build()

    expect(dropUnset({ websocket: { cors } }).websocket?.cors).toBe(cors)
  })

  it('reads an object that is not a plain one when it holds a CORS name', () => {
    const cors = Object.assign(new Error('x'), { origin: 'https://a.example' })

    const kept = dropUnset({ websocket: { cors } }).websocket?.cors

    expect({ ...kept }).toStrictEqual({ origin: 'https://a.example' })
  })

  // Scenario: a get-only proxy over an empty target that answers `null` for the origin, so the property is not
  // there for `in` to find. Expected: `null` is a value the host set whatever the object reports, so it stays.
  it('keeps an origin of null that a proxy answers without having the property', () => {
    const cors = new Proxy({}, { get: (_target, key) => (key === 'origin' ? null : undefined) })

    const kept = dropUnset({ websocket: { cors } }).websocket?.cors as { origin?: unknown }

    expect(kept.origin).toBeNull()
  })

  // Scenario: an origin that is set to undefined without being an enumerable own key: a non-enumerable property, a
  // getter on the prototype, a field a class declared. Expected: kept like the plain own key, because it is just as
  // much a value the host set; read as unset it would answer every origin.
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
    [
      'a field a class declared',
      () =>
        new (class {
          origin: string | undefined = undefined
        })(),
    ],
  ])('keeps an origin of undefined held as %s', (_name, build) => {
    const kept = dropUnset({ websocket: { cors: build() } }).websocket?.cors as object

    expect('origin' in kept).toBe(true)
  })

  // Scenario: a block that is not an object. Expected: left as it is.
  it.each([[true], ['*'], [[1]]])('leaves the block %p untouched', (cors) => {
    expect(dropUnset({ websocket: { cors: cors as CorsConfig } }).websocket?.cors).toBe(cors)
  })

  // Scenario: the hook table, in each of the shapes. Expected: the host's own object, so every hook still runs.
  it.each([
    [
      'a class getter',
      () =>
        new (class {
          get onConnect() {
            return () => 'ran'
          }
        })(),
    ],
    [
      'a non-enumerable property',
      () => Object.defineProperty({}, 'onConnect', { value: () => 'ran' }),
    ],
    ['a prototype property', () => Object.create({ onConnect: () => 'ran' }) as object],
  ])('hands the hook table over as it is when a hook is %s', (_name, build) => {
    const hooks = build()
    const kept = dropUnset({ hooks }).hooks as { onConnect?: () => string }

    expect(kept).toBe(hooks)
    expect(kept.onConnect?.()).toBe('ran')
  })
})

describe('dropUnset, the built-ins the copy of a list relies on', () => {
  // Scenario: Array.isArray, Number.isInteger, Object.freeze and Array.prototype.push replaced after the module loaded.
  // Expected: the copy of a list touches none of them, so a host that replaced one cannot change or watch it. The
  // assertions run after the built-ins are put back, because the test framework uses them too.
  it('does not call the live Array.isArray, Number.isInteger, Object.freeze or Array.prototype.push', () => {
    const calls: string[] = []
    const originals = {
      isArray: Array.isArray,
      isInteger: Number.isInteger,
      freeze: Object.freeze,
      push: Array.prototype.push,
    }
    Array.isArray = ((value: unknown): boolean => {
      calls.push('isArray')
      return originals.isArray(value)
    }) as typeof Array.isArray
    Number.isInteger = ((value: unknown): boolean => {
      calls.push('isInteger')
      return originals.isInteger(value)
    }) as typeof Number.isInteger
    Object.freeze = ((value: unknown): unknown => {
      calls.push('freeze')
      return originals.freeze(value as object)
    }) as typeof Object.freeze
    Array.prototype.push = function (this: unknown[], ...items: unknown[]): number {
      calls.push('push')
      return originals.push.apply(this, items)
    }
    let copy: { websocket?: { cors?: { origin?: unknown; allowedHeaders?: unknown } } } | undefined
    try {
      copy = dropUnset({
        websocket: { cors: { origin: ['https://a.example'], allowedHeaders: ['x-a'] } },
      })
    } finally {
      Array.isArray = originals.isArray
      Number.isInteger = originals.isInteger
      Object.freeze = originals.freeze
      Array.prototype.push = originals.push
    }

    expect(calls).toStrictEqual([])
    expect(copy?.websocket?.cors?.origin).toStrictEqual(['https://a.example'])
    expect(copy?.websocket?.cors?.allowedHeaders).toStrictEqual(['x-a'])
  })
})
