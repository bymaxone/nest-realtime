/**
 * @fileoverview A key planted on `Object.prototype` is not an option the host set, and the copies the module reads from hold none.
 * @layer composition
 *
 * A host option that is absent can still answer a read when something planted a key of that name on the root
 * prototype of the realm (a merge of untrusted data does it). The rule is that a key found only on the realm-root
 * prototype is not read, while one a host's own class prototype defines still is, and that every copy the module
 * makes has no prototype to inherit a planted key from.
 */
import vm from 'node:vm'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../realtime.module'
import { applyDefaults } from './default-options'
import { dropUnset } from './drop-unset'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }

/** Every key the module reads from the options and from the groups, with a value that would change an outcome. */
const PLANTED: Readonly<Record<string, unknown>> = {
  transport: 'both',
  authenticator: { authenticate: async () => ({ userId: 'attacker' }) },
  tenantResolver: () => 'evil',
  hooks: { onConnect: () => undefined },
  hookTimeoutMs: 1,
  onConnectFailure: 'continue',
  authenticateTimeoutMs: 1,
  maxPendingHandshakes: 1,
  maxConnections: 1,
  pubsub: {},
  offlineQueue: {},
  presence: {},
  sse: { endpoint: '/evil' },
  websocket: { namespace: '/evil', cors: { origin: true, credentials: true } },
  reauthenticationPolicy: { intervalSeconds: 1 },
  cors: { origin: true, credentials: true },
  origin: true,
  credentials: true,
  methods: ['*'],
  allowedHeaders: ['*'],
  exposedHeaders: ['*'],
  maxAge: 1,
  endpoint: '/evil',
  heartbeatMs: 1,
  namespace: '/evil',
  redisAdapter: {},
  intervalSeconds: 1,
}

/**
 * What `call` returns with `key` planted on `Object.prototype`. What the root prototype held under that name before is
 * put back, or the key taken away, before anything is asserted.
 */
function withPlanted<T>(key: string, value: unknown, call: () => T): T {
  const root = Object.prototype as unknown as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true })
  try {
    return call()
  } finally {
    if (before === undefined) delete root[key]
    else Object.defineProperty(Object.prototype, key, before)
  }
}

/** The same as `withPlanted` for a call that is asynchronous: the key stays planted until what `call` returns has settled. */
async function withPlantedAsync<T>(
  key: string,
  value: unknown,
  call: () => Promise<T>,
): Promise<T> {
  const root = Object.prototype as unknown as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true })
  try {
    return await call()
  } finally {
    if (before === undefined) delete root[key]
    else Object.defineProperty(Object.prototype, key, before)
  }
}

/** A shape of options in which the planted key is absent, and a group or block that holds the rest. */
const SHAPES: ReadonlyArray<readonly [string, () => object]> = [
  ['an SSE host', () => ({ transport: 'sse', authenticator })],
  [
    'a WebSocket host with an empty group',
    () => ({ transport: 'websocket', authenticator, websocket: {} }),
  ],
  [
    'a WebSocket host with an empty cors block',
    () => ({ transport: 'websocket', authenticator, websocket: { cors: {} } }),
  ],
  [
    'a WebSocket host with an allowlist',
    () => ({
      transport: 'websocket',
      authenticator,
      websocket: { cors: { origin: ['https://good.example'] } },
      reauthenticationPolicy: {},
    }),
  ],
]

const shown = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'function' ? '[function]' : item))

describe.each(SHAPES)('the options of %s', (_name, build) => {
  // Scenario: a key of every name the module reads is planted, one at a time. Expected: the options that are read are
  // the ones the host wrote.
  it.each(Object.keys(PLANTED))('ignore a planted %s', (key) => {
    const baseline = shown(dropUnset(build()))

    expect(withPlanted(key, PLANTED[key], () => shown(dropUnset(build())))).toBe(baseline)
  })
})

