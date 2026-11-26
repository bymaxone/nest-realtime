/**
 * @fileoverview An option that is set to `undefined` or `null` resolves to its default, never to "no bound".
 * @layer composition
 *
 * `{ ...DEFAULT_SSE, ...options.sse }` lets an own key holding `undefined` overwrite the default, and the
 * bounds read downstream (`max <= 0`, `?? 0`) then mean "switched off". Unset keys are dropped before the
 * defaults are merged and before validation.
 */
import { Test } from '@nestjs/testing'
import { REALTIME_OPTIONS_TOKEN } from '../constants/injection-tokens.constants'
import { BymaxRealtimeModule } from '../realtime.module'
import type {
  BymaxRealtimeModuleOptions,
  ReauthenticationPolicy,
  SseOptions,
  WebSocketOptions,
} from '../interfaces/realtime-module-options.interface'
import { applyDefaults, DEFAULT_SSE } from './default-options'
import { dropUnset } from './drop-unset'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }
const UNSET: ReadonlyArray<readonly [string, undefined | null]> = [
  ['undefined', undefined],
  ['null', null],
]

function optionsWith(group: string, key: string, value: unknown): BymaxRealtimeModuleOptions {
  return { transport: 'sse', authenticator, [group]: { [key]: value } } as never
}

describe.each(Object.keys(DEFAULT_SSE) as Array<keyof typeof DEFAULT_SSE>)('sse.%s', (key) => {
  // Scenario: the option is present and holds undefined or null. Expected: it resolves to the library
  // default, the same as when it is absent, and validation accepts it.
  it.each(UNSET)('resolves %s to its default', (_label, value) => {
    const options = optionsWith('sse', key, value)

    expect(() => validateOptions(options)).not.toThrow()
    expect(applyDefaults(options).sse[key]).toBe(DEFAULT_SSE[key])
  })

  // Scenario: the module is registered with the option unset. Expected: the options the services receive
  // carry the default, so no bound is switched off by an own key that holds nothing.
  it.each(UNSET)('reaches the services as its default when registered with %s', (_label, value) => {
    const registration = BymaxRealtimeModule.forRoot(optionsWith('sse', key, value) as never)
    const provided = registration.providers?.find(
      (provider) => (provider as { provide?: unknown }).provide === REALTIME_OPTIONS_TOKEN,
    ) as { useValue: { sse: Record<string, unknown> } }

    expect(provided.useValue.sse[key]).toBe(DEFAULT_SSE[key])
  })
})

describe('the bounds that mean "off" when they are 0 or missing', () => {
  // Scenario: the bounds that mean "off" when they are missing or 0, set to undefined or null. Expected: the default, never 0 and
  // never a missing value that a comparison reads as no cap.
  it.each([
    'maxConnectionsPerUser',
    'maxQueuedBytes',
    'maxQueuedEvents',
    'stallHeartbeats',
  ] as const)('%s keeps its non-zero default', (key) => {
    for (const [, value] of UNSET) {
      const resolved = applyDefaults(optionsWith('sse', key, value)).sse[key]
      expect(resolved).toBeGreaterThan(0)
      expect(resolved).toBe(DEFAULT_SSE[key])
    }
  })
})

