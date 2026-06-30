/**
 * @fileoverview Integration tests for the dynamic module wiring.
 * @layer composition
 */
import { Injectable, Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { assertWsPeerDeps, BymaxRealtimeModule } from './realtime.module'
import { RealtimeService } from './services/realtime.service'
import { ConnectionRegistry } from './services/connection-registry.service'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import { REALTIME_HOOKS_TOKEN, REALTIME_PUBSUB_TOKEN } from './constants/injection-tokens.constants'
import type {
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptionsFactory,
  IConnectionLifecycleHooks,
  IRealtimePubSub,
} from './interfaces'

const authenticator = { authenticate: async () => null }

function asOptions(value: unknown): BymaxRealtimeModuleOptions {
  return value as BymaxRealtimeModuleOptions
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

  // WebSocket transport is now supported — forRoot does not throw for 'websocket'.
  it('produces a dynamic module for the websocket transport', () => {
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'websocket', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(0)
  })

  // Both transports are now supported — forRoot does not throw for 'both'.
  it('produces a dynamic module for the both transport', () => {
    const dynamic = BymaxRealtimeModule.forRoot({ transport: 'both', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(1)
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

  // When sse.endpoint is explicitly set on both transport, it is used instead of default.
  it('uses a custom sse endpoint for transport both', () => {
    const dynamic = BymaxRealtimeModule.forRoot({
      transport: 'both',
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
})

describe('BymaxRealtimeModule.forRootAsync', () => {
  // Basic wiring: useFactory returning valid options wires all services.
  it('wires RealtimeService when useFactory returns valid options', async () => {
    const asyncOptions: BymaxRealtimeModuleAsyncOptions = {
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
      useFactory: async () => ({ transport: 'sse', authenticator }),
    })
    expect(dynamic.module).toBe(BymaxRealtimeModule)
    expect(dynamic.controllers).toHaveLength(1)
  })

  // When useFactory is absent or returns nothing, compilation throws.
  it('throws during module compilation when useFactory returns null', async () => {
    const asyncOptions: BymaxRealtimeModuleAsyncOptions = {
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
          useFactory: async () => ({ transport: 'sse', authenticator, hooks }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_HOOKS_TOKEN)).toBe(hooks)
  })

  // extraProviders are registered alongside the default providers.
  it('registers extraProviders when provided', async () => {
    const EXTRA_TOKEN = Symbol('EXTRA')
    const asyncOptions: BymaxRealtimeModuleAsyncOptions = {
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
      imports: [BymaxRealtimeModule.forRootAsync({ useClass: TestOptionsFactory })],
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
      imports: [BymaxRealtimeModule.forRootAsync({ useClass: NullFactory })],
    })
    await expect(testModule.compile()).rejects.toThrow(/REALTIME_INVALID_OPTIONS/)
  })

  // No async-options pattern is an actionable INVALID_OPTIONS error (not a DI failure).
  it('throws when no async-options pattern is provided', () => {
    expect(() => BymaxRealtimeModule.forRootAsync({})).toThrow(
      /forRootAsync requires exactly one of useFactory, useClass, or useExisting/,
    )
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
        useFactory: () => ({ transport: 'sse', authenticator }),
        useClass: DummyFactory,
      }),
    ).toThrow(/forRootAsync requires exactly one/)
  })

  // forRootAsync resolves the websocket transport token when transport === 'websocket'.
  it('resolves WebSocketTransport for transport websocket via forRootAsync', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          useFactory: async () => ({ transport: 'websocket', authenticator }),
        }),
      ],
    }).compile()
    const service = mod.get(RealtimeService)
    expect(service).toBeInstanceOf(RealtimeService)
  })

  // forRootAsync resolves the composite transport token when transport === 'both'.
  it('resolves CompositeTransport for transport both via forRootAsync', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          useFactory: async () => ({ transport: 'both', authenticator }),
        }),
      ],
    }).compile()
    const service = mod.get(RealtimeService)
    expect(service).toBeInstanceOf(RealtimeService)
  })
})

describe('assertWsPeerDeps', () => {
  it('does not throw when all peer deps resolve successfully', () => {
    // A resolver that always succeeds simulates all deps being installed.
    const okResolver = (_id: string) => '/fake/path'
    expect(() => assertWsPeerDeps(okResolver)).not.toThrow()
  })

  it('throws an actionable error when @nestjs/websockets is missing', () => {
    // A resolver that throws simulates a missing peer dep.
    const failingResolver = (_id: string): string => {
      throw new Error('Cannot find module')
    }
    expect(() => assertWsPeerDeps(failingResolver)).toThrow(/@nestjs\/websockets/)
  })

  it('error message mentions socket.io', () => {
    // Both peer package names appear in the error for clear attribution.
    const failingResolver = (_id: string): string => {
      throw new Error('Cannot find module')
    }
    expect(() => assertWsPeerDeps(failingResolver)).toThrow(/socket\.io/)
  })
})
