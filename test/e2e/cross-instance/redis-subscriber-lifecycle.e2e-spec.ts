/**
 * @fileoverview The Redis subscriber's boot behaviour and cross-instance revocation against a real
 * Redis, with one bus and one ioredis client per instance as in a deployment. Needs `REDIS_URL`.
 * @layer e2e
 */
import { connect, createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import Redis from 'ioredis'
import { RedisRealtimePubSub } from '../../../src/server/pubsub/redis-realtime-pubsub'
import { createTestInstances } from '../helpers/create-test-instance'

const REDIS_URL = process.env['REDIS_URL']
if (!REDIS_URL) throw new Error('REDIS_URL is required for the Redis subscriber lifecycle suite')

const clients: Redis[] = []

function client(url: string, extra: Record<string, unknown> = {}): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: null, retryStrategy: () => 100, ...extra })
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

afterAll(() => {
  for (const redis of clients) redis.disconnect()
})

describe('RedisRealtimePubSub against a real Redis', () => {
  // The revocation crosses a real bus: A has never held the connection, so the only way B's
  // connection closes is the message through Redis.
  // The second row is how nest-cache builds its clients: the subscriber connection must not
  // inherit the host's refusal to take commands before it is connected.
  it.each([
    ['ioredis defaults', {}],
    ['enableOfflineQueue false', { enableOfflineQueue: false }],
  ])(
    'delivers a revocation from instance A to the connection held by instance B (%s)',
    async (_label, options) => {
      const channel = `bymax:realtime:e2e:${Date.now()}`
      const { instances } = createTestInstances(
        2,
        () => new RedisRealtimePubSub({ client: client(REDIS_URL, options), channel }),
      )
      const [a, b] = instances as [(typeof instances)[0], (typeof instances)[0]]
      await a.subscriber.onModuleInit()
      await b.subscriber.onModuleInit()
      // A client that refuses commands before it is connected must be connected before it publishes.
      await waitFor('every client to be ready', () => clients.every((c) => c.status === 'ready'))
      const received = b.addConnection('c-remote', 'u1')
      expect(received).toHaveLength(0)

      await a.transport.disconnect('c-remote', 'revoked')

      await waitFor(
        'the connection on B to close',
        () => b.transport.getConnection('c-remote') === undefined,
      )
      await a.shutdown()
      await b.shutdown()
    },
  )

  // An instance whose Redis is not reachable at boot starts unready, and when the connection comes
  // up it must subscribe, report ready and hear the other instances. The real Redis is reached
  // through a proxy whose port is closed at boot and opened later, with a host client that refuses
  // commands before it is connected (nest-cache's default).
  it('recovers and delivers a cross-instance emit once Redis becomes reachable', async () => {
    const target = new URL(REDIS_URL)
    const open: Socket[] = []
    const proxy: Server = createServer((socket) => {
      const upstream = connect(Number(target.port || 6379), target.hostname)
      open.push(socket, upstream)
      socket.on('error', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    // A free port that nothing listens on yet.
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const proxyPort = (proxy.address() as { port: number }).port
    await new Promise<void>((resolve) => proxy.close(() => resolve()))

    const channel = `bymax:realtime:e2e:late:${Date.now()}`
    const busA = new RedisRealtimePubSub({ client: client(REDIS_URL), channel })
    const busB = new RedisRealtimePubSub({
      client: client(`redis://127.0.0.1:${proxyPort}`, { enableOfflineQueue: false }),
      channel,
    })
    const a = createTestInstances(1, () => busA).instances[0]!
    const b = createTestInstances(1, () => busB).instances[0]!
    try {
      await a.subscriber.onModuleInit()
      await b.subscriber.onModuleInit()
      expect(busB.isSubscribed()).toBe(false)
      const received = b.addConnection('c-late', 'u-late')

      await new Promise<void>((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve))
      await waitFor('instance B to report subscribed', () => busB.isSubscribed())
      await a.transport.emitToUser('u-late', 'late-evt', { ok: true })

      await waitFor('the emit from A to reach B', () => received.length > 0)
      expect(received[0]?.type).toBe('late-evt')
    } finally {
      await a.shutdown()
      await b.shutdown()
      for (const socket of open) socket.destroy()
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })

  // A server that is reached and refuses is a refusal, not an outage: the boot fails.
  it('fails the boot when the server refuses the credentials', async () => {
    const pubsub = new RedisRealtimePubSub({
      client: client(REDIS_URL, { password: 'not-the-password', username: 'nobody' }),
    })
    const failure = await pubsub.subscribe(() => undefined).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(
      /^\[RedisRealtimePubSub\] REALTIME_PUBSUB_UNAVAILABLE: could not subscribe to "bymax:realtime" \(/,
    )
    expect(pubsub.isSubscribed()).toBe(false)
  })

  // A port nothing listens on is an outage: the boot completes, unready, and does not hang.
  it('completes the boot, unready, when Redis is unreachable', async () => {
    const pubsub = new RedisRealtimePubSub({ client: client('redis://127.0.0.1:1') })
    const started = Date.now()
    const unsubscribe = await pubsub.subscribe(() => undefined)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(pubsub.isSubscribed()).toBe(false)
    await unsubscribe()
  })
})
