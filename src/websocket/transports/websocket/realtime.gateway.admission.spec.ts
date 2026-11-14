/**
 * @fileoverview RealtimeGateway holds a place for a socket from before its handshake is
 * authenticated, and gives it back however the handshake ends.
 * @layer transport
 */
import { EventEmitter } from 'node:events'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  AuthenticationGate,
  ConnectionAdmission,
  ConnectionLimitError,
  ConnectionRegistry,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'

type Next = (err?: Error) => void

/** A socket on an engine connection the test can close, as a client leaving would; sockets may share one. */
function makeSocket(engine: EventEmitter = new EventEmitter()) {
  return {
    close: () => engine.emit('close'),
    socket: {
      id: 'sock-1',
      handshake: { address: '1.2.3.4', auth: {}, headers: { cookie: '' }, query: {} },
      conn: engine,
      disconnect: jest.fn(),
      emit: jest.fn(),
    },
  }
}

/**
 * A gateway over a one-place admission. With `gateTimeoutMs`, `authenticate` goes through a real
 * gate that gives up on the authenticator after that long, as the transport does.
 */
async function setup(authenticate: jest.Mock, gateTimeoutMs?: number) {
  const timeouts = gateTimeoutMs === undefined ? {} : { authenticateTimeoutMs: gateTimeoutMs }
  const base = {
    transport: 'websocket',
    authenticator: { authenticate: async () => null },
  } as const
  const admission = new ConnectionAdmission(
    { ...base, maxConnections: 1, ...timeouts },
    new ConnectionRegistry(),
  )
  const gate = new AuthenticationGate({ ...base, ...timeouts }, { authenticate })
  const transport = {
    setServer: jest.fn(),
    admit: () => admission.admit(),
    authenticate:
      gateTimeoutMs === undefined ? authenticate : (ctx: never) => gate.authenticate(ctx),
    registerSocket: jest.fn().mockResolvedValue(undefined),
    shuttingDown: false,
  }
  const module = await Test.createTestingModule({
    providers: [
      RealtimeGateway,
      { provide: WebSocketTransport, useValue: transport },
      { provide: REALTIME_OPTIONS_TOKEN, useValue: {} as BymaxRealtimeModuleOptions },
    ],
  }).compile()
  const gateway = module.get(RealtimeGateway)
  const server = { use: jest.fn() }
  gateway.afterInit(server as never)
  const middleware = server.use.mock.calls[0]?.[0] as (socket: unknown, next: Next) => Promise<void>
  return { admission, gateway, middleware, transport }
}

