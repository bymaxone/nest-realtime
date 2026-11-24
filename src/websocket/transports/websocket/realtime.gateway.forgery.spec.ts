/**
 * @fileoverview The identity a socket is registered under is what the handshake middleware kept or a fresh
 * authentication returned, and the async method that hands it over resolves its promise with an object: a host that
 * planted a `then` answers for it.
 * @layer transport
 */
import { EventEmitter } from 'node:events'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { plantSelfErasingThen } from '../../../../test/support/forged-promise'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'

type Next = (err?: Error) => void

const FORGED = { auth: { userId: 'attacker', tenantId: 't-other' }, ticket: undefined }

function makeSocket() {
  const engine = new EventEmitter()
  return {
    id: 'sock-1',
    handshake: { address: '1.2.3.4', auth: {}, headers: { cookie: '' }, query: {} },
    conn: engine,
    disconnect: jest.fn(),
    emit: jest.fn(),
  }
}

async function setup() {
  const releases: jest.Mock[] = []
  const transport = {
    setServer: jest.fn(),
    admit: () => {
      const release = jest.fn()
      releases.push(release)
      return { release, renew: jest.fn() }
    },
    authenticate: jest.fn().mockResolvedValue({ userId: 'alice', tenantId: 't-1' }),
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
  return { gateway, middleware, releases, transport }
}

describe('RealtimeGateway: what the handshake hands over is checked last', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'then')
    jest.restoreAllMocks()
  })

  // Scenario: a socket the middleware authenticated, and a `then` that erases itself is planted on Object.prototype by
  // namespace middleware that ran after ours, before the connection handler takes the identity. Expected: the socket
  // is refused and disconnected, nothing is registered under the forged identity, and the place the middleware took is
  // given back once.
  it('refuses a then planted on objects between the middleware and the connection handler', async () => {
    const { gateway, middleware, releases, transport } = await setup()
    const socket = makeSocket()
    await middleware(socket, jest.fn())
    plantSelfErasingThen(Object.prototype, FORGED)

    await gateway.handleConnection(socket as never)
    Reflect.deleteProperty(Object.prototype, 'then')

    expect(transport.registerSocket).not.toHaveBeenCalled()
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(releases[0]).toHaveBeenCalledTimes(1)
  })
})
