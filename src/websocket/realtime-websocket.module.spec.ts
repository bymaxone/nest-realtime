/**
 * @fileoverview Integration tests for the WebSocket dynamic module wiring.
 * @layer composition
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { REALTIME_TRANSPORT_TOKEN } from '../server/constants/injection-tokens.constants'
import { RealtimeService } from '../server/services/realtime.service'
import { CompositeTransport } from '../server/transports/composite/composite.transport'
import { RealtimeGateway } from '../server/transports/websocket/realtime.gateway'
import { WebSocketTransport } from '../server/transports/websocket/websocket.transport'
import type {
  WebSocketRealtimeModuleAsyncOptions,
  WebSocketRealtimeModuleOptions,
} from '../server/interfaces'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'

const authenticator = { authenticate: async () => null }

function asOptions(value: unknown): WebSocketRealtimeModuleOptions {
  return value as WebSocketRealtimeModuleOptions
}

describe('BymaxRealtimeWebSocketModule.forRoot', () => {
  // WebSocket transport is now supported — forRoot does not throw for 'websocket'.
  it('produces a dynamic module for the websocket transport', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeWebSocketModule)
    expect(dynamic.controllers).toHaveLength(0)
  })

  // Both transports are now supported — forRoot does not throw for 'both'.
  it('produces a dynamic module for the both transport', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({ transport: 'both', authenticator })
    expect(dynamic.module).toBe(BymaxRealtimeWebSocketModule)
    expect(dynamic.controllers).toHaveLength(1)
  })

  // When sse.endpoint is explicitly set on both transport, it is used instead of default.
  // Counting controllers proves one was built, not that it was built for the
  // configured endpoint — the route metadata is what shows the option was read.
  it('binds the both-mode SSE controller to the configured endpoint', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({
      transport: 'both',
      authenticator,
      sse: { endpoint: '/custom-events' },
    })
    const ctrl = dynamic.controllers?.[0] as (new (...args: unknown[]) => unknown) & {
      prototype: Record<string, unknown>
    }
    expect(Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object)).toBe('custom-events')
  })

  // REALTIME_TRANSPORT_TOKEN must resolve to WebSocketTransport for transport='websocket'.
  it('binds REALTIME_TRANSPORT_TOKEN to WebSocketTransport for transport websocket', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(WebSocketTransport)
  })

  // REALTIME_TRANSPORT_TOKEN must resolve to CompositeTransport for transport='both'.
  it('binds REALTIME_TRANSPORT_TOKEN to CompositeTransport for transport both', async () => {
    const mod = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'both', authenticator })],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(CompositeTransport)
  })

  // Asking this module for SSE is the mirror of asking the root for WebSocket:
  // a wrong import, and the message has to name the entry point that serves it.
  it('rejects the sse transport and names the root module', () => {
    expect(() =>
      BymaxRealtimeWebSocketModule.forRoot(asOptions({ transport: 'sse', authenticator })),
    ).toThrow(/BymaxRealtimeModule/)
  })

  it('names the package root in the sse rejection', () => {
    expect(() =>
      BymaxRealtimeWebSocketModule.forRoot(asOptions({ transport: 'sse', authenticator })),
    ).toThrow(/'@bymax-one\/nest-realtime'/)
  })

  // IRealtimePubSub is read by the SSE transport and its subscriber and by nothing
  // else, so a WebSocket-only app scaling through websocket.redisAdapter must not be
  // told to provide one — that names the wrong mechanism.
  it('does not warn about pubsub for websocket in production', () => {
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('single-instance'))
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // 'both' does carry SSE, so the warning stays — this is what pins the gate to
  // the transport rather than to the module.
  it('does warn about pubsub for both in production', () => {
    const original = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      BymaxRealtimeWebSocketModule.forRoot({ transport: 'both', authenticator })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('single-instance'))
    } finally {
      process.env['NODE_ENV'] = original
      warnSpy.mockRestore()
    }
  })

  // Two modes, so the rejection also proves the separator: a list joined without
  // it reads as a single unknown mode.
  it('lists both transports it serves in the rejection', () => {
    expect(() =>
      BymaxRealtimeWebSocketModule.forRoot(asOptions({ transport: 'sse', authenticator })),
    ).toThrow(/it serves 'websocket', 'both'/)
  })

  // The gateway is what pulls Socket.IO in, so 'websocket' must register it and
  // no SSE controller alongside.
  it('registers the gateway and no controller for websocket', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })
    expect(dynamic.providers).toContain(RealtimeGateway)
    expect(dynamic.controllers).toHaveLength(0)
  })

  // 'both' composes the two transports, so it registers the gateway AND the
  // SSE controller — the difference from 'websocket' that the token binding rests on.
  it('registers the gateway and one controller for both', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({ transport: 'both', authenticator })
    expect(dynamic.providers).toContain(RealtimeGateway)
    expect(dynamic.controllers).toHaveLength(1)
  })

  it('exports RealtimeService', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })
    expect(dynamic.exports).toContain(RealtimeService)
  })

  it('logs a Bootstrapped line', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bootstrapped'))
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe('BymaxRealtimeWebSocketModule.forRootAsync', () => {
  // forRootAsync resolves the websocket transport token when transport === 'websocket'.
  it('resolves WebSocketTransport for transport websocket via forRootAsync', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
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
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'both',
          useFactory: async () => ({ transport: 'both', authenticator }),
        }),
      ],
    }).compile()
    const service = mod.get(RealtimeService)
    expect(service).toBeInstanceOf(RealtimeService)
  })

  // A synchronous 'websocket' hint registers the gateway + WS transport and no SSE controller.
  it('registers the gateway and no SSE controller when the transport is websocket', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'websocket',
      useFactory: async () => ({ transport: 'websocket', authenticator }),
    })
    expect(dynamic.providers).toContain(RealtimeGateway)
    expect(dynamic.providers).toContain(WebSocketTransport)
    expect(dynamic.controllers).toHaveLength(0)
  })

  // A synchronous 'both' hint registers every transport and the SSE controller.
  it('registers all transports and the SSE controller when the transport is both', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'both',
      useFactory: async () => ({ transport: 'both', authenticator }),
    })
    expect(dynamic.providers).toContain(RealtimeGateway)
    expect(dynamic.providers).toContain(CompositeTransport)
    expect(dynamic.controllers).toHaveLength(1)
  })

  it('resolves WebSocketTransport for transport websocket', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
          useFactory: async () => ({ transport: 'websocket', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(WebSocketTransport)
  })

  it('resolves CompositeTransport for transport both', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'both',
          useFactory: async () => ({ transport: 'both', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(CompositeTransport)
  })

  it('binds REALTIME_TRANSPORT_TOKEN to WebSocketTransport when transport is websocket', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
          useFactory: async () => ({ transport: 'websocket', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(WebSocketTransport)
  })

  it('binds REALTIME_TRANSPORT_TOKEN to CompositeTransport when transport is both', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'both',
          useFactory: async () => ({ transport: 'both', authenticator }),
        }),
      ],
    }).compile()
    expect(mod.get(REALTIME_TRANSPORT_TOKEN)).toBeInstanceOf(CompositeTransport)
  })

  // Kills L207 StringLiteral: createSseController('/events') → createSseController('') for 'both'.
  it('SSE controller has route path "events" when transport is both', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'both',
      useFactory: async () => ({ transport: 'both', authenticator }),
    })
    const ctrl = dynamic.controllers?.[0] as (new (...args: unknown[]) => unknown) & {
      prototype: Record<string, unknown>
    }
    expect(Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object)).toBe('events')
  })

  // Kills L195:7 ConditionalExpression (false) and L195:24 BlockStatement ({}).
  // The 'both' path must wire REALTIME_TRANSPORT_TOKEN with useExisting CompositeTransport, not useFactory.
  it('REALTIME_TRANSPORT_TOKEN uses useExisting CompositeTransport when transport is both', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'both',
      useFactory: async () => ({ transport: 'both', authenticator }),
    })
    const tokenProvider = (dynamic.providers ?? []).find(
      (p): p is { provide: symbol; useExisting: unknown } =>
        typeof p === 'object' &&
        p !== null &&
        'provide' in p &&
        (p as { provide: unknown }).provide === REALTIME_TRANSPORT_TOKEN,
    )
    expect(tokenProvider).toBeDefined()
    expect((tokenProvider as { useExisting?: unknown })?.useExisting).toBe(CompositeTransport)
  })

  // The declared transport is refused up front when this module cannot serve it.
  it('rejects an sse registration up front', () => {
    expect(() =>
      BymaxRealtimeWebSocketModule.forRootAsync({
        transport: 'sse',
        useFactory: async () => ({ transport: 'sse', authenticator }),
      } as unknown as WebSocketRealtimeModuleAsyncOptions),
    ).toThrow(/BymaxRealtimeModule/)
  })

  // 'websocket' registers no controller; 'both' registers the SSE one. Asserting
  // both directions is what keeps the branch honest.
  it('registers no controller for websocket and one for both', () => {
    const ws = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'websocket',
      useFactory: async () => ({ transport: 'websocket' as const, authenticator }),
    })
    const both = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'both',
      useFactory: async () => ({ transport: 'both' as const, authenticator }),
    })
    expect(ws.controllers).toHaveLength(0)
    expect(both.controllers).toHaveLength(1)
  })

  // The async SSE controller binds to the fixed default endpoint, since options
  // resolve after decoration.
  it('binds the both-mode SSE controller to /events', () => {
    const dynamic = BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'both',
      useFactory: async () => ({ transport: 'both' as const, authenticator }),
    })
    const ctrl = dynamic.controllers?.[0] as (new (...args: unknown[]) => unknown) & {
      prototype: Record<string, unknown>
    }
    expect(Reflect.getMetadata('path', ctrl.prototype['subscribe'] as object)).toBe('events')
  })

  it('rejects when the factory resolves a transport other than the declared one', async () => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
          useFactory: async () => ({ transport: 'both' as const, authenticator }),
        }),
      ],
    })
    await expect(testModule.compile()).rejects.toThrow(/was registered for transport 'websocket'/)
  })
})
