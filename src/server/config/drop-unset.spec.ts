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

    expect(result).toStrictEqual({
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
