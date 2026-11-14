/**
 * @fileoverview Closing an application whose Socket.IO Redis adapter has a subscriber connection of
 * its own, against a real ioredis client and a scripted server: the connection is closed with the
 * application, and a Redis that stopped answering does not hold the close.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../test/fixtures/fake-resp-server'
import { RedisRealtimePubSub } from '../server/pubsub/redis-realtime-pubsub'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(8_000)

/** How long closing waits for a subscriber's QUIT before it disconnects the connection. */
const QUIT_WAIT_MS = 2_000

const clients: Redis[] = []
const servers: FakeRespServer[] = []

afterEach(async () => {
  // A case abandoned at its time limit never reaches its own `finally`, and fake timers left
  // installed would hang the cases after it.
  jest.useRealTimers()
  jest.restoreAllMocks()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
})

/** One subscriber-connection reply per channel, each carrying the count of subscriptions left. */
function subscriptionReplies(kind: string, channels: readonly string[], counts: number[]): string {
  return channels
    .map(
      (channel, index) =>
        `*3\r\n$${kind.length}\r\n${kind}\r\n$${channel.length}\r\n${channel}\r\n:${counts[index]}\r\n`,
    )
    .join('')
}

/**
 * What a Redis answers to the commands the Socket.IO Redis adapter sends beyond the fixture's
 * defaults: a reply per channel for a subscription, and a server version for `INFO`.
 */
function adapterReply(command: readonly string[]): string | null {
  const [name, ...channels] = command
  const up = channels.map((_channel, index) => index + 1)
  const down = channels.map((_channel, index) => channels.length - index - 1)
  if (name === 'SUBSCRIBE') return subscriptionReplies('subscribe', channels, up)
  if (name === 'PSUBSCRIBE') return subscriptionReplies('psubscribe', channels, up)
  if (name === 'UNSUBSCRIBE') return subscriptionReplies('unsubscribe', channels, down)
  if (name === 'PUNSUBSCRIBE') return subscriptionReplies('punsubscribe', channels, down)
  if (name === 'INFO') {
    const info = 'redis_version:7.0.0\r\n'
    return `$${info.length}\r\n${info}\r\n`
  }
  return null
}

/** A scripted server that answers like Redis, closes a connection that quits, and can go silent. */
async function scriptedServer(): Promise<{ fake: FakeRespServer; silence: () => void }> {
  const fake = new FakeRespServer((command, socket) => {
    if (command[0] === 'QUIT') {
      socket.end('+OK\r\n')
      return null
    }
    return adapterReply(command) ?? healthyRedis(command, socket)
  })
  await fake.start()
  servers.push(fake)
  return { fake, silence: () => fake.respond(() => null) }
}

/** Lets the event loop turn until `condition` holds; fails here, named, and not at the time limit. */
async function turnsUntil(what: string, condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 5_000 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  if (!condition()) throw new Error(`the event loop turned 5000 times without ${what}`)
}

/**
 * Boots an application whose Redis adapter publishes through a client of `fake`. With transport
 * `both` the same client also backs the SSE pub/sub, which opens a subscriber of its own.
 */
async function bootOn(
  fake: FakeRespServer,
  transport: 'websocket' | 'both' = 'websocket',
): Promise<INestApplication> {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  const pubClient = new Redis({ host: '127.0.0.1', port: fake.port, retryStrategy: () => 40 })
  pubClient.on('error', () => undefined)
  clients.push(pubClient)
  const module = await Test.createTestingModule({
    imports: [
      BymaxRealtimeWebSocketModule.forRoot({
        transport,
        authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        websocket: { redisAdapter: { pubClient } },
        ...(transport === 'both' ? { pubsub: new RedisRealtimePubSub({ client: pubClient }) } : {}),
      }),
    ],
  }).compile()
  const app = module.createNestApplication()
  app.useWebSocketAdapter(new RealtimeIoAdapter(app))
  await app.listen(0)
  const connections = transport === 'both' ? 3 : 2
  await turnsUntil(
    'the subscribers to connect and subscribe',
    () =>
      fake.sockets.size === connections && fake.seen.some((command) => command[0] === 'PSUBSCRIBE'),
  )
  return app
}