describe('what a host defines on its own prototype', () => {
  // Scenario: a group is an instance of a class whose prototype has a getter for a known key. Expected: it is read, since
  // only the root prototype of the realm is not the host's.
  it('is still read from a class prototype', () => {
    class Group {
      get cors(): object {
        return { origin: ['https://good.example'] }
      }
    }
    const read = dropUnset({
      transport: 'websocket',
      authenticator,
      websocket: new Group(),
    } as never)

    expect((read as { websocket: { cors: unknown } }).websocket.cors).toStrictEqual(
      Object.assign(Object.create(null), { origin: ['https://good.example'] }),
    )
  })

  // Scenario: a group inherits from a prototype that itself has a prototype, as a class does. Expected: its keys are read.
  it('is still read from a prototype that has a prototype', () => {
    const parent = Object.create(
      {},
      { cors: { value: { origin: ['https://good.example'] }, enumerable: false } },
    )
    const read = dropUnset({
      transport: 'websocket',
      authenticator,
      websocket: Object.create(parent) as object,
    } as never)

    expect(Object.keys((read as { websocket: object }).websocket)).toStrictEqual(['cors'])
  })

  // Scenario: a group inherits from a prototype that has no prototype of its own. Expected: its keys are not read,
  // whoever wrote them, because that is also what the root prototype of a realm is and nothing about one can be trusted
  // once the payload that plants a key has run.
  it.each([
    ['one with a key', {}],
    [
      'one that holds hasOwnProperty and isPrototypeOf as functions',
      { hasOwnProperty: () => true, isPrototypeOf: () => true },
    ],
  ])('does not read a key of a prototype with no prototype, %s', (_name, extra) => {
    const parent = Object.assign(Object.create(null), extra, {
      cors: { origin: ['https://good.example'] },
    })
    const read = dropUnset({
      transport: 'websocket',
      authenticator,
      websocket: Object.create(parent) as object,
    } as never)

    expect(Object.keys((read as { websocket: object }).websocket)).toStrictEqual([])
  })

  // Scenario: the key is planted on the root prototype of another realm, under an object from that realm. Expected: the
  // same, not read.
  it('does not read a key planted on the root prototype of another realm', () => {
    const group = vm.runInNewContext(
      'Object.prototype.cors = { origin: true, credentials: true }; ({})',
    ) as object
    const read = dropUnset({ transport: 'websocket', authenticator, websocket: group } as never)

    expect(Object.keys((read as { websocket: object }).websocket)).toStrictEqual([])
  })
})

describe('the root prototype of another realm after the payload overwrote what it holds', () => {
  const groupFrom = (script: string): object => vm.runInNewContext(script) as object
  const read = (group: object): string[] =>
    Object.keys(
      (
        dropUnset({ transport: 'websocket', authenticator, websocket: group } as never) as {
          websocket: object
        }
      ).websocket,
    )
  const PLANT = 'Object.prototype.cors = { origin: true, credentials: true }; ({})'

  // Scenario: the payload that plants cors in another realm overwrites some of what that root prototype holds first.
  // Expected: cors is not read, whichever of them it was, since the root is told by having no prototype and by nothing
  // it holds.
  it.each([
    ['constructor = 1', 'Object.prototype.constructor = 1;'],
    ['constructor = a function', 'Object.prototype.constructor = function () {};'],
    ['constructor = undefined', 'Object.prototype.constructor = undefined;'],
    [
      'constructor and hasOwnProperty = 1',
      'Object.prototype.constructor = 1; Object.prototype.hasOwnProperty = 1;',
    ],
    [
      'constructor and isPrototypeOf = 1',
      'Object.prototype.constructor = 1; Object.prototype.isPrototypeOf = 1;',
    ],
    ['hasOwnProperty = 1', 'Object.prototype.hasOwnProperty = 1;'],
    ['isPrototypeOf = 1', 'Object.prototype.isPrototypeOf = 1;'],
    [
      'constructor, hasOwnProperty, isPrototypeOf, valueOf and toString all overwritten',
      'for (const k of ["constructor", "hasOwnProperty", "isPrototypeOf", "valueOf", "toString"]) Object.prototype[k] = 1;',
    ],
  ])('does not read a planted cors, %s', (_name, overwrite) => {
    expect(read(groupFrom(`${overwrite} ${PLANT}`))).toStrictEqual([])
  })
})

