/**
 * @fileoverview `onConnectFailure` on a real Socket.IO server.
 * @layer transport
 *
 * With `'close'`, a connection whose `onConnect` failed is refused before it is announced and
 * leaves no record behind; with `'ignore'` or no option it stays, as it does without the option.
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('WebSocket: onConnectFailure', () => {
  let app: INestApplication
  let url: string
  let connections: ConnectionRegistry
  let logged: jest.SpyInstance
  const sockets: Socket[] = []

  async function boot(onConnectFailure?: 'ignore' | 'close'): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          hooks: { onConnect: async () => Promise.reject(new Error('presence store down')) },
          ...(onConnectFailure ? { onConnectFailure } : {}),
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    connections = module.get(ConnectionRegistry)
  }

  /** Connect and settle with whether the server announced the connection before it went away. */
  function connect(): Promise<{ announced: boolean; socket: Socket }> {
    return new Promise((resolve) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false })
      sockets.push(socket)
      socket.on('connection:established', () => resolve({ announced: true, socket }))
      socket.on('disconnect', () => resolve({ announced: false, socket }))
      socket.on('connect_error', () => resolve({ announced: false, socket }))
    })
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

  it.each([
    ['unset', undefined],
    ["'ignore'", 'ignore' as const],
  ])(
    'keeps and announces the connection when onConnect fails and the option is %s',
    async (_l, option) => {
      await boot(option)
      const { announced, socket } = await connect()
      expect(announced).toBe(true)
      expect(socket.connected).toBe(true)
      expect(connections.allByTransport('websocket')).toHaveLength(1)
    },
  )

  it("refuses the connection, announced or recorded, when onConnect fails and the option is 'close'", async () => {
    await boot('close')
    const { announced, socket } = await connect()
    await sleep(300)
    expect(announced).toBe(false)
    expect(socket.connected).toBe(false)
    expect(connections.allByTransport('websocket')).toHaveLength(0)
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('onConnect hook failed: presence store down'),
    )
  })
})
