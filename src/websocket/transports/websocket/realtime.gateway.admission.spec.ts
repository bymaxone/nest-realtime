/**
 * @fileoverview RealtimeGateway holds a place for a socket from before its handshake is
 * authenticated, and gives it back however the handshake ends.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  ConnectionAdmission,
  ConnectionLimitError,
  ConnectionRegistry,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'

type Next = (err?: Error) => void

/** A socket whose engine connection the test can close, as a client leaving would. */
function makeSocket() {
  const listeners = new Map<string, () => void>()
  return {
    close: () => listeners.get('close')?.(),
    socket: {
      id: 'sock-1',
      handshake: { address: '1.2.3.4', auth: {}, headers: { cookie: '' }, query: {} },
      conn: {
        once: jest.fn((event: string, listener: () => void) => {
          listeners.set(event, listener)
        }),
      },
      disconnect: jest.fn(),
      emit: jest.fn(),
    },
  }
}

async function setup(authenticate: jest.Mock) {
  const admission = new ConnectionAdmission(
    {
      transport: 'websocket',
      authenticator: { authenticate: async () => null },
      maxConnections: 1,
    },
    new ConnectionRegistry(),
  )
  const transport = {
    setServer: jest.fn(),
    admit: () => admission.admit(),
    authenticate,
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
})