describe('the copies the module makes', () => {
  // Scenario: the options as read. Expected: every object in them has no prototype, so a read of a key that is absent
  // finds nothing, whatever was planted afterwards.
  it('have no prototype', () => {
    const read = dropUnset({
      transport: 'websocket',
      authenticator,
      sse: {},
      reauthenticationPolicy: {},
      websocket: { cors: { origin: ['https://good.example'] } },
    } as never) as unknown as Record<string, Record<string, unknown>>

    expect(Object.getPrototypeOf(read)).toBeNull()
    expect(Object.getPrototypeOf(read.sse)).toBeNull()
    expect(Object.getPrototypeOf(read.reauthenticationPolicy)).toBeNull()
    expect(Object.getPrototypeOf(read.websocket)).toBeNull()
    expect(Object.getPrototypeOf(read.websocket?.cors)).toBeNull()
  })

  // Scenario: the options after the defaults are applied. Expected: no prototype either, and still frozen.
  it('have no prototype after the defaults are applied', () => {
    const resolved = applyDefaults({ transport: 'sse', authenticator })

    expect(Object.getPrototypeOf(resolved)).toBeNull()
    expect(Object.getPrototypeOf(resolved.sse)).toBeNull()
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  // Scenario: pubsub planted while the host set none, then the options are resolved. Expected: the resolved options
  // do not answer it, and validation is not asked about it.
  it('answer nothing for a key the host left out, though one was planted', () => {
    const resolved = applyDefaults({ transport: 'sse', authenticator })

    expect(
      withPlanted('pubsub', {}, () => (resolved as Record<string, unknown>).pubsub),
    ).toBeUndefined()
  })
})

describe('the authenticator', () => {
  // Scenario: the host gave none, and one is planted on the root prototype. Expected: boot is refused for the missing
  // authenticator, not satisfied by the planted one.
  it('is not taken from a planted key', () => {
    const outcome = withPlanted('authenticator', authenticator, () => {
      try {
        validateOptions({ transport: 'sse' } as never)
        return 'accepted'
      } catch (error) {
        return (error as { code?: string }).code
      }
    })

    expect(outcome).toBe('REALTIME_NO_AUTHENTICATOR')
  })

  // Scenario: the same, through forRoot and through forRootAsync. Expected: refused, and no module is built.
  it.each([
    ['forRoot', () => BymaxRealtimeModule.forRoot({ transport: 'sse' } as never)],
    [
      'forRootAsync',
      () =>
        Test.createTestingModule({
          imports: [
            BymaxRealtimeModule.forRootAsync({
              transport: 'sse',
              useFactory: () => ({ transport: 'sse' }) as never,
            }),
          ],
        }).compile(),
    ],
  ])('is refused by %s when only a planted one exists', async (_name, make) => {
    const outcome = await withPlantedAsync('authenticator', authenticator, async () => {
      try {
        await make()
        return 'accepted'
      } catch (error) {
        return (error as { code?: string }).code
      }
    })

    expect(outcome).toBe('REALTIME_NO_AUTHENTICATOR')
  })
})

describe('the registration of forRootAsync', () => {
  // Scenario: a registration that names no factory, and a factory planted on the root prototype. Expected: refused as
  // naming no factory pattern, not wired to the planted one.
  it.each(['useFactory', 'useClass', 'useExisting'])('does not take a planted %s', (key) => {
    class Planted {}
    const planted = key === 'useFactory' ? () => ({ transport: 'sse', authenticator }) : Planted

    const outcome = withPlanted(key, planted, () => {
      try {
        BymaxRealtimeModule.forRootAsync({ transport: 'sse' } as never)
        return 'accepted'
      } catch (error) {
        return (error as { code?: string }).code
      }
    })

    expect(outcome).toBe('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: extraProviders, inject and imports planted, and a valid registration that sets none. Expected: the module
  // that is built holds none of them.
  it.each([
    ['extraProviders', [{ provide: 'PLANTED', useValue: 1 }]],
    [
      'imports',
      [{ module: class PlantedModule {}, providers: [{ provide: 'PLANTED', useValue: 1 }] }],
    ],
    ['inject', ['PLANTED']],
  ])('does not take a planted %s', (key, value) => {
    const module = withPlanted(key, value, () =>
      BymaxRealtimeModule.forRootAsync({
        transport: 'sse',
        useFactory: () => ({ transport: 'sse', authenticator }) as never,
      }),
    )

    expect(module.imports ?? []).toHaveLength(0)
    expect(shown(module.providers)).not.toContain('PLANTED')
  })
})

describe('a root prototype whose constructor was overwritten as well', () => {
  // Scenario: the same payload that plants the option overwrites `constructor` of the root prototype first. Expected:
  // the root prototype is still recognized, so the planted key is not read.
  it.each(['cors', 'websocket', 'authenticator', 'sse'])('does not read a planted %s', (key) => {
    const shapeOf = (): object => ({ transport: 'websocket', authenticator, websocket: {} })
    const baseline = shown(dropUnset(shapeOf()))

    const read = withPlanted('constructor', 1, () =>
      withPlanted('hasOwnProperty', 1, () =>
        withPlanted(key, PLANTED[key], () => shown(dropUnset(shapeOf()))),
      ),
    )

    expect(read).toBe(baseline)
  })

  // Scenario: the registration of forRootAsync under the same payload. Expected: no planted factory is taken.
  it('does not take a planted useFactory', () => {
    const outcome = withPlanted('constructor', 'x', () =>
      withPlanted(
        'useFactory',
        () => ({ transport: 'sse', authenticator }),
        () => {
          try {
            BymaxRealtimeModule.forRootAsync({ transport: 'sse' } as never)
            return 'accepted'
          } catch (error) {
            return (error as { code?: string }).code
          }
        },
      ),
    )

    expect(outcome).toBe('REALTIME_INVALID_OPTIONS')
  })
})