describe('RealtimeGateway: the place held for a socket', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  // Socket.IO emits no `disconnect` for a socket that was never connected, and runs no
  // `handleConnection` for one whose client left while it was being authenticated.
  it('gives the place back when the client leaves while it is being authenticated', async () => {
    let finish: (value: { userId: string }) => void = () => undefined
    const authenticate = jest.fn(
      () => new Promise<{ userId: string }>((resolve) => (finish = resolve)),
    )
    const { admission, middleware } = await setup(authenticate)
    const { socket, close } = makeSocket()
    const pending = middleware(socket, jest.fn())
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    close()

    expect(() => admission.admit()).not.toThrow()
    finish({ userId: 'u1' })
    await pending
  })

  it('refuses with the generic error, and does not ask the authenticator, when the instance is full', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const { admission, middleware } = await setup(authenticate)
    admission.admit()
    const next = jest.fn()

    await middleware(makeSocket().socket, next)

    expect((next.mock.calls[0]?.[0] as Error).message).toBe('Internal Server Error')
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('gives the place back when the authenticator refuses the credentials', async () => {
    const { admission, middleware } = await setup(jest.fn().mockResolvedValue(null))

    await middleware(makeSocket().socket, jest.fn())

    expect(() => admission.admit()).not.toThrow()
  })

  it('gives the place back once the socket is registered', async () => {
    const { admission, gateway, middleware } = await setup(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    )
    const { socket } = makeSocket()
    await middleware(socket, jest.fn())
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    await gateway.handleConnection(socket as never)

    expect(() => admission.admit()).not.toThrow()
  })

  it('takes a place itself for a socket the middleware never saw, and gives it back', async () => {
    const { admission, gateway, transport } = await setup(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    )
    transport.registerSocket.mockImplementation(async () => {
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
    })

    await gateway.handleConnection(makeSocket().socket as never)

    expect(() => admission.admit()).not.toThrow()
  })

  it('disconnects a socket the middleware never saw when the instance is full', async () => {
    const { admission, gateway, transport } = await setup(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    )
    admission.admit()
    const { socket } = makeSocket()

    await gateway.handleConnection(socket as never)

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(transport.registerSocket).not.toHaveBeenCalled()
  })

  it('gives the place back when the client leaves while a socket the middleware never saw is being authenticated', async () => {
    let finish: (value: { userId: string }) => void = () => undefined
    const authenticate = jest.fn(
      () => new Promise<{ userId: string }>((resolve) => (finish = resolve)),
    )
    const { admission, gateway } = await setup(authenticate)
    const { socket, close } = makeSocket()
    const pending = gateway.handleConnection(socket as never)
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    close()

    expect(() => admission.admit()).not.toThrow()
    finish({ userId: 'u1' })
    await pending
  })

  // The registry holds a socket from the moment registration is called, so a place held for the rest
  // of it, an `onConnect` hook included, would count the socket twice.
  it('gives the place back as registration begins, not when a slow onConnect hook ends', async () => {
    const { admission, gateway, middleware, transport } = await setup(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    )
    transport.registerSocket.mockReturnValue(new Promise<void>(() => undefined))
    const { socket } = makeSocket()
    await middleware(socket, jest.fn())

    void gateway.handleConnection(socket as never)
    await new Promise((resolve) => setImmediate(resolve))

    expect(transport.registerSocket).toHaveBeenCalledTimes(1)
    expect(() => admission.admit()).not.toThrow()
  })

  it('gives the place back when a socket the middleware never saw is refused its credentials', async () => {
    const { admission, gateway } = await setup(jest.fn().mockResolvedValue(null))
    const { socket } = makeSocket()

    await gateway.handleConnection(socket as never)

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(() => admission.admit()).not.toThrow()
  })

  // Namespace middleware that runs after ours can hold a socket past the time bound; its place may
  // have been taken by then, and it must not register past the limit.
  describe('a socket delayed past the time bound by later middleware', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('is refused, and not registered, when its place was given back and taken', async () => {
      const { admission, gateway, middleware, transport } = await setup(
        jest.fn().mockResolvedValue({ userId: 'u1' }),
      )
      const { socket } = makeSocket()
      await middleware(socket, jest.fn())
      jest.advanceTimersByTime(15_000)
      admission.admit()

      await gateway.handleConnection(socket as never)

      expect(socket.disconnect).toHaveBeenCalledWith(true)
      expect(transport.registerSocket).not.toHaveBeenCalled()
    })

    it('is registered when its place was given back and nobody took it', async () => {
      const { gateway, middleware, transport } = await setup(
        jest.fn().mockResolvedValue({ userId: 'u1' }),
      )
      const { socket } = makeSocket()
      await middleware(socket, jest.fn())
      jest.advanceTimersByTime(15_000)

      await gateway.handleConnection(socket as never)

      expect(transport.registerSocket).toHaveBeenCalledTimes(1)
      expect(socket.disconnect).not.toHaveBeenCalled()
    })
  })

  // A derived transport's registration may throw before it returns a promise; the place goes back.
  it('gives the place back when registration throws as it is called', async () => {
    const { admission, gateway, middleware, transport } = await setup(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    )
    transport.registerSocket.mockImplementation(() => {
      throw new Error('registration broke')
    })
    const { socket } = makeSocket()
    await middleware(socket, jest.fn())

    await gateway.handleConnection(socket as never)

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(() => admission.admit()).not.toThrow()
  })

  describe('an authenticator that never answers', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('keeps the place until the gate gives up on the handshake, and gives it back then', async () => {
      const { admission, middleware } = await setup(
        jest.fn(() => new Promise(() => undefined)),
        1_000,
      )
      const next = jest.fn()
      const pending = middleware(makeSocket().socket, next)

      jest.advanceTimersByTime(999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      jest.advanceTimersByTime(1)
      await pending

      expect(next).toHaveBeenCalledTimes(1)
      expect((next.mock.calls[0]?.[0] as Error).message).toBe('Internal Server Error')
      expect(() => admission.admit()).not.toThrow()
    })
  })

  // Several namespaces share one engine connection: a listener left on it by each handshake that
  // ends without the connection closing would grow for as long as the client stays connected.
  describe('the listener on the engine connection', () => {
    it('is removed when a handshake is refused, however many are made on the same connection', async () => {
      const engine = new EventEmitter()
      const { middleware } = await setup(jest.fn().mockResolvedValue(null))

      for (let i = 0; i < 1_000; i += 1) await middleware(makeSocket(engine).socket, jest.fn())

      expect(engine.listenerCount('close')).toBe(0)
    })

    it('is removed when the socket is registered, and when it is refused for want of room', async () => {
      const engine = new EventEmitter()
      const { admission, gateway, middleware } = await setup(
        jest.fn().mockResolvedValue({ userId: 'u1' }),
      )
      const { socket } = makeSocket(engine)
      await middleware(socket, jest.fn())
      expect(engine.listenerCount('close')).toBe(1)

      await gateway.handleConnection(socket as never)
      expect(engine.listenerCount('close')).toBe(0)

      admission.admit()
      await middleware(makeSocket(engine).socket, jest.fn())
      expect(engine.listenerCount('close')).toBe(0)
    })

    it('is removed for a socket the middleware never saw, whether it is registered or refused', async () => {
      const engine = new EventEmitter()
      const { gateway, transport } = await setup(jest.fn().mockResolvedValue({ userId: 'u1' }))

      await gateway.handleConnection(makeSocket(engine).socket as never)
      transport.registerSocket.mockImplementation(() => {
        throw new Error('registration broke')
      })
      await gateway.handleConnection(makeSocket(engine).socket as never)

      expect(engine.listenerCount('close')).toBe(0)
    })
  })
})
