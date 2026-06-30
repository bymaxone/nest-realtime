/**
 * @fileoverview Tests for handshake auth extraction in RealtimeGateway.
 * @layer transport
 */
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { ConnectionAuthContext, IConnectionAuthenticator } from '../../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'

/** Builds a minimal fake Socket.IO socket for testing. */
function makeSocket(overrides: {
  auth?: Record<string, string>
  cookieHeader?: string
  headers?: Record<string, string>
  query?: Record<string, string>
} = {}) {
  const capturedCtx: Record<string, unknown>[] = []
  const authenticator: IConnectionAuthenticator = {
    authenticate: jest.fn(async (ctx: ConnectionAuthContext) => {
      capturedCtx.push(ctx as unknown as Record<string, unknown>)
      return null
    }),
  }

  const socket = {
    id: 'sock-1',
    handshake: {
      address: '127.0.0.1',
      auth: overrides.auth ?? {},
      headers: {
        cookie: overrides.cookieHeader ?? '',
        'user-agent': 'test-agent',
        ...(overrides.headers ?? {}),
      },
      query: overrides.query ?? {},
    },
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
  }

  return { socket, authenticator, capturedCtx }
}

describe('RealtimeGateway — handshake auth extraction', () => {
  let gateway: RealtimeGateway
  let transportMock: Partial<WebSocketTransport>

  beforeEach(async () => {
    transportMock = {
      setServer: jest.fn(),
      authenticator: jest.fn(),
      registerSocket: jest.fn().mockResolvedValue(undefined),
      unregisterSocket: jest.fn().mockResolvedValue(undefined),
    }

    const options: Partial<BymaxRealtimeModuleOptions> = { sse: {} }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: WebSocketTransport, useValue: transportMock },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: options },
      ],
    }).compile()

    gateway = module.get(RealtimeGateway)
  })

  it('parses cookie header into ctx.cookies via parseCookieHeader', async () => {
    // The authenticator receives the parsed cookies map, not the raw string.
    const capturedCtx: Record<string, unknown>[] = []
    const authenticator: IConnectionAuthenticator = {
      authenticate: jest.fn(async (ctx) => {
        capturedCtx.push(ctx as unknown as Record<string, unknown>)
        return null
      }),
    }
    ;(transportMock.authenticator as jest.Mock).mockReturnValue(authenticator)

    const { socket } = makeSocket({ cookieHeader: 'access_token=abc; theme=dark' })
    await gateway.handleConnection(socket as never)

    expect(capturedCtx).toHaveLength(1)
    const ctx = capturedCtx[0]!
    expect(ctx['cookies']).toEqual({ access_token: 'abc', theme: 'dark' })
  })

  it('normalizes auth.token into ctx.headers.authorization as Bearer', async () => {
    // socket.handshake.auth.token → 'Bearer <token>' in the built context.
    const capturedCtx: Record<string, unknown>[] = []
    const authenticator: IConnectionAuthenticator = {
      authenticate: jest.fn(async (ctx) => {
        capturedCtx.push(ctx as unknown as Record<string, unknown>)
        return null
      }),
    }
    ;(transportMock.authenticator as jest.Mock).mockReturnValue(authenticator)

    const { socket } = makeSocket({ auth: { token: 'eyJhbGci.test' } })
    await gateway.handleConnection(socket as never)

    expect(capturedCtx).toHaveLength(1)
    const ctx = capturedCtx[0]!
    expect((ctx['headers'] as Record<string, string>)['authorization']).toBe(
      'Bearer eyJhbGci.test',
    )
  })

  it('normalizes auth.ticket into ctx.query.ticket', async () => {
    // socket.handshake.auth.ticket → ctx.query.ticket for the ticket pattern.
    const capturedCtx: Record<string, unknown>[] = []
    const authenticator: IConnectionAuthenticator = {
      authenticate: jest.fn(async (ctx) => {
        capturedCtx.push(ctx as unknown as Record<string, unknown>)
        return null
      }),
    }
    ;(transportMock.authenticator as jest.Mock).mockReturnValue(authenticator)

    const { socket } = makeSocket({ auth: { ticket: 'otp_12345' } })
    await gateway.handleConnection(socket as never)

    expect(capturedCtx).toHaveLength(1)
    const ctx = capturedCtx[0]!
    expect((ctx['query'] as Record<string, string>)['ticket']).toBe('otp_12345')
  })

  it('sets transport: websocket on the built context', async () => {
    // The authenticator always sees transport: 'websocket' for WS connections.
    const capturedCtx: Record<string, unknown>[] = []
    const authenticator: IConnectionAuthenticator = {
      authenticate: jest.fn(async (ctx) => {
        capturedCtx.push(ctx as unknown as Record<string, unknown>)
        return null
      }),
    }
    ;(transportMock.authenticator as jest.Mock).mockReturnValue(authenticator)

    const { socket } = makeSocket()
    await gateway.handleConnection(socket as never)

    expect(capturedCtx[0] && capturedCtx[0]['transport']).toBe('websocket')
  })

  it('does not throw when auth object is absent from handshake', async () => {
    // Missing auth field is handled gracefully — no TypeError.
    const authenticator: IConnectionAuthenticator = {
      authenticate: jest.fn().mockResolvedValue(null),
    }
    ;(transportMock.authenticator as jest.Mock).mockReturnValue(authenticator)

    const { socket } = makeSocket({ auth: {} })
    await expect(gateway.handleConnection(socket as never)).resolves.toBeUndefined()
  })
})
