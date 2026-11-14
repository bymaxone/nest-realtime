/**
 * @fileoverview A consumer's lifecycle hook that fails must not take the process down or touch a connection.
 * @layer transport
 *
 * Over a real Socket.IO server, because the failure that matters is an unhandled rejection: Nest
 * runs the gateway's disconnect handler without waiting for it, so a rejection that escapes it
 * is the process's to crash on.
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { IConnectionLifecycleHooks } from '../server/interfaces/connection-lifecycle-hooks.interface'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('WebSocket: a lifecycle hook that fails', () => {
  let app: INestApplication
  let url: string
  let connections: ConnectionRegistry
  const sockets: Socket[] = []
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
  let logged: jest.SpyInstance

  async function boot(hooks: IConnectionLifecycleHooks, hookTimeoutMs?: number): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          hooks,
          ...(hookTimeoutMs !== undefined ? { hookTimeoutMs } : {}),
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    connections = module.get(ConnectionRegistry)
  }

  /** Connect a client and resolve once the server has announced the connection. */
  function connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false })
      sockets.push(socket)
      socket.on('connection:established', () => resolve(socket))
      socket.on('connect_error', reject)
      socket.on('disconnect', () => reject(new Error('disconnected before it was announced')))
    })
  }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

  // Nest does not wait for the disconnect handler, so a hook that rejects there crashes the process.
  it.each([
    ['rejects', async () => Promise.reject(new Error('presence store down'))],
    [
      'throws before it returns',
      () => {
        throw new Error('presence store down')
      },
    ],
  ])('does not leave an unhandled rejection when onDisconnect %s', async (_how, onDisconnect) => {
    await boot({ onDisconnect })
    const socket = await connect()
    const other = await connect()

    socket.close()
    await sleep(300)

    expect(unhandled).toStrictEqual([])
    expect(connections.allByTransport('websocket')).toHaveLength(1)
    expect(other.connected).toBe(true)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('onDisconnect hook failed'))
  })

  // A hook is a consumer's notification, not a condition of admission: the connection stays.
  it.each([
    ['rejects', async () => Promise.reject(new Error('audit log down'))],
    [
      'throws before it returns',
      () => {
        throw new Error('audit log down')
      },
    ],
  ])('keeps the connection, and announces it, when onConnect %s', async (_how, onConnect) => {
    await boot({ onConnect })

    const socket = await connect()

    expect(socket.connected).toBe(true)
    expect(connections.allByTransport('websocket')).toHaveLength(1)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('onConnect hook failed'))
  })

  it('does not put the failure of one connection hook on the others', async () => {
    let calls = 0
    await boot({
      onConnect: async () => {
        calls += 1
        if (calls === 1) throw new Error('first only')
      },
    })

    const first = await connect()
    const second = await connect()

    expect(first.connected).toBe(true)
    expect(second.connected).toBe(true)
    expect(connections.allByTransport('websocket')).toHaveLength(2)
  })

  // The library waits for onConnect before it announces the connection, so a hook that never
  // settles must be given up on or the client is never told it is connected.
  it('announces the connection after hookTimeoutMs when onConnect never settles', async () => {
    await boot({ onConnect: () => new Promise<void>(() => undefined) }, 300)
    const startedAt = Date.now()

    const socket = await connect()

    expect(socket.connected).toBe(true)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250)
    expect(connections.allByTransport('websocket')).toHaveLength(1)
    expect(logged).toHaveBeenCalledWith('onConnect hook failed: did not settle within 300 ms')
  })

  it('removes the connection when onDisconnect never settles, and the other client stays', async () => {
    await boot({ onDisconnect: () => new Promise<void>(() => undefined) }, 300)
    const socket = await connect()
    const other = await connect()

    socket.close()
    await sleep(700)

    expect(connections.allByTransport('websocket')).toHaveLength(1)
    expect(other.connected).toBe(true)
    expect(logged).toHaveBeenCalledWith('onDisconnect hook failed: did not settle within 300 ms')
  })
})
