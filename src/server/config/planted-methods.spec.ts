/**
 * @fileoverview A method planted on `Object.prototype` is not one a host's authenticator, hook table or pluggable piece has.
 * @layer composition
 *
 * The authenticator, the hook table and the pluggable pieces are objects a host wrote, and the library reads their
 * methods by name. A function planted on the root prototype must not satisfy the check that a required method
 * exists, and must not be called as an optional one: a planted `revalidate` would decide whether a session stays
 * authenticated. A method of the object itself or of its class prototype is still the host's.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../constants/injection-tokens.constants'
import { BymaxRealtimeModule } from '../realtime.module'
import { admitRooms } from '../utils/admit-rooms'
import { resolveAuthTenant } from '../utils/assert-identity'
import { callHostMethod, hostMethod } from '../utils/read-host-key'
import { ReauthenticationService } from '../services/reauthentication.service'
import { reportDeliveryFailure } from '../utils/report-delivery-failure'
import { validateOptions } from './validate-options'

const authenticate = async (): Promise<null> => null

/** `name` planted on `Object.prototype` while `call` runs; what it held before is put back afterwards. */
function planted<T>(name: string, value: unknown, call: () => T): T {
  const root = Object.prototype as unknown as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(Object.prototype, name)
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return call()
  } finally {
    if (before === undefined) delete root[name]
    else Object.defineProperty(Object.prototype, name, before)
  }
}

/** The same for a call whose effect lands later: the name stays planted until `call` has settled. */
async function plantedAsync<T>(name: string, value: unknown, call: () => Promise<T>): Promise<T> {
  const root = Object.prototype as unknown as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(Object.prototype, name)
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return await call()
  } finally {
    if (before === undefined) delete root[name]
    else Object.defineProperty(Object.prototype, name, before)
  }
}

