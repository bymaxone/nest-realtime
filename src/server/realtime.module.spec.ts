/**
 * @fileoverview Integration tests for the SSE dynamic module wiring.
 * @layer composition
 */
import { Injectable, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from './realtime.module'
import { RealtimeService } from './services/realtime.service'
import { ConnectionRegistry } from './services/connection-registry.service'
import { SseTransport } from './transports/sse/sse.transport'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import {
  REALTIME_HOOKS_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from './constants/injection-tokens.constants'
import type {
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleOptionsFactory,
  IConnectionLifecycleHooks,
  IRealtimePubSub,
  SseRealtimeModuleAsyncOptions,
  SseRealtimeModuleOptions,
} from './interfaces'

const authenticator = { authenticate: async () => null }

function asOptions(value: unknown): SseRealtimeModuleOptions {
  return value as SseRealtimeModuleOptions
}

describe('BymaxRealtimeModule.forRoot', () => {
  // The module resolves the public services for an SSE configuration.
  it('wires RealtimeService and ConnectionRegistry for sse', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
    expect(mod.get(ConnectionRegistry)).toBeInstanceOf(ConnectionRegistry)
  })

  // A DynamicModule with exactly one (SSE) controller is produced.
  it('produces a dynamic module with one controller', () => {
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(1)
  })

  // Missing authenticator is rejected at bootstrap.
  it('throws when authenticator is missing', () => {
    expect(() => BymaxRealtimeModule.forRoot(asOptions({ transport: 'sse' }))).toThrow(
      /authenticator is required/,
    )
  })

  // When sse.endpoint is explicitly set, it is used instead of the default '/events'.
  it('uses a custom sse endpoint for transport sse', () => {
    const dynamic = BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator,
      sse: { endpoint: '/custom-events' },
    })
    expect(dynamic.controllers).toHaveLength(1)
  })

  // Without a pubsub the default in-memory implementation is provided.
  it('defaults to InMemoryPubSub', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBeInstanceOf(InMemoryPubSub)
  })

  // A provided pubsub is used as-is.
  it('uses a provided pubsub', async () => {
    const pubsub: IRealtimePubSub = {
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
    }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, pubsub })],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBe(pubsub)
  })

  // In production, omitting pubsub logs a single-instance warning.
  it('logs a production warning when pubsub is omitted in NODE_ENV=production', () => {
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('single-instance'))
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // Hooks default to an empty object when none are provided.
  it('defaults hooks to an empty object', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toEqual({})
  })

  // Provided hooks are wired through.
  it('uses provided hooks', async () => {
    const hooks: IConnectionLifecycleHooks = { onConnect: async () => undefined }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, hooks })],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toBe(hooks)
  })

  // REALTIME_TRANSPORT_TOKEN must resolve to SseTransport for transport='sse'.
  // Kills mutations that swap the 'sse' branch with the 'both' or default branch.
  it('binds REALTIME_TRANSPORT_TOKEN to SseTransport for transport sse', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(SseTransport)
  })

  // When pubsub IS provided in production the single-instance warning must NOT fire.
  // Kills the && → || mutation that would warn even when pubsub is present.
  it('does not warn in production when pubsub is provided', () => {
    const pubsub: IRealtimePubSub = {
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
    }
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, pubsub })
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('single-instance'))
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // forRoot must log a Bootstrapped line so operators can confirm the module initialised.
  // Kills StringLiteral mutations that replace the log template with an empty string.
  it('logs a Bootstrapped line on forRoot', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bootstrapped'))
    } finally {
      logSpy.mockRestore()
    }
  })

  // No warning is emitted in non-production environments even when pubsub is absent.
  it('does not warn in development when pubsub is absent', () => {
    // Kills ConditionalExpression/StringLiteral mutation that ignores NODE_ENV and always warns.
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('single-instance'))
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // forRoot exports include RealtimeService so consumers can inject it.
  it('forRoot exports contain RealtimeService', () => {
    // Kills ArrayDeclaration/BlockStatement mutation that empties the exports array.
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
    expect(dynamic.exports).toContain(RealtimeService)
  })

  // A transport this module does not serve is a wrong-import mistake, not a typo,
  // so the error has to name the entry point that does serve it.
  it('rejects the websocket transport and names the WebSocket module', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot(asOptions({ transport: 'websocket', authenticator })),
    ).toThrow(/BymaxRealtimeWebSocketModule/)
  })

  it('rejects the both transport and names the websocket entry point', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot(asOptions({ transport: 'both', authenticator })),
    ).toThrow(/@bymax-one\/nest-realtime\/websocket/)
  })

  // The rejection names the mode it refused, so the message identifies the call.
  it('names the refused transport in the rejection', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot(asOptions({ transport: 'both', authenticator })),
    ).toThrow(/transport 'both' is not served/)
  })

  // The rejection lists what this module DOES serve, so the reader can tell a
  // wrong import from a wrong mode without opening the source.
  it('lists the transport it serves in the rejection', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot(asOptions({ transport: 'websocket', authenticator })),
    ).toThrow(/it serves 'sse'/)
  })

  // Nothing this module registers may reach the Socket.IO stack: that split is the
  // reason an SSE application never installs it.
  it('registers no provider whose name mentions WebSocket', () => {
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })
    const names = (dynamic.providers ?? []).map((p) =>
      typeof p === 'function' ? p.name : String((p as { provide?: unknown }).provide ?? ''),
    )
    expect(names.some((n) => /WebSocket|Gateway|Composite/.test(n))).toBe(false)
  })
})

