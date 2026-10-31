/**
 * @fileoverview Unit tests for RealtimeGateway — lifecycle, auth paths, context extraction.
 * @layer transport
 */
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type {
  AuthenticationResult,
  IConnectionAuthenticator,
  BymaxRealtimeModuleOptions,
} from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from './websocket.transport'
import { RealtimeGateway } from './realtime.gateway'
import { RealtimeIoAdapter } from './realtime-io-adapter'

/** Build a minimal mock Socket with configurable handshake. */
function makeSocket(
  opts: {
    id?: string
    auth?: Record<string, string>
    cookie?: string
    headers?: Record<string, string>
    query?: Record<string, string>
  } = {},
) {
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
  let transportMock: jest.Mocked<
    Pick<WebSocketTransport, 'setServer' | 'authenticator' | 'registerSocket' | 'unregisterSocket'>
  >
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

  it('handleConnection disconnects when the authenticator returns a blank userId', async () => {
    // Fail closed: a blank identity indexes every such connection under one key and
    // joins them to the room `user:`, so the socket is refused rather than registered.
    authenticator.authenticate.mockResolvedValue({ userId: '' })
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(transportMock.registerSocket).not.toHaveBeenCalled()
  })

  it('handleConnection disconnects when the authenticator returns a blank tenantId', async () => {
    // An empty tenant is a shared bucket rather than an absent one; undefined is the
    // supported way to say a connection belongs to no tenant.
    authenticator.authenticate.mockResolvedValue({ userId: 'u-1', tenantId: ' ' })
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(transportMock.registerSocket).not.toHaveBeenCalled()
  })

  it('applies tenantResolver before registering the socket', async () => {
    // The resolver runs on both transports or on neither. It decides the tenant that
    // routes a connection's events, so a consumer configuring it must get the same
    // tenant whichever transport the client happened to open.
    authenticator.authenticate.mockResolvedValue(validAuth)
    const module = await buildModule({ tenantResolver: () => 't-resolved' })
    const g = module.get(RealtimeGateway)
    const socket = makeSocket()
    await g.handleConnection(socket as never)
    expect(transportMock.registerSocket).toHaveBeenCalledWith(
      socket,
      expect.objectContaining({ userId: 'u-1', tenantId: 't-resolved' }),
    )
  })

  it('reports the resolved tenant in connection:established, not the raw one', async () => {
    // The client is told which tenant it is on; telling it the pre-resolver value
    // would contradict the routing the server actually applied.
    authenticator.authenticate.mockResolvedValue(validAuth)
    const module = await buildModule({ tenantResolver: () => 't-resolved' })
    const g = module.get(RealtimeGateway)
    const socket = makeSocket()
    await g.handleConnection(socket as never)
    expect(socket.emit).toHaveBeenCalledWith(
      'connection:established',
      expect.objectContaining({ traits: expect.objectContaining({ tenantId: 't-resolved' }) }),
    )
  })

  it('falls back to the auth tenantId when no resolver is configured', async () => {
    // Applying the resolver on both transports must not change what happens when there
    // is no resolver: the authenticator's own tenant still routes the connection.
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gateway.handleConnection(socket as never)
    expect(transportMock.registerSocket).toHaveBeenCalledWith(
      socket,
      expect.objectContaining({ tenantId: 't-1' }),
    )
  })

  it('afterInit calls transport.setServer with the server instance', () => {
    // afterInit wires the Socket.IO server to the transport.
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const fakeServer = { use: jest.fn() }
      gateway.afterInit(fakeServer as never)
      expect(transportMock.setServer).toHaveBeenCalledWith(fakeServer)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('afterInit logs the initialized message', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      gateway.afterInit({ use: jest.fn() } as never)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('initialized'))
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  describe('afterInit — the adapter check', () => {
    let errorSpy: jest.SpyInstance

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it('reports a server that RealtimeIoAdapter did not create, naming the fix and the options it drops', async () => {
      // Under any other adapter the websocket.* options are dropped and the gateway's own
      // CORS (origin: false) stays in force, so the message has to say what to add.
      gateway = (
        await buildModule({
          websocket: { cors: { origin: 'https://app.example' }, redisAdapter: { pubClient: {} } },
        })
      ).get(RealtimeGateway)

      gateway.afterInit({ use: jest.fn() } as never)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const message = String(errorSpy.mock.calls[0]?.[0])
      expect(message).toContain('RealtimeIoAdapter is not the active WebSocket adapter')
      expect(message).toContain('(cors, redisAdapter)')
      expect(message).toContain('origin: false')
      expect(message).toContain('app.useWebSocketAdapter(new RealtimeIoAdapter(app))')
      expect(message).toContain("'@bymax-one/nest-realtime/websocket'")
    })

    it('still reports it when no websocket option is set, without naming any', () => {
      // The gateway CORS is closed whether or not the consumer configured anything.
      gateway.afterInit({ use: jest.fn() } as never)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const message = String(errorSpy.mock.calls[0]?.[0])
      expect(message).toContain('so the websocket options are ignored and the gateway CORS')
      expect(message).not.toMatch(/websocket options \(/)
    })

    it('says in the README troubleshooting section exactly what it logs', () => {
      // A consumer who meets the message looks it up in the README, so the text must match.
      gateway.afterInit({ use: jest.fn() } as never)
      const message = String(errorSpy.mock.calls[0]?.[0])
      const readme = readFileSync(join(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8')

      expect(readme).toContain(message)
    })

    it('stays silent when the server came from RealtimeIoAdapter', () => {
      // The adapter is the supported setup, so the gateway has nothing to report.
      const superSpy = jest
        .spyOn(IoAdapter.prototype, 'createIOServer')
        .mockImplementation(() => ({ adapter: jest.fn(), use: jest.fn() }))
      try {
        const app = { get: jest.fn().mockReturnValue({ sse: {} }) }
        const server = new RealtimeIoAdapter(app as never).createIOServer(3000)

        gateway.afterInit(server as never)

        expect(errorSpy).not.toHaveBeenCalled()
      } finally {
        superSpy.mockRestore()
      }
    })
  })

  it('handleConnection logs the error message when authenticate throws', async () => {
    authenticator.authenticate.mockRejectedValue(new Error('token-verify-fail'))
    const socket = makeSocket()
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      await gateway.handleConnection(socket as never)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('token-verify-fail'))
    } finally {
      errorSpy.mockRestore()
    }
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
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(ctx['cookies']).toEqual({ token: 'abc', x: '1' })
  })

  it('handleConnection normalizes header keys to lowercase', async () => {
    // Header names are lowercased for consistent lookup.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ headers: { 'X-Custom-Header': 'value' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect((ctx['headers'] as Record<string, string>)['x-custom-header']).toBe('value')
  })

  it('handleConnection merges auth.token into headers.authorization', async () => {
    // socket.handshake.auth.token is normalized to the authorization header.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ auth: { token: 'tok-xyz' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect((ctx['headers'] as Record<string, string>)['authorization']).toBe('Bearer tok-xyz')
  })

  it('handleConnection merges auth.ticket into query.ticket', async () => {
    // socket.handshake.auth.ticket is surfaced as ctx.query.ticket.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ auth: { ticket: 'otp_999' } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
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
        headers: {
          'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] as unknown as string,
          'user-agent': 'jest',
          cookie: '',
        },
        query: {},
      },
    }
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
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
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(ctx['cookies']).toEqual({})
  })

  it('suppresses connection:established when websocket.emitConnectionEvent is false', async () => {
    // The event is not emitted when explicitly disabled via the WS option.
    const module: TestingModule = await buildModule({ websocket: { emitConnectionEvent: false } })
    const gw = module.get(RealtimeGateway)
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gw.handleConnection(socket as never)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('emits connection:established over WebSocket even when sse.emitConnectionEvent is false', async () => {
    // WS connection-event behavior is decoupled from the SSE-namespaced flag.
    const module: TestingModule = await buildModule({ sse: { emitConnectionEvent: false } })
    const gw = module.get(RealtimeGateway)
    authenticator.authenticate.mockResolvedValue(validAuth)
    const socket = makeSocket()
    await gw.handleConnection(socket as never)
    expect(socket.emit).toHaveBeenCalledWith('connection:established', expect.any(Object))
  })

  it('normalizes an array-valued ticket query parameter to its first value', async () => {
    // ParsedUrlQuery can yield string[]; the single-value ticket is collapsed.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ query: { ticket: ['t-first', 't-second'] as unknown as string } })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect((ctx['query'] as Record<string, unknown>)['ticket']).toBe('t-first')
  })

  it('handleConnection disconnects socket and does not throw when authenticate() throws', async () => {
    // Fail-closed: an exception from the authenticator must not leave the socket connected.
    // The error is caught, logged, and socket.disconnect(true) is called so the socket
    // cannot linger in an unregistered state and receive broadcast events.
    authenticator.authenticate.mockRejectedValue(new Error('token verify failed'))
    const socket = makeSocket()
    await expect(gateway.handleConnection(socket as never)).resolves.toBeUndefined()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(transportMock.registerSocket).not.toHaveBeenCalled()
  })

  it('handleConnection disconnects socket and does not throw when registerSocket() throws', async () => {
    // Any unexpected error from downstream transport is caught: the socket is forcibly
    // disconnected rather than leaving it in a partially-registered limbo state.
    authenticator.authenticate.mockResolvedValue(validAuth)
    transportMock.registerSocket.mockRejectedValue(new Error('DB down'))
    const socket = makeSocket()
    await expect(gateway.handleConnection(socket as never)).resolves.toBeUndefined()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('does not add a ticket key when ticket is absent from both query and auth', async () => {
    // Kills ConditionalExpression true mutation: with "if (true)", query.ticket=undefined is set
    // explicitly, making the key appear even when no ticket was present.
    authenticator.authenticate.mockResolvedValue(null)
    const socket = makeSocket({ auth: {}, query: {} })
    await gateway.handleConnection(socket as never)
    const ctx = (authenticator.authenticate as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(Object.keys(ctx['query'] as object)).not.toContain('ticket')
  })

  // Kills L94 StringLiteral mutation ('' → "Stryker was here!").
  // When handshake.headers.cookie is absent (undefined), the ?? operator must fall back
  // to '' so parseCookieHeader receives an empty string, not the Stryker sentinel.
  // Both inputs yield {} from parseCookieHeader (no '=' in sentinel), so we spy on
  // the export to observe the exact argument passed by the gateway. The spy goes
  // through the same shared-runtime entry the gateway imports, so it intercepts
  // the binding the gateway actually calls.
  it('calls parseCookieHeader with empty string when handshake has no cookie header', async () => {
    const cookieMod = require('@bymax-one/nest-realtime/internal') as {
      parseCookieHeader: (cookieHeader: string) => Record<string, string>
    }
    const spy = jest.spyOn(cookieMod, 'parseCookieHeader')
    try {
      authenticator.authenticate.mockResolvedValue(null)
      // Socket handshake with no cookie key — handshake.headers.cookie is undefined.
      const socket = {
        ...makeSocket(),
        handshake: {
          address: '1.2.3.4',
          auth: {},
          headers: { 'user-agent': 'jest' }, // cookie key intentionally absent
          query: {},
        },
      }
      await gateway.handleConnection(socket as never)
      expect(spy).toHaveBeenCalledWith('')
    } finally {
      spy.mockRestore()
    }
  })
  describe('handshake authentication (before the connection is accepted)', () => {
    type Next = (err?: Error & { data?: { code?: string } }) => void

    /** Register the gateway on a fake server and return the middleware it installed. */
    function installMiddleware(): (socket: unknown, next: Next) => Promise<void> {
      const server = { use: jest.fn() }
      gateway.afterInit(server as never)
      return server.use.mock.calls[0]?.[0] as (socket: unknown, next: Next) => Promise<void>
    }

    it('registers one middleware on the server it is initialised with', () => {
      const server = { use: jest.fn() }
      gateway.afterInit(server as never)
      expect(server.use).toHaveBeenCalledTimes(1)
      expect(server.use).toHaveBeenCalledWith(expect.any(Function))
    })

    it('refuses with an error carrying REALTIME_AUTH_FAILED in message and data.code', async () => {
      // The client reads the code from connect_error and never sees a connection.
      authenticator.authenticate.mockResolvedValue(null as never)
      const next = jest.fn()

      await installMiddleware()(makeSocket(), next)

      expect(next).toHaveBeenCalledTimes(1)
      const err = next.mock.calls[0]?.[0] as Error & { data?: { code?: string } }
      expect(err.message).toBe('REALTIME_AUTH_FAILED')
      expect(err.data).toEqual({ code: 'REALTIME_AUTH_FAILED' })
    })

    it('lets an accepted handshake through and keeps its identity for handleConnection', async () => {
      authenticator.authenticate.mockResolvedValue(validAuth)
      const socket = makeSocket()
      const next = jest.fn()

      await installMiddleware()(socket, next)
      await gateway.handleConnection(socket as never)

      expect(next).toHaveBeenCalledWith()
      expect(authenticator.authenticate).toHaveBeenCalledTimes(1)
      expect(transportMock.registerSocket).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ userId: 'u-1', tenantId: 't-1' }),
      )
    })

    it('answers an authenticator failure with a generic error that carries no code, and logs it', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      try {
        authenticator.authenticate.mockRejectedValue(new Error('session store unreachable'))
        const next = jest.fn()

        await installMiddleware()(makeSocket(), next)

        const err = next.mock.calls[0]?.[0] as Error & { data?: unknown }
        expect(err.message).toBe('Internal Server Error')
        expect(err.data).toBeUndefined()
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('session store unreachable'))
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('answers a blank identity with the same generic error and registers nothing', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      try {
        authenticator.authenticate.mockResolvedValue({ userId: '' })
        const next = jest.fn()

        await installMiddleware()(makeSocket(), next)

        expect((next.mock.calls[0]?.[0] as Error).message).toBe('Internal Server Error')
        expect(transportMock.registerSocket).not.toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('applies tenantResolver in the middleware so handleConnection registers the resolved tenant', async () => {
      gateway = (await buildModule({ tenantResolver: () => 'resolved-tenant' })).get(
        RealtimeGateway,
      )
      authenticator.authenticate.mockResolvedValue({ userId: 'u-1', tenantId: 'raw-tenant' })
      const socket = makeSocket()

      await installMiddleware()(socket, jest.fn())
      await gateway.handleConnection(socket as never)

      expect(transportMock.registerSocket).toHaveBeenCalledWith(
        socket,
        expect.objectContaining({ tenantId: 'resolved-tenant' }),
      )
    })

    it('uses a handshake result for one connection only', async () => {
      authenticator.authenticate.mockResolvedValue(validAuth)
      const socket = makeSocket()

      await installMiddleware()(socket, jest.fn())
      await gateway.handleConnection(socket as never)
      await gateway.handleConnection(socket as never)

      expect(authenticator.authenticate).toHaveBeenCalledTimes(2)
    })
  })
})
