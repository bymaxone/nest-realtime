/**
 * @fileoverview A connection cannot be put in another user's or tenant's room by `joinRoom`.
 * @layer transport
 *
 * Over a real Socket.IO server: on WebSocket `emitToUser` and `emitToTenant` are delivered to the
 * room named after the identity, so joining that room by hand is receiving that identity's events.
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { RealtimeService } from '../server/services/realtime.service'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('WebSocket: joinRoom with a name the library composes', () => {
  let app: INestApplication
  let service: RealtimeService
  let url: string
  const sockets: Socket[] = []

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: {
            authenticate: async () => ({ userId: 'attacker', tenantId: 't-attacker' }),
          },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    service = module.get(RealtimeService)
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

  /** Connect, and resolve with the socket, its connection id and the events it receives. */
  function connect(): Promise<{ id: string; received: string[] }> {
    return new Promise((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false })
      sockets.push(socket)
      const received: string[] = []
      socket.onAny((event: string) => received.push(event))
      socket.on('connection:established', (hello: { connectionId: string }) =>
        resolve({ id: hello.connectionId, received }),
      )
      socket.on('connect_error', reject)
    })
  }

  // Scenario: a host forwards a client-supplied room id to joinRoom. Expected: a reserved name is
  // refused, and the event published for that identity does not reach this connection. Without
  // the refusal the join succeeds and the connection receives the other user's or tenant's event.
  it.each([
    ['user:victim', (s: RealtimeService) => s.emitToUser('victim', 'secret', {})],
    ['tenant:other', (s: RealtimeService) => s.emitToTenant('other', 'secret', {})],
  ])('refuses %s, so the event for that identity never arrives', async (room, emit) => {
    const attacker = await connect()

    const outcome = await service.joinRoom(attacker.id, room).then(
      () => 'joined',
      () => 'refused',
    )
    await emit(service)
    await sleep(300)

    expect(outcome).toBe('refused')
    expect(attacker.received).not.toContain('secret')
  })

  // Scenario: the per-connection control room that revocation addresses. Expected: it is refused
  // too, so a connection is never in the room of another one.
  it('refuses connection:<id>, the room that revokes one connection', async () => {
    const first = await connect()
    const second = await connect()

    await expect(service.joinRoom(second.id, `connection:${first.id}`)).rejects.toMatchObject({
      code: 'REALTIME_AUTH_FAILED',
    })
  })

  // Scenario: a room of the application's own. Expected: it works end to end.
  it('joins a free-form room', async () => {
    const attacker = await connect()
    await service.joinRoom(attacker.id, 'workspace:w1')
    await service.emitToRoom('workspace:w1', 'hello', {})
    await sleep(200)
    expect(attacker.received).toContain('hello')
  })
})
