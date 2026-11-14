/**
 * @fileoverview A handshake the gate refuses is answered like any other failure of the authenticator,
 * and is not logged for each request.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  AuthenticationUnavailableError,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'

type Next = (error?: Error) => void

function makeSocket() {
  return {
    id: 'sock-1',
    handshake: { address: '1.2.3.4', auth: {}, headers: { cookie: '' }, query: {} },
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
  }
}

describe('RealtimeGateway: a handshake refused as unavailable', () => {
  let gateway: RealtimeGateway
  let transport: {
    setServer: jest.Mock
    authenticate: jest.Mock
    registerSocket: jest.Mock
    shuttingDown: boolean
  }

  beforeEach(async () => {
    transport = {
      setServer: jest.fn(),
      authenticate: jest.fn(),
      registerSocket: jest.fn().mockResolvedValue(undefined),
      shuttingDown: false,
    }
    const module = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: WebSocketTransport, useValue: transport },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: { sse: {} } as BymaxRealtimeModuleOptions },
      ],
    }).compile()
    gateway = module.get(RealtimeGateway)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** Register the gateway on a fake server and return the middleware it installed. */
  function installMiddleware(): (socket: unknown, next: Next) => Promise<void> {
    const server = { use: jest.fn() }
    gateway.afterInit(server as never)
    return server.use.mock.calls[0]?.[0] as (socket: unknown, next: Next) => Promise<void>
  }

  it.each(['saturated', 'timeout'] as const)(
    'handleConnection disconnects, and logs nothing of its own, when the handshake is refused as %s',
    async (reason) => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      try {
        transport.authenticate.mockRejectedValue(new AuthenticationUnavailableError(reason))
        const socket = makeSocket()

        await gateway.handleConnection(socket as never)

        expect(socket.disconnect).toHaveBeenCalledWith(true)
        expect(transport.registerSocket).not.toHaveBeenCalled()
        expect(errorSpy).not.toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    },
  )

  // The gate counts these and logs once for each window; one line for each handshake would let an
  // attack flood the log.
  it.each(['saturated', 'timeout'] as const)(
    'answers the generic error, and logs nothing of its own, when the handshake is refused as %s',
    async (reason) => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      try {
        transport.authenticate.mockRejectedValue(new AuthenticationUnavailableError(reason))
        const next = jest.fn()

        await installMiddleware()(makeSocket(), next)

        expect((next.mock.calls[0]?.[0] as Error).message).toBe('Internal Server Error')
        expect(transport.registerSocket).not.toHaveBeenCalled()
        expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('handshake refused'))
      } finally {
        errorSpy.mockRestore()
      }
    },
  )
})