describe('closing an application with the Socket.IO Redis adapter', () => {
  // The adapter owns the subscriber connection it opens beside the caller's client, so it closes
  // that one with the application; the caller's client is the caller's and stays open.
  it('closes the adapter subscriber connection with the application, and leaves the caller client open', async () => {
    const { fake } = await scriptedServer()
    const app = await bootOn(fake)

    await app.close()

    await turnsUntil('the subscriber connection to close', () => fake.sockets.size === 1)
    expect(clients[0]?.status).toBe('ready')
  })

  // A QUIT on a connection that stopped answering never settles, so the close waits on it unless
  // something bounds it. The clock belongs to the test: the QUIT reaches the server, the close is
  // pending one millisecond before the bound, and it has settled at the bound.
  it('closes at the bound, not before and not after, when the subscriber QUIT is never answered', async () => {
    const { fake, silence } = await scriptedServer()
    const app = await bootOn(fake)
    silence()
    jest.useFakeTimers({
      doNotFake: [
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'Date',
        'performance',
      ],
    })
    try {
      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })
      await turnsUntil('the QUIT reaching the server', () =>
        fake.seen.some((command) => command[0] === 'QUIT'),
      )

      await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1)
      expect(closed).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      await turnsUntil('the close settling at the bound', () => closed)
      await closing
    } finally {
      jest.useRealTimers()
    }
    await turnsUntil('the subscriber connection to be dropped', () => fake.sockets.size === 1)
  })

  // With both transports there are two subscribers on two phases of Nest's shutdown: the adapter's
  // in `dispose()`, then the SSE pub/sub's in its shutdown hook. Each phase waits at most one
  // bound, so a Redis that answers neither costs two, and not more. The clock belongs to the test.
  it('closes within two bounds, one per shutdown phase, when both transports meet a silent Redis', async () => {
    const { fake, silence } = await scriptedServer()
    const app = await bootOn(fake, 'both')
    silence()
    jest.useFakeTimers({
      doNotFake: [
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'Date',
        'performance',
      ],
    })
    const quits = (): number => fake.seen.filter((command) => command[0] === 'QUIT').length
    try {
      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })
      await turnsUntil('the adapter subscriber QUIT', () => quits() === 1)

      await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS)
      expect(closed).toBe(false)
      await turnsUntil('the pub/sub subscriber QUIT', () => quits() === 2)
      await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1)
      expect(closed).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      await turnsUntil('the close settling at the second bound', () => closed)
      await closing
    } finally {
      jest.useRealTimers()
    }
    await turnsUntil('both subscriber connections to be dropped', () => fake.sockets.size === 1)
  })

  // The adapter's subscriber is closed in `dispose()`, on the assumption that Nest calls it once
  // every server has closed: closing a subscriber while a server still uses it would cut live
  // subscriptions. That order is Nest's, so it is pinned against Nest, with the adapter's own
  // methods recording when each one starts and ends.
  it('disposes the adapter only after every server has closed, in the order Nest calls them', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        }),
      ],
    }).compile()
    const app = module.createNestApplication()
    const adapter = new RealtimeIoAdapter(app)
    const order: string[] = []
    const close = adapter.close.bind(adapter)
    adapter.close = async (server): Promise<void> => {
      order.push('close started')
      await close(server)
      order.push('close ended')
    }
    const dispose = adapter.dispose.bind(adapter)
    adapter.dispose = async (): Promise<void> => {
      order.push('dispose started')
      await dispose()
    }
    app.useWebSocketAdapter(adapter)
    await app.listen(0)

    await app.close()

    expect(order).toEqual(['close started', 'close ended', 'dispose started'])
  })
})
