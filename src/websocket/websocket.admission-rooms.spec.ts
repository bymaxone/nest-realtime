/**
 * @fileoverview Rooms an authenticator returns are joined at admission, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import { RealtimeService } from '../server/services/realtime.service'
import type { AuthenticationResult } from '../server/interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../server/interfaces/connection-lifecycle-hooks.interface'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const ROOM = 'workspace:w1'

/** Resolves once `release` is called; `entered` resolves when the hook starts. */
function gate(): { entered: Promise<void>; release: () => void; hook: () => Promise<void> } {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const held = new Promise<void>((resolve) => (release = resolve))
  return {
    entered,
    release,
    hook: async () => {
      enter()
      await held
    },
  }
}

describe('WebSocket: a room an authenticator returns is joined at admission', () => {
  let app: INestApplication
  let url: string
  let service: RealtimeService
  let connections: ConnectionRegistry
  let socket: Socket | undefined
  let received: unknown[]

  async function boot(
    authenticate: () => Promise<AuthenticationResult | null>,
    hooks: IConnectionLifecycleHooks,
  ): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate },
          hooks,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    service = module.get(RealtimeService)
    connections = module.get(ConnectionRegistry)
  }

  function connect(): Socket {
    received = []
    const s = io(url, { transports: ['websocket'], reconnection: false })
    s.on('scoped', (data: unknown) => received.push(data))
    return s
  }

  afterEach(async () => {
    socket?.close()
    socket = undefined
    await app.close()
    jest.restoreAllMocks()
  })

  // Characterizes the window `rooms` closes: the socket is in user: and tenant: and the host's hook has not joined it yet.
  it('misses a publish made while a join from onConnect is still pending', async () => {
    const hold = gate()
    await boot(async () => ({ userId: 'u1' }), {
      onConnect: async (meta) => {
        await hold.hook()
        await service.joinRoom(meta.connectionId, ROOM)
      },
    })
    socket = connect()
    const established = new Promise<void>((resolve) =>
      socket?.on('connection:established', () => resolve()),
    )
    await hold.entered

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    hold.release()
    await established
    await service.emitToRoom(ROOM, 'scoped', { n: 2 })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(received).toStrictEqual([{ n: 2 }])
  })

  it('delivers a publish made while onConnect has not finished, to a room in `rooms`', async () => {
    const hold = gate()
    await boot(async () => ({ userId: 'u1', rooms: [ROOM] }), { onConnect: hold.hook })
    socket = connect()
    await hold.entered

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    hold.release()

    expect(received).toStrictEqual([{ n: 1 }])
  })

  it('delivers once to a connection whose list repeats a room, and keeps the list on its record', async () => {
    await boot(async () => ({ userId: 'u1', rooms: [ROOM, ROOM] }), {})
    socket = connect()
    await new Promise<void>((resolve) => socket?.on('connection:established', () => resolve()))

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(received).toStrictEqual([{ n: 1 }])
    expect(connections.byUser('u1', 'websocket')[0]?.originalAuth.rooms).toStrictEqual([ROOM, ROOM])
  })

  it('refuses a connection whose rooms break the rules, and registers nothing', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    await boot(async () => ({ userId: 'u1', rooms: ['user:u2'] }), {})
    socket = connect()
    const refusal = await new Promise<Error>((resolve) => socket?.on('connect_error', resolve))

    expect(refusal.message).toBe('Internal Server Error')
    expect(connections.byUser('u1', 'websocket')).toHaveLength(0)
  })
})
