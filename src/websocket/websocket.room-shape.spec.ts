/**
 * @fileoverview A room name that is not a string cannot put a connection in another identity's room.
 * @layer transport
 *
 * Over a real Socket.IO server and real clients: `socket.join` accepts an array of names, so a
 * reserved name wrapped in one skips a check written for strings and the connection then receives
 * what `emitToUser`, `emitToTenant` and the per-connection room deliver.
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
import { WebSocketTransport } from './transports/websocket/websocket.transport'

jest.setTimeout(20_000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('WebSocket: a room name that is not a string', () => {
  let app: INestApplication
  let service: RealtimeService
  let transport: WebSocketTransport
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
    transport = module.get(WebSocketTransport)
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

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

  const attempts = (victim: string): Array<[string, unknown]> => [
    ['user room in an array', ['user:victim']],
    ['tenant room in an array', ['tenant:other']],
    ['connection room in an array', [`connection:${victim}`]],
    ['free and reserved names in an array', ['ok', 'user:victim']],
    ['reserved name in a nested array', [['user:victim']]],
    ['reserved name in a Set', new Set(['user:victim'])],
  ]

  // Scenario: the attacker's connection id is forwarded to joinRoom with an array. Expected: the
  // call is refused, on the service and on the transport, and the events published for the other
  // identity never arrive. Without the guard every call resolves and the events are received.
  it.each(['service', 'transport'] as const)(
    'refuses an array in joinRoom on the %s, so nothing for another identity arrives',
    async (via) => {
      const attacker = await connect()
      const victim = await connect()
      const target = via === 'service' ? service : transport

      for (const [, value] of attempts(victim.id)) {
        const outcome = await target.joinRoom(attacker.id, value as never).then(
          () => 'joined',
          () => 'refused',
        )
        expect(outcome).toBe('refused')
      }
      await service.emitToUser('victim', 'user-secret', {})
      await service.emitToTenant('other', 'tenant-secret', {})
      await service.emitToRoom(`connection:${victim.id}`, 'connection-secret', {})
      await sleep(300)

      expect(attacker.received).not.toEqual(expect.arrayContaining(['user-secret']))
      expect(attacker.received).not.toContain('tenant-secret')
      expect(attacker.received).not.toContain('connection-secret')
    },
  )

  // Scenario: leaveRoom with an array naming the attacker's own composed room. Expected: refused,
  // and the connection still receives its own user's events.
  it.each(['service', 'transport'] as const)(
    'refuses an array in leaveRoom on the %s and leaves the membership alone',
    async (via) => {
      const attacker = await connect()
      const target = via === 'service' ? service : transport

      const outcome = await target.leaveRoom(attacker.id, ['user:attacker'] as never).then(
        () => 'left',
        () => 'refused',
      )
      await service.emitToUser('attacker', 'own', {})
      await sleep(200)

      expect(outcome).toBe('refused')
      expect(attacker.received).toContain('own')
    },
  )

  // Scenario: emitToRoom with an array. Expected: refused instead of fanning out to every room named.
  it('refuses an array in emitToRoom', async () => {
    const attacker = await connect()
    await expect(
      transport.emitToRoom(['user:attacker', 'tenant:t-attacker'] as never, 'e', {}),
    ).rejects.toMatchObject({ code: 'REALTIME_AUTH_FAILED' })
    await sleep(100)
    expect(attacker.received).not.toContain('e')
  })

  // Scenario: the refusal says which call refused and what kind of value it was given, and not the value.
  it.each(['joinRoom', 'leaveRoom'] as const)(
    'names the call and the kind of value in %s',
    async (op) => {
      const attacker = await connect()
      await expect(transport[op](attacker.id, ['user:victim'] as never)).rejects.toThrow(
        `[RealtimeService] REALTIME_AUTH_FAILED: ${op}: \`roomId\` must be a non-empty string, got an array`,
      )
      await expect(transport.emitToRoom(null as never, 'e', {})).rejects.toThrow(
        '[RealtimeService] REALTIME_AUTH_FAILED: emitToRoom: `roomId` must be a non-empty string, got null',
      )
    },
  )

  // Scenario: a free-form string still works end to end.
  it('still joins a free-form string room', async () => {
    const attacker = await connect()
    await service.joinRoom(attacker.id, 'workspace:w1')
    await service.emitToRoom('workspace:w1', 'hello', {})
    await sleep(200)
    expect(attacker.received).toContain('hello')
  })
})