/** The code `validateOptions` refuses with, or `accepted`. */
const codeOf = (options: object): string => {
  try {
    validateOptions(options as never)
    return 'accepted'
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

describe('hostMethod and callHostMethod', () => {
  // Scenario: a function is planted under the name of an optional method, and the host's object does not define it.
  // Expected: it is not found, and not called.
  it.each([
    ['a literal', (): object => ({})],
    ['a class instance', (): object => new (class Hooks {})()],
    ['an object with no prototype', (): object => Object.create(null) as object],
  ])('does not find a planted method on %s', (_name, build) => {
    const calls: unknown[] = []
    const owner = build()

    const found = planted(
      'onConnect',
      () => calls.push('planted'),
      () => [hostMethod(owner, 'onConnect'), callHostMethod(owner, 'onConnect', [1])],
    )

    expect(found).toStrictEqual([undefined, undefined])
    expect(calls).toStrictEqual([])
  })

  // Scenario: the host's own method, and one its class defines, with the same name planted as well. Expected: the host's
  // is called, with the object as `this`, and returns what it returns.
  it.each([
    [
      'its own',
      (calls: unknown[]): object => ({
        onConnect(this: unknown, value: number) {
          calls.push([this, value])
          return 'own'
        },
      }),
    ],
    [
      'its class',
      (calls: unknown[]): object =>
        new (class Hooks {
          onConnect(value: number): string {
            calls.push([this, value])
            return 'own'
          }
        })(),
    ],
  ])('calls %s method, not the planted one', (_name, build) => {
    const calls: unknown[] = []
    const owner = build(calls)

    const result = planted(
      'onConnect',
      () => 'planted',
      () => callHostMethod(owner, 'onConnect', [7]),
    )

    expect(result).toBe('own')
    expect(calls).toStrictEqual([[owner, 7]])
  })

  // Scenario: nothing to read from. Expected: `undefined`, not a throw.
  it.each([[undefined], [null]])('answers undefined for %p', (owner) => {
    expect(hostMethod(owner, 'onConnect')).toBeUndefined()
    expect(callHostMethod(owner, 'onConnect', [])).toBeUndefined()
  })

  // Scenario: a property that holds something other than a function. Expected: not a method.
  it('does not treat a value that is not a function as a method', () => {
    expect(hostMethod({ onConnect: 1 }, 'onConnect')).toBeUndefined()
  })
})

describe('the required methods of the options', () => {
  // Scenario: `authenticate` is planted and the authenticator is an empty object. Expected: refused as one that does
  // not implement it.
  it('refuse an authenticator whose authenticate is only a planted one', () => {
    expect(
      planted('authenticate', authenticate, () => codeOf({ transport: 'sse', authenticator: {} })),
    ).toBe('REALTIME_NO_AUTHENTICATOR')
  })

  // Scenario: the authenticator has its own or a class `authenticate`. Expected: accepted, planted or not.
  it.each([
    ['its own', { authenticate }],
    [
      'its class',
      new (class Authenticator {
        authenticate = authenticate
      })(),
    ],
  ])('accept an authenticator with %s authenticate', (_name, authenticator) => {
    expect(
      planted('authenticate', authenticate, () => codeOf({ transport: 'sse', authenticator })),
    ).toBe('accepted')
  })

  // Scenario: the functions of a pluggable piece are planted and the piece is an empty object. Expected: refused.
  it.each([
    ['pubsub', ['publish', 'subscribe']],
    ['offlineQueue', ['append', 'retrieveSince', 'acknowledge']],
    ['presence', ['setOnline', 'setOffline', 'isOnline', 'listOnlineByTenant', 'countOnline']],
  ])('refuse a %s whose functions are only planted ones', (piece, names) => {
    const plant = (rest: readonly string[], call: () => string): string =>
      rest.length === 0
        ? call()
        : planted(rest[0] as string, authenticate, () => plant(rest.slice(1), call))

    expect(
      plant(names, () =>
        codeOf({ transport: 'sse', authenticator: { authenticate }, [piece]: {} }),
      ),
    ).toBe('REALTIME_INVALID_OPTIONS')
  })
})

describe('the optional methods the library calls', () => {
  afterEach(() => jest.restoreAllMocks())

  // Scenario: a delivery-failure hook is planted and the host gave an empty hook table. Expected: it is not called.
  it('does not call a planted onDeliveryFailure', async () => {
    const calls: unknown[] = []
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await plantedAsync(
      'onDeliveryFailure',
      () => calls.push('planted'),
      async () => {
        reportDeliveryFailure(new Logger('test'), {}, { error: new Error('x') } as never, 'deliver')
        await new Promise((resolve) => setImmediate(resolve))
      },
    )

    expect(calls).toStrictEqual([])
  })

  // Scenario: the hook table has its own onDeliveryFailure and another is planted. Expected: the host's is called once.
  it('calls the onDeliveryFailure the host defined', async () => {
    const calls: unknown[] = []
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await plantedAsync(
      'onDeliveryFailure',
      () => calls.push('planted'),
      async () => {
        reportDeliveryFailure(
          new Logger('test'),
          { onDeliveryFailure: () => void calls.push('own') },
          { error: new Error('x') } as never,
          'deliver',
        )
        await new Promise((resolve) => setImmediate(resolve))
      },
    )

    expect(calls).toStrictEqual(['own'])
  })

  // Scenario: `revalidate` is planted and the authenticator has none. Expected: reauthentication stays disabled, as it
  // is for an authenticator without `revalidate`, and the planted function is never called.
  it('does not take a planted revalidate for the authenticator', () => {
    const calls: unknown[] = []
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const service = new ReauthenticationService({} as never, {} as never, { authenticate }, {
      transport: 'sse',
    } as never)

    planted(
      'revalidate',
      () => calls.push('planted'),
      () => service.onModuleInit(),
    )
    service.onApplicationShutdown()

    expect(log).toHaveBeenCalledWith(
      'Authenticator does not implement revalidate() — reauthentication disabled',
    )
    expect(calls).toStrictEqual([])
  })

  // Scenario: the authenticator has its own `revalidate`. Expected: reauthentication is enabled.
  it('enables reauthentication for the revalidate the host defined', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const service = new ReauthenticationService(
      {} as never,
      {} as never,
      { authenticate, revalidate: async () => true },
      { transport: 'sse' } as never,
    )

    service.onModuleInit()
    service.onApplicationShutdown()

    expect(log).not.toHaveBeenCalledWith(
      'Authenticator does not implement revalidate() — reauthentication disabled',
    )
  })
})

describe('the hook table of a host that gave none', () => {
  // Scenario: no hooks through forRoot or forRootAsync. Expected: the table that is provided holds no hook and has no
  // prototype, so a hook planted afterwards is not found on it.
  it.each([
    [
      'forRoot',
      () =>
        BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator: { authenticate } } as never),
    ],
    [
      'forRootAsync',
      () =>
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: () => ({ transport: 'sse', authenticator: { authenticate } }) as never,
        }),
    ],
  ])('has no prototype through %s', async (_name, make) => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({ imports: [make()] }).compile()
    const hooks = module.get<object>(REALTIME_HOOKS_TOKEN, { strict: false })

    expect(Object.getPrototypeOf(hooks)).toBeNull()
    expect(Object.keys(hooks)).toStrictEqual([])
    await module.close()
  })
})

/** The options a `forRootAsync` registration resolved to, with `key` planted on the root prototype while it was built. */
async function resolvedWith(
  registration: object,
  key: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  const module = await plantedAsync(key, value, () =>
    Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(registration as never)],
    }).compile(),
  )
  const options = module.get<Record<string, unknown>>(REALTIME_OPTIONS_TOKEN, { strict: false })
  await module.close()
  return options
}