describe('the other groups and the top level', () => {
  // Scenario: an integer option of another group set to null. Expected: it is read as unset, so it is
  // accepted.
  it.each([
    ['websocket', 'maxConnectionsPerUser'],
    ['websocket', 'maxHttpBufferSize'],
    ['reauthenticationPolicy', 'concurrency'],
    ['reauthenticationPolicy', 'cacheTtlMs'],
  ] as const)('%s.%s accepts undefined and null as unset', (group, key) => {
    for (const [, value] of UNSET) {
      expect(() => validateOptions(optionsWith(group, key, value))).not.toThrow()
    }
  })

  it.each([
    'maxConnections',
    'maxPendingHandshakes',
    'hookTimeoutMs',
    'authenticateTimeoutMs',
  ] as const)('top-level %s accepts undefined and null as unset', (key) => {
    for (const [, value] of UNSET) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, [key]: value } as never),
      ).not.toThrow()
    }
  })

  // Scenario: the unset keys are dropped from what the services receive, not merely tolerated.
  it('leaves no own key holding undefined or null in the resolved options', () => {
    const resolved = applyDefaults({
      transport: 'sse',
      authenticator,
      maxConnections: undefined,
      websocket: { maxConnectionsPerUser: null },
      reauthenticationPolicy: { concurrency: undefined },
    } as never)

    expect('maxConnections' in resolved).toBe(false)
    expect(resolved.websocket && 'maxConnectionsPerUser' in resolved.websocket).toBe(false)
    expect(
      resolved.reauthenticationPolicy && 'concurrency' in resolved.reauthenticationPolicy,
    ).toBe(false)
  })
})

/** Every key of each group, written out so that adding a key to the interface fails to compile here. */
const EVERY_SSE_KEY = {
  endpoint: '/x',
  heartbeatMs: 6_000,
  replayBufferSize: 1,
  replayTtlMs: 2,
  replayMaxIdleUsers: 3,
  maxConnectionsPerUser: 4,
  emitConnectionEvent: false,
  maxQueuedBytes: 5,
  maxQueuedEvents: 6,
  stallHeartbeats: 7,
} satisfies Required<SseOptions>
const EVERY_WEBSOCKET_KEY = {
  namespace: '/ns',
  cors: { origin: '*' },
  maxHttpBufferSize: 8,
  pingIntervalMs: 9,
  pingTimeoutMs: 10,
  allowedOrigins: ['https://app.example'],
  websocketOnly: true,
  maxConnectionsPerUser: 11,
  emitConnectionEvent: false,
  redisAdapter: { pubClient: {} },
} satisfies Required<WebSocketOptions>
const EVERY_REAUTH_KEY = {
  intervalSeconds: 12,
  onFailure: 'event',
  cacheTtlMs: 13,
  revalidateTimeoutMs: 14,
  concurrency: 15,
} satisfies Required<ReauthenticationPolicy>
const GROUPS = [
  ['sse', EVERY_SSE_KEY],
  ['websocket', EVERY_WEBSOCKET_KEY],
  ['reauthenticationPolicy', EVERY_REAUTH_KEY],
] as const

describe.each(GROUPS)('the %s group as a class instance', (group, every) => {
  // Scenario: the group is a class instance whose fields hold nothing, or whose getters return
  // nothing. Expected: every such key is dropped, except the origin-policy options, which validation
  // has to see; a getter that returns a value is kept, because a getter is a property.
  it.each(Object.keys(every))('drops %s when a field or a getter holds nothing', (key) => {
    class WithFields {}
    class WithGetter {}
    Object.defineProperty(WithGetter.prototype, key, { get: () => undefined, enumerable: false })
    const withFields = Object.assign(new WithFields(), { [key]: null })
    const withGetter = new WithGetter()

    for (const instance of [withFields, withGetter]) {
      const kept = dropUnset({ [group]: instance } as never)[group] as Record<string, unknown>

      // An origin-policy option set to nothing is kept for validation to read, wherever the class holds it. Only the
      // websocket group has them.
      expect(key in kept).toBe(
        group === 'websocket' && ['allowedOrigins', 'websocketOnly'].includes(key),
      )
    }
  })

  it('keeps a value that a getter returns', () => {
    class WithGetter {
      get [Object.keys(every)[0] as string](): unknown {
        return Object.values(every)[0]
      }
    }
    const kept = dropUnset({ [group]: new WithGetter() } as never)[group] as Record<string, unknown>

    expect(kept[Object.keys(every)[0] as string]).toBe(Object.values(every)[0])
  })

  it('keeps every key of a plain group that holds a value', () => {
    expect(structuredClone(dropUnset({ [group]: { ...every } } as never)[group])).toStrictEqual(
      every,
    )
  })
})