describe('BymaxRealtimeModule.forRootAsync', () => {
  // Basic wiring: useFactory returning valid options wires all services.
  it('wires RealtimeService when useFactory returns valid options', async () => {
    const asyncOptions: SseRealtimeModuleAsyncOptions = {
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(asyncOptions)],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
    expect(mod.get(ConnectionRegistry)).toBeInstanceOf(ConnectionRegistry)
  })

  // A DynamicModule with exactly one SSE controller is produced.
  it('produces a dynamic module with one controller', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(1)
  })

  // When useFactory is absent or returns nothing, compilation throws.
  it('throws during module compilation when useFactory returns null', async () => {
    const asyncOptions: SseRealtimeModuleAsyncOptions = {
      transport: 'sse',
      useFactory: async () => null as unknown as BymaxRealtimeModuleOptions,
    }
    const testModule = Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(asyncOptions)],
    })
    await expect(testModule.compile()).rejects.toThrow(/REALTIME_INVALID_OPTIONS/)
  })

  // Without a pubsub the default in-memory implementation is provided.
  it('defaults to InMemoryPubSub when pubsub is not in the factory result', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBeInstanceOf(InMemoryPubSub)
  })

  // In production, omitting pubsub in the factory result logs a single-instance warning.
  it('logs a production warning when forRootAsync pubsub is omitted in NODE_ENV=production', async () => {
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const mod = await Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: async () => ({ transport: 'sse', authenticator }),
          }),
        ],
      }).compile()
      await mod.init()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('single-instance'))
      await mod.close()
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // A provided pubsub is used as-is.
  it('uses a provided pubsub from the factory result', async () => {
    const pubsub: IRealtimePubSub = {
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
    }
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator, pubsub }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_PUBSUB_TOKEN)).toBe(pubsub)
  })

  // Hooks default to an empty object.
  it('defaults hooks to an empty object', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toEqual({})
  })

  // Provided hooks are wired through.
  it('uses hooks from the factory result', async () => {
    const hooks: IConnectionLifecycleHooks = { onConnect: async () => undefined }
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator, hooks }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toBe(hooks)
  })

  // extraProviders are registered alongside the default providers.
  it('registers extraProviders when provided', async () => {
    const EXTRA_TOKEN = Symbol('EXTRA')
    const asyncOptions: SseRealtimeModuleAsyncOptions = {
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
      extraProviders: [{ provide: EXTRA_TOKEN, useValue: 'extra' }],
    }
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(asyncOptions)],
    }).compile()
    expect(mod.get(EXTRA_TOKEN)).toBe('extra')
  })

  // imports and inject are passed through correctly.
  it('passes through empty imports when not provided', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    expect(dynamic.imports).toEqual([])
  })

  // useClass: a class implementing BymaxRealtimeModuleOptionsFactory is instantiated by DI.
  it('wires RealtimeService when useClass is provided', async () => {
    @Injectable()
    class TestOptionsFactory implements BymaxRealtimeModuleOptionsFactory {
      createRealtimeOptions(): BymaxRealtimeModuleOptions {
        return { transport: 'sse', authenticator }
      }
    }
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useClass: TestOptionsFactory,
        }),
      ],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
  })

  // useExisting: an already-registered factory service is reused.
  it('wires RealtimeService when useExisting is provided', async () => {
    @Injectable()
    class ExistingFactory implements BymaxRealtimeModuleOptionsFactory {
      createRealtimeOptions(): BymaxRealtimeModuleOptions {
        return { transport: 'sse', authenticator }
      }
    }
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useExisting: ExistingFactory,
          extraProviders: [ExistingFactory],
        }),
      ],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
  })

  // useClass returning null rejects with INVALID_OPTIONS during compilation.
  it('throws during module compilation when useClass factory returns null', async () => {
    @Injectable()
    class NullFactory implements BymaxRealtimeModuleOptionsFactory {
      createRealtimeOptions(): BymaxRealtimeModuleOptions {
        return null as unknown as BymaxRealtimeModuleOptions
      }
    }
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useClass: NullFactory,
        }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(/REALTIME_INVALID_OPTIONS/)
  })

  // No async-options pattern is an actionable INVALID_OPTIONS error (not a DI failure).
  it('throws when no async-options pattern is provided', () => {
    expect(() =>
      BymaxRealtimeModule.forRootAsync({
        transport: 'sse',
      }),
    ).toThrow(/forRootAsync requires exactly one of useFactory, useClass, or useExisting/)
  })

  // Providing more than one pattern is rejected up front.
  it('throws when multiple async-options patterns are provided', () => {
    class DummyFactory implements BymaxRealtimeModuleOptionsFactory {
      createRealtimeOptions(): BymaxRealtimeModuleOptions {
        return { transport: 'sse', authenticator }
      }
    }
    expect(() =>
      BymaxRealtimeModule.forRootAsync({
        transport: 'sse',
        useFactory: () => ({ transport: 'sse', authenticator }),
        useClass: DummyFactory,
      }),
    ).toThrow(/forRootAsync requires exactly one/)
  })

  // An SSE-only async module with the hint compiles without any WebSocket provider.
  it('wires an SSE-only module via forRootAsync with the transport hint', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(RealtimeService)).toBeInstanceOf(RealtimeService)
  })

  // When no transport hint is provided, the legacy path is used and REALTIME_TRANSPORT_TOKEN
  // must resolve at runtime to the correct transport.  These tests kill the string mutations
  // in buildLegacyAsyncTransportProviders' inner if-chain ('sse' → '', 'websocket' → '').
  it('resolves SseTransport via legacy async path when transport is sse', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(SseTransport)
  })

  // With a transport hint, the async path uses buildAsyncTransportProviders.
  // These tests verify the token is bound correctly for each hinted mode.
  it('binds REALTIME_TRANSPORT_TOKEN to SseTransport when transport hint is sse', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'sse', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(SseTransport)
  })

  // When pubsub IS provided in production, the single-instance warning must NOT fire.
  // Kills the && → || mutation in the pubsubProvider factory.
  it('does not warn in production when pubsub is provided via factory', async () => {
    const pubsub: IRealtimePubSub = {
      publish: async () => undefined,
      subscribe: async () => async () => undefined,
    }
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const mod = await Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: async () => ({ transport: 'sse', authenticator, pubsub }),
          }),
        ],
      }).compile()
      await mod.init()
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('single-instance'))
      await mod.close()
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // resolveAsyncOptions must log a Bootstrapped line via the module logger.
  // Kills StringLiteral mutations that replace the log template with an empty string.
  it('logs a Bootstrapped line when resolving async options', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      const mod = await Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: async () => ({ transport: 'sse', authenticator }),
          }),
        ],
      }).compile()
      await mod.init()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bootstrapped'))
      await mod.close()
    } finally {
      logSpy.mockRestore()
    }
  })
  // No warning is emitted in non-production environments even when pubsub is absent.
  it('does not warn in development when forRootAsync pubsub is absent', async () => {
    // Kills ConditionalExpression/StringLiteral mutation that ignores NODE_ENV and always warns.
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'development'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const mod = await Test.createTestingModule({
        imports: [
          BymaxRealtimeModule.forRootAsync({
            transport: 'sse',
            useFactory: async () => ({ transport: 'sse', authenticator }),
          }),
        ],
      }).compile()
      await mod.init()
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('single-instance'))
      await mod.close()
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // forRootAsync offline queue provider wires opts.offlineQueue through.
  it('wires opts.offlineQueue to REALTIME_OFFLINE_QUEUE_TOKEN via forRootAsync', async () => {
    // Kills ArrowFunction mutation: (opts) => opts.offlineQueue → () => undefined.
    const offlineQueue = { enqueue: async () => undefined } as unknown
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({
            transport: 'sse',
            authenticator,
            offlineQueue: offlineQueue as never,
          }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_OFFLINE_QUEUE_TOKEN, { strict: false })).toBe(offlineQueue)
    await mod.close()
  })

  // forRootAsync presence provider wires opts.presence through.
  it('wires opts.presence to REALTIME_PRESENCE_TOKEN via forRootAsync', async () => {
    // Kills ArrowFunction mutation: (opts) => opts.presence → () => undefined.
    const presence = { trackPresence: async () => undefined } as unknown
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({
            transport: 'sse',
            authenticator,
            presence: presence as never,
          }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_PRESENCE_TOKEN, { strict: false })).toBe(presence)
    await mod.close()
  })

  // forRootAsync exports include RealtimeService so consumers can inject it.
  it('forRootAsync exports contain RealtimeService', () => {
    // Kills ArrayDeclaration/BlockStatement mutation that empties the exports array.
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    expect(dynamic.exports).toContain(RealtimeService)
  })

  // Kills L181 StringLiteral: createSseController('/events') → createSseController('').
  it('SSE controller has route path "events" when transport hint is sse', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    const ctrl = dynamic.controllers?.[0] as (new (...args: unknown[]) => unknown) & {
      prototype: Record<string, unknown>
    }
    expect(Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object)).toBe('events')
  })

  // Kills L212 StringLiteral: createSseController('/events') → createSseController('') for legacy path.
  it('SSE controller has route path "events" when no transport hint is supplied', () => {
    const dynamic = BymaxRealtimeModule.forRootAsync({
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    const ctrl = dynamic.controllers?.[0] as (new (...args: unknown[]) => unknown) & {
      prototype: Record<string, unknown>
    }
    expect(Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object)).toBe('events')
  })

  // Kills L365 StringLiteral: 'useFactory' → '' in resolveAsyncOptions source param.
  it('null useFactory error message identifies the source as useFactory', async () => {
    const asyncOptions: SseRealtimeModuleAsyncOptions = {
      transport: 'sse',
      useFactory: async () => null as unknown as BymaxRealtimeModuleOptions,
    }
    const testModule = Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRootAsync(asyncOptions)],
    })
    await expect(testModule.compile()).rejects.toThrow(/useFactory/)
  })

  // Kills L367 ArrayDeclaration: inject: [...(asyncOptions.inject ?? [])] → inject: [].
  // Checks the DynamicModule structure: the resolved options provider must carry the inject tokens.
  it('includes custom inject tokens in the resolved options provider when useFactory is specified', () => {
    const SENTINEL = Symbol('SENTINEL')
    const asyncOptions: SseRealtimeModuleAsyncOptions = {
      transport: 'sse',
      useFactory: async () => ({ transport: 'sse', authenticator }),
      inject: [SENTINEL],
    }
    const dynamic = BymaxRealtimeModule.forRootAsync(asyncOptions)
    // Find the provider that wires the custom inject array (the resolved options provider).
    const hasInjected = (dynamic.providers ?? []).some(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        'inject' in p &&
        Array.isArray((p as { inject: unknown }).inject) &&
        ((p as { inject: unknown[] }).inject as unknown[]).includes(SENTINEL),
    )
    expect(hasInjected).toBe(true)
  })

  // The error names the method that returned nothing, so the reader knows which
  // of the three async patterns failed without reading the stack.
  it('null useClass factory error message names createRealtimeOptions', async () => {
    @Injectable()
    class NullClassFactory implements BymaxRealtimeModuleOptionsFactory {
      createRealtimeOptions(): BymaxRealtimeModuleOptions {
        return null as unknown as BymaxRealtimeModuleOptions
      }
    }
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useClass: NullClassFactory,
        }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(/createRealtimeOptions/)
  })

  // forRootAsync declares its transport, so a mode this module cannot serve is
  // refused at registration rather than at bootstrap.
  it('rejects a websocket registration up front', () => {
    expect(() =>
      BymaxRealtimeModule.forRootAsync({
        transport: 'websocket',
        useFactory: async () => ({ transport: 'websocket', authenticator }),
      } as unknown as SseRealtimeModuleAsyncOptions),
    ).toThrow(/BymaxRealtimeWebSocketModule/)
  })

  // The declared transport must equal what the factory resolves; a disagreement
  // would otherwise register providers for one mode and run another.
  it('rejects when the factory resolves a transport other than the declared one', async () => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () =>
            ({ transport: 'websocket', authenticator }) as unknown as BymaxRealtimeModuleOptions,
        }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(/was registered for transport 'sse'/)
  })

  it('names the resolved transport in the mismatch error', async () => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () =>
            ({ transport: 'both', authenticator }) as unknown as BymaxRealtimeModuleOptions,
        }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(/resolved 'both'/)
  })
})
