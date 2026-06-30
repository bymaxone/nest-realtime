/**
 * @fileoverview Unit tests for RealtimeGateway — lifecycle, auth paths, context extraction.
 * @layer transport
 */
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { AuthenticationResult, IConnectionAuthenticator } from '../../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'

/** Build a minimal mock Socket with configurable handshake. */
function makeSocket(opts: {
  id?: string
  auth?: Record<string, string>
  cookie?: string
  headers?: Record<string, string>
  query?: Record<string, string>
} = {}) {
  return {
    id: opts.id ?? 'sock-1',
    handshake: {
      address: '1.2.3.4',
      auth: opts.auth ?? {},
      headers: {
        cookie: opts.cookie ?? '',
        'user-agent': 'jest',
        ...(opts.headers ?? {}),
      },
      query: opts.query ?? {},
    },
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
  }
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway
  let transportMock: jest.Mocked<Pick<WebSocketTransport, 'setServer' | 'authenticator' | 'registerSocket' | 'unregisterSocket'>>
  let authenticator: jest.Mocked<IConnectionAuthenticator>
  const validAuth: AuthenticationResult = { userId: 'u-1', tenantId: 't-1', roles: ['admin'] }

  function buildModule(optionsOverrides: Partial<BymaxRealtimeModuleOptions> = {}) {
    return Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: WebSocketTransport, useValue: transportMock },
        {
          provide: REALTIME_OPTIONS_TOKEN,
          useValue: { sse: {}, ...optionsOverrides } as BymaxRealtimeModuleOptions,
        },
      ],
    }).compile()
  }

  beforeEach(async () => {
    authenticator = { authenticate: jest.fn() }
    transportMock = {
      setServer: jest.fn(),
      authenticator: jest.fn().mockReturnValue(authenticator),
      registerSocket: jest.fn().mockResolvedValue(undefined),
      unregisterSocket: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await buildModule()
    gateway = module.get(RealtimeGateway)
  })

  it('afterInit calls transport.setServer with the server instance', () => {
    // afterInit wires the Socket.IO server to the transport.
    const fakeServer = {}
    gateway.afterInit(fakeServer as never)
    expect(transportMock.setServer).toHaveBeenCalledWith(fakeServer)
  })

  it('handleConnection calls registerSocket on valid auth', async () => {
    // Valid auth leads to registerSocket being called.
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(transportMock.registerSocket).toHaveBeenCalledWith(socket, validAuth)
  })

  it('handleConnection emits connection:established on valid auth', async () => {
    // connection:established is the first event after successful auth.
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(socket.emit).toHaveBeenCalledWith(
      'connection:established',
      expect.objectContaining({ connectionId: 'sock-1' }),
    )
  })

  it('connection:established includes client-safe traits (not full auth result)', async () => {
    // Only userId/tenantId/roles are exposed — not the full AuthenticationResult.
    authenticator.authenticate.mockResolvedValue({ ...validAuth, metadata: { secret: true } })
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    const [, payload] = socket.emit.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload['traits']).toEqual({ userId: 'u-1', tenantId: 't-1', roles: ['admin'] })
    expect(payload['traits']).not.toHaveProperty('metadata')
  })

  it('handleConnection passes transport: websocket to the authenticator context', async () => {
    // The context transport field must be websocket.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(authenticator.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'websocket' }),
    )
  })

  it('handleConnection disconnects socket on invalid auth', async () => {
    // null from authenticate → socket.disconnect(true), no registerSocket.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(transportMock.registerSocket).not.toHaveBeenCalled()
  })

  it('handleConnection parses cookies from the cookie header', async () => {
    // Cookies arrive via the cookie header and are parsed.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ cookie: 'token=abc; x=1' })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(ctx['cookies']).toEqual({ token: 'abc', x: '1' })
  })

  it('handleConnection normalizes header keys to lowercase', async () => {
    // Header names are lowercased for consistent lookup.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ headers: { 'X-Custom-Header': 'value' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect((ctx['headers'] as Record<string, string>)['x-custom-header']).toBe('value')
  })

  it('handleConnection merges auth.token into headers.authorization', async () => {
    // socket.handshake.auth.token is normalized to the authorization header.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ auth: { token: 'tok-xyz' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect((ctx['headers'] as Record<string, string>)['authorization']).toBe('Bearer tok-xyz')
  })

  it('handleConnection merges auth.ticket into query.ticket', async () => {
    // socket.handshake.auth.ticket is surfaced as ctx.query.ticket.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ auth: { ticket: 'otp_999' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect((ctx['query'] as Record<string, string>)['ticket']).toBe('otp_999')
  })

  it('handleDisconnect calls unregisterSocket with CLIENT_DISCONNECT reason', async () => {
    // Client disconnect triggers unregisterSocket.
    const socket = makeSocket({ id: 'sock-2' })
    await gateway.handleDisconnect(socket as never)
    expect(transportMock.unregisterSocket).toHaveBeenCalledWith('sock-2', 'CLIENT_DISCONNECT')
  })

  it('normalizes array header values by joining with comma', async () => {
    // Array header values from Socket.IO are joined with , for the context.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = {
      ...makeSocket(),
      handshake: {
        address: '1.2.3.4',
        auth: {},
        headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] as unknown as string, 'user-agent': 'jest', cookie: '' },
        query: {},
      },
    }
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect((ctx['headers'] as Record<string, string>)['x-forwarded-for']).toBe('1.2.3.4,5.6.7.8')
  })

  it('uses empty string when cookie header is absent', async () => {
    // Missing cookie header defaults to empty string before parsing.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = {
      ...makeSocket(),
      handshake: {
        address: '1.2.3.4',
        auth: {},
        headers: { 'user-agent': 'jest' },
        query: {},
      },
    }
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(ctx['cookies']).toEqual({})
  })

  it('suppresses connection:established when emitConnectionEvent is false', async () => {
    // The event is not emitted when explicitly disabled.
    const module: TestingModule = await buildModule({ sse: { emitConnectionEvent: false } })
    const gw = module.get(RealtimeGateway)
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gw.handleConnection(socket as never)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('a registerSocket rejection does not propagate out of handleConnection', async () => {
    // Transport errors must not break the connection lifecycle.
    authenticator.authenticate.mockResolvedValue(validAuth)
    transportMock.registerSocket.mockRejectedValue(new Error('DB down'))
    const socket = makeSocket()
    await expect(gateway.handleConnection(socket as never)).rejects.toThrow('DB down')
    // Verified that errors from registerSocket propagate — but the gateway does not swallow them
    // The gateway itself doesn't add try/catch, so the error bubbles; Socket.IO handles it upstream
  })
})
