/**
 * @fileoverview Smoke tests for RealtimeIoAdapter + @socket.io/redis-adapter cross-instance fan-out.
 * @layer e2e
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import IORedisMock from 'ioredis-mock'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { RealtimeService } from '../../src/server/services/realtime.service'
import { RealtimeIoAdapter } from '../../src/server/transports/websocket/realtime-io-adapter'
import type { IConnectionAuthenticator } from '../../src/server/interfaces/connection-authenticator.interface'

const authenticator: IConnectionAuthenticator = {
  authenticate: jest.fn().mockResolvedValue({ userId: 'u-cross', tenantId: 't-1' }),
}

async function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs)
    socket.once(event, (data: T) => { clearTimeout(timer); resolve(data) })
  })
}

describe('RealtimeIoAdapter + Redis adapter smoke', () => {
  let appA: INestApplication
  let appB: INestApplication
  let portA: number
  let portB: number
  let clients: ClientSocket[]
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    clients = []
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    for (const c of clients) {
      if (c.connected) c.disconnect()
    }
    if (appA) await appA.close()
    if (appB) await appB.close()
    logSpy.mockRestore()
  })

  async function buildApp(pubClient: IORedisMock): Promise<{ app: INestApplication; port: number; service: RealtimeService }> {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'websocket',
          authenticator,
          websocket: { redisAdapter: { pubClient } },
        }),
      ],
    }).compile()

    const app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.init()
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    const service = app.get(RealtimeService)
    return { app, port, service }
  }

  it('createIOServer installs the Redis adapter without throwing', async () => {
    // Basic smoke: boot with a mock Redis pubClient and confirm no error.
    const pubClient = new IORedisMock()
    const result = await buildApp(pubClient)
    appA = result.app
    portA = result.port
    expect(portA).toBeGreaterThan(0)
  })

  it('single instance: emitToUser reaches a connected client', async () => {
    // A single-instance emit works with the Redis adapter installed.
    const pubClient = new IORedisMock()
    const { app, port, service } = await buildApp(pubClient)
    appA = app
    portA = port

    const socket = ioClient(`http://localhost:${portA}`, {
      auth: { token: 'ok' },
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)

    await waitForEvent(socket, 'connection:established')
    const recv = waitForEvent<unknown>(socket, 'hi')
    await service.emitToUser('u-cross', 'hi', { x: 1 })
    expect(await recv).toEqual({ x: 1 })
  })

  it('cross-instance: emit on server A reaches client on server B', async () => {
    // Two Nest instances share a single in-memory Redis backend, mirroring a
    // 2-node deployment behind one Redis. `duplicate()` returns clients backed by
    // the same ioredis-mock store, so @socket.io/redis-adapter's pub/sub channels
    // are shared across both instances. A message emitted on instance A MUST be
    // delivered to a client connected to instance B — the test fails (times out)
    // if the Redis adapter fan-out is broken.
    const sharedRedis = new IORedisMock()
    const pubA = sharedRedis.duplicate()
    const pubB = sharedRedis.duplicate()

    const resultA = await buildApp(pubA)
    appA = resultA.app
    portA = resultA.port

    const resultB = await buildApp(pubB)
    appB = resultB.app
    portB = resultB.port

    // Connect a client to server B; the socket joins user:u-cross on instance B.
    const socketB = ioClient(`http://localhost:${portB}`, {
      auth: { token: 'ok' },
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socketB)
    await waitForEvent(socketB, 'connection:established')

    // Emit on server A — the Redis adapter fans it out to instance B.
    const recv = waitForEvent<unknown>(socketB, 'cross-evt')
    await resultA.service.emitToUser('u-cross', 'cross-evt', 'cross-payload')

    expect(await recv).toBe('cross-payload')
  })
})
