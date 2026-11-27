/**
 * @fileoverview WebSocket fan-out through `@socket.io/redis-adapter` against a real Redis: delivery
 * with host client options the subscriber duplicate must not take, after a late start and a
 * reconnect, and a close while the SUBSCRIBE is still queued. Needs `REDIS_URL`.
 * @layer e2e
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { connect, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import Redis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../../src/websocket/realtime-websocket.module'
import { RealtimeService } from '../../../src/server/services/realtime.service'
import { RealtimeIoAdapter } from '../../../src/websocket/transports/websocket/realtime-io-adapter'

const REDIS_URL = process.env['REDIS_URL']
if (!REDIS_URL) throw new Error('REDIS_URL is required for the Redis adapter subscriber suite')

const clients: Redis[] = []
const sockets: ClientSocket[] = []
const apps: INestApplication[] = []
const proxies: { close: () => void }[] = []

function client(url: string, extra: RedisOptions = {}): Redis {
  const redis = new Redis(url, { retryStrategy: () => 50, ...extra })
  redis.on('error', () => undefined)
  clients.push(redis)
  return redis
}

async function waitFor(what: string, condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** A TCP proxy to Redis whose port refuses connections until `up()`, and again after `down()`. */
async function redisProxy(): Promise<{
  url: string
  up: () => Promise<void>
  down: () => void
  close: () => void
}> {
  const target = new URL(REDIS_URL as string)
  const open: Socket[] = []
  const server: Server = createServer((socket) => {
    const upstream = connect(Number(target.port || 6379), target.hostname)
    open.push(socket, upstream)
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const down = (): void => {
    if (server.listening) server.close()
    for (const socket of open.splice(0)) socket.destroy()
  }
  const proxy = {
    url: `redis://127.0.0.1:${port}`,
    up: () => new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve)),
    down,
    close: down,
  }
  proxies.push(proxy)
  return proxy
}

async function instance(pubClient: Redis): Promise<{ port: number; service: RealtimeService }> {
  const module = await Test.createTestingModule({
    imports: [
      BymaxRealtimeWebSocketModule.forRoot({
        transport: 'websocket',
        authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        websocket: { redisAdapter: { pubClient } },
      }),
    ],
  }).compile()
  const app = module.createNestApplication()
  app.useWebSocketAdapter(new RealtimeIoAdapter(app))
  await app.listen(0)
  apps.push(app)
  return {
    port: (app.getHttpServer().address() as AddressInfo).port,
    service: app.get(RealtimeService),
  }
}

/** The events a client connected to the instance on `port` receives under `notice`. */
async function listener(port: number): Promise<unknown[]> {
  const received: unknown[] = []
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    auth: { token: 'ok' },
    transports: ['websocket'],
    reconnection: false,
  })
  sockets.push(socket)
  socket.on('notice', (data: unknown) => received.push(data))
  await new Promise<void>((resolve) => socket.once('connection:established', () => resolve()))
  return received
}

/** Emits until the other instance's client hears one: delivery has to start, not be instant. */
async function delivers(from: RealtimeService, received: unknown[]): Promise<void> {
  const before = received.length
  const deadline = Date.now() + 5000
  while (received.length === before) {
    if (Date.now() > deadline) throw new Error('no cross-instance delivery within 5000 ms')
    await from.emitToUser('u1', 'notice', {})
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  for (const app of apps.splice(0)) await app.close()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const proxy of proxies.splice(0)) proxy.close()
})

describe('Redis adapter subscriber with a host client’s options', () => {
  // Scenario: Redis is healthy from boot and the host client carries an option under which the
  // adapter's first SUBSCRIBE fails. Expected: an emit on A still reaches a client of B.
  it.each([
    ['ioredis defaults', {}],
    ['enableOfflineQueue false', { enableOfflineQueue: false }],
    ['lazyConnect with enableOfflineQueue false', { lazyConnect: true, enableOfflineQueue: false }],
  ])('delivers across instances (%s)', async (_label, options: RedisOptions) => {
    const pubA = client(REDIS_URL, options)
    const pubB = client(REDIS_URL, options)
    for (const pub of [pubA, pubB]) {
      if (pub.status === 'wait') await pub.connect()
      await waitFor('the host client', () => pub.status === 'ready')
    }
    const a = await instance(pubA)
    const b = await instance(pubB)

    await delivers(a.service, await listener(b.port))
  })

  // Scenario: B boots while its Redis is unreachable, for longer than its client waits for any
  // command. Expected: once Redis is reachable, an emit on A reaches a client of B.
  it.each([
    ['maxRetriesPerRequest 1', { maxRetriesPerRequest: 1 }],
    ['commandTimeout 100', { commandTimeout: 100 }],
  ])('delivers once Redis comes up after boot (%s)', async (_label, options: RedisOptions) => {
    const proxy = await redisProxy()
    const a = await instance(client(REDIS_URL))
    const b = await instance(client(proxy.url, options))
    const received = await listener(b.port)
    await new Promise((r) => setTimeout(r, 600))
    await proxy.up()

    await delivers(a.service, received)
  })

  // Scenario: B's connection to Redis drops and comes back, with a host client that does not
  // resubscribe on its own. Expected: an emit on A reaches a client of B again.
  it('delivers again after a reconnect (autoResubscribe false)', async () => {
    const proxy = await redisProxy()
    await proxy.up()
    const a = await instance(client(REDIS_URL))
    const pubB = client(proxy.url, { autoResubscribe: false })
    const b = await instance(pubB)
    const received = await listener(b.port)
    await delivers(a.service, received)

    proxy.down()
    await waitFor('the drop', () => pubB.status !== 'ready')
    await proxy.up()

    await delivers(a.service, received)
  })

  // Scenario: an instance whose Redis was never reachable is shut down, its SUBSCRIBE still queued.
  // Expected: the close completes within the bound of the subscriber's QUIT.
  it('closes while the SUBSCRIBE is still queued', async () => {
    const proxy = await redisProxy()
    await instance(client(proxy.url))
    const started = Date.now()

    await apps.pop()?.close()

    expect(Date.now() - started).toBeLessThan(4000)
  })
})