describe('the sse bounds as a class instance, end to end', () => {
  // Scenario: a group handed over as a class whose bound fields hold undefined. Expected: the options
  // the services receive carry the default, never no cap.
  it('resolves to the defaults', () => {
    class SseGroup {
      maxConnectionsPerUser = undefined
      maxQueuedBytes = undefined
      maxQueuedEvents = null
      stallHeartbeats = null
    }
    const resolved = applyDefaults({
      transport: 'sse',
      authenticator,
      sse: new SseGroup(),
    } as never)

    expect(resolved.sse.maxConnectionsPerUser).toBe(DEFAULT_SSE.maxConnectionsPerUser)
    expect(resolved.sse.maxQueuedBytes).toBe(DEFAULT_SSE.maxQueuedBytes)
    expect(resolved.sse.maxQueuedEvents).toBe(DEFAULT_SSE.maxQueuedEvents)
    expect(resolved.sse.stallHeartbeats).toBe(DEFAULT_SSE.stallHeartbeats)
  })

  it('is accepted by validateOptions and by forRoot', () => {
    class SseGroup {
      maxConnectionsPerUser = undefined
    }
    const options = { transport: 'sse', authenticator, sse: new SseGroup() } as never

    expect(() => validateOptions(options)).not.toThrow()
    expect(() => BymaxRealtimeModule.forRoot(options)).not.toThrow()
  })
})

describe('the top level as a class instance', () => {
  it('drops a getter that returns nothing and keeps one that returns a value', () => {
    class TopLevel {
      get maxConnections(): number | undefined {
        return undefined
      }
      get hookTimeoutMs(): number {
        return 9_000
      }
    }
    const kept = dropUnset(Object.assign(new TopLevel(), { authenticator }) as never) as Record<
      string,
      unknown
    >

    expect('maxConnections' in kept).toBe(false)
    expect(kept.hookTimeoutMs).toBe(9_000)
  })
})

describe('a getter is read once per registration', () => {
  /** An sse group whose `maxConnectionsPerUser` answers a different value on every read. */
  function flippingGroup(): { group: object; reads: () => number } {
    let reads = 0
    const group = {
      get maxConnectionsPerUser(): number {
        reads += 1
        return reads === 1 ? 7 : 1_000_000
      },
    }
    return { group, reads: () => reads }
  }

  // Scenario: a getter that is not stable. Expected: the value that is validated is the value that is
  // resolved, because the group is read into a plain copy once and the copy is what travels on. Read
  // twice, the first read would pass the ceiling check and the second would slip past it.
  it('resolves the value it validated, from one read', () => {
    const { group, reads } = flippingGroup()
    const registration = BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator,
      sse: group,
    } as never)
    const provided = registration.providers?.find(
      (provider) => (provider as { provide?: unknown }).provide === REALTIME_OPTIONS_TOKEN,
    ) as { useValue: { sse: { maxConnectionsPerUser: number } } }

    expect(provided.useValue.sse.maxConnectionsPerUser).toBe(7)
    expect(reads()).toBe(1)
  })

  it('resolves the value it validated, from one read, when the factory returns it', async () => {
    const { group, reads } = flippingGroup()
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () =>
            ({ transport: 'sse' as const, authenticator, sse: group }) as never,
        }),
      ],
    }).compile()

    expect(
      module.get<BymaxRealtimeModuleOptions>(REALTIME_OPTIONS_TOKEN).sse?.maxConnectionsPerUser,
    ).toBe(7)
    expect(reads()).toBe(1)
  })
})

describe.each(['sse', 'reauthenticationPolicy'])('a policy name in the %s group', (group) => {
  // Scenario: a group that has no origin policy holds one of its names set to nothing. Expected: dropped like any key.
  it.each(['allowedOrigins', 'websocketOnly'])('drops %s set to nothing', (name) => {
    const kept = dropUnset({ [group]: { [name]: null } } as never) as unknown as Record<
      string,
      object
    >

    expect(name in (kept[group] as object)).toBe(false)
  })
})