describe('the options a forRootAsync registration resolves to', () => {
  afterEach(() => jest.restoreAllMocks())

  class Provider {
    createRealtimeOptions(): object {
      return { transport: 'sse', authenticator: { authenticate } }
    }
  }
  const registrations: ReadonlyArray<readonly [string, () => object]> = [
    [
      'useFactory',
      () => ({
        transport: 'sse',
        useFactory: () => ({ transport: 'sse', authenticator: { authenticate } }),
      }),
    ],
    ['useClass', () => ({ transport: 'sse', useClass: Provider })],
  ]
  const KEYS = [
    'tenantResolver',
    'hooks',
    'presence',
    'offlineQueue',
    'pubsub',
    'maxConnections',
    'reauthenticationPolicy',
    'onConnectFailure',
    'hookTimeoutMs',
  ]

  // Scenario: a key of every option the module reads is planted while the module is built, and the host left it out.
  // Expected: the resolved options have no prototype and answer nothing for it, so no later read of the options finds
  // a planted resolver, hook table or pluggable piece.
  describe.each(registrations)('through %s', (_name, build) => {
    it.each(KEYS)('answers nothing for a planted %s', async (key) => {
      const options = await resolvedWith(build(), key, key === 'tenantResolver' ? () => 'evil' : {})

      expect(Object.getPrototypeOf(options)).toBeNull()
      expect(options[key]).toBeUndefined()
    })
  })

  // Scenario: the provider a registration names has no `createRealtimeOptions`, and one is planted that supplies a whole
  // options object, authenticator included. Expected: refused as a provider that does not implement it.
  it.each([['useClass', { transport: 'sse', useClass: class Empty {} }]])(
    'refuses a planted createRealtimeOptions through %s',
    async (_name, registration) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

      const code = await plantedAsync(
        'createRealtimeOptions',
        () => ({ transport: 'sse', authenticator: { authenticate } }),
        async () => {
          try {
            await Test.createTestingModule({
              imports: [BymaxRealtimeModule.forRootAsync(registration as never)],
            }).compile()
            return 'built'
          } catch (error) {
            return (error as { code?: string }).code
          }
        },
      )

      expect(code).toBe('REALTIME_INVALID_OPTIONS')
    },
  )
})

describe('the result of the authenticator', () => {
  const FIELDS: ReadonlyArray<readonly [string, unknown]> = [
    ['tenantId', 'evil-tenant'],
    ['roles', ['admin']],
    ['rooms', ['resource:evil:1']],
    ['metadata', { evil: true }],
    ['userId', 'evil-user'],
  ]

  // Scenario: a field of the result is planted and the authenticator's result lacks it. Expected: the record the
  // library keeps does not have it, before and after rooms are admitted.
  it.each(FIELDS)('does not take a planted %s', (field, value) => {
    const kept = planted(field, value, () =>
      admitRooms(resolveAuthTenant({}, { userId: 'u1' } as never)),
    ) as unknown as Record<string, unknown>

    expect(kept.userId).toBe('u1')
    for (const [name] of FIELDS.filter(([n]) => n !== 'userId')) expect(kept[name]).toBeUndefined()
    expect(Object.getPrototypeOf(kept)).toBeNull()
  })

  // Scenario: the authenticator's own fields and the ones its class supplies, with others planted. Expected: its are kept.
  it('keeps the fields the authenticator and its class give', () => {
    class Result {
      get tenantId(): string {
        return 't1'
      }
    }
    const result = Object.assign(new Result(), { userId: 'u1', roles: ['r1'] })

    const kept = planted('roles', ['admin'], () =>
      admitRooms(resolveAuthTenant({}, result as never)),
    )

    expect(kept.tenantId).toBe('t1')
    expect(kept.roles).toStrictEqual(['r1'])
  })
})

describe('the source', () => {
  /** The files of `src` that are not specs, declarations or interfaces, with their comments taken out. */
  const sources = (dir: string): Array<[string, string]> =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry): Array<[string, string]> => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      if (!/\.tsx?$/.test(entry.name) || /\.(spec|test|d)\.tsx?$/.test(entry.name)) return []
      const text = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      return [[path, text]]
    })

  // Scenario: an optional method of the hook table, the authenticator or the pubsub is read by property access
  // anywhere in the library. Expected: none is, since each has to go through `callHostMethod` or `hostMethod` so that a
  // planted one is not found.
  it('reads no optional method of a host object by property access', () => {
    const direct =
      /\b(?:hooks|auth|authenticator|pubsub)\??\.(?:onConnect|onDisconnect|onError|onReauthenticationFailed|onDeliveryFailure|revalidate|isSubscribed)\b/
    const offenders = sources(join(__dirname, '..', '..')).filter(([, text]) => direct.test(text))

    expect(offenders.map(([path]) => path)).toStrictEqual([])
  })
})
