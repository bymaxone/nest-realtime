/**
 * @fileoverview RedisRealtimePubSub's publishing connection against a real ioredis client: a host
 * client that connects lazily is connected by the adapter, readiness follows its ability to
 * publish, and a publish is never queued behind a connection that is not ready.
 * @layer test
 */
import type { Socket } from 'node:net'
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

jest.setTimeout(8_000)

const message: RealtimePubSubMessage = {
  op: 'disconnect',
  args: { connectionId: 'c1', reason: 'revoked' },
  origin: 'inst-1',
}

const clients: Redis[] = []
const servers: FakeRespServer[] = []

function client(port: number, extra: Record<string, unknown> = {}): Redis {
  const redis = new Redis({ host: '127.0.0.1', port, retryStrategy: () => 40, ...extra })
  redis.on('error', () => undefined)
  clients.push(redis)
  return redis
}

async function until(what: string, condition: () => boolean, ms = 1_500): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const published = (fake: FakeRespServer): number =>
  fake.seen.filter((command) => command[0] === 'PUBLISH').length

afterEach(async () => {
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
})

describe('RedisRealtimePubSub publishing connection', () => {
  // A host client built with lazyConnect stays in 'wait' until its first command, and one that also
  // refuses commands before it is connected (nest-cache's default) would refuse that first publish.
  // The adapter connects it when it subscribes, so readiness and the first emit are both honest.
  it('connects a lazy host client and reports ready only once it can publish', async () => {
    const fake = new FakeRespServer()
    await fake.start()
    servers.push(fake)
    const redis = client(fake.port, { lazyConnect: true, enableOfflineQueue: false })
    expect(redis.status).toBe('wait')
    const pubsub = new RedisRealtimePubSub({ client: redis })

    await pubsub.subscribe(() => undefined)
    await until('the publisher to be connected', () => redis.status === 'ready')
    await until('the instance to report ready', () => pubsub.isSubscribed())

    await expect(pubsub.publish(message)).resolves.toBeUndefined()
    expect(published(fake)).toBe(1)
  })

  // The host client is created just before the application boots, so for its first milliseconds it
  // is still connecting; the publisher here is the first connection the scripted server sees and it
  // answers that one late. An emit from another provider's start-up hook right after the module
  // initialises must not be refused for it, so subscribing waits for the publisher as well.
  it('waits for the publisher while subscribing, so a start-up emit is not refused', async () => {
    let slowed = false
    let first: Socket | undefined
    const fake = new FakeRespServer((command, socket) => {
      first ??= socket
      const reply = healthyRedis(command, socket)
      if (socket !== first || reply === null) return reply
      slowed = true
      setTimeout(() => socket.write(reply), 200)
      return null
    })
    await fake.start()
    servers.push(fake)
    const redis = client(fake.port)
    const pubsub = new RedisRealtimePubSub({ client: redis })

    await pubsub.subscribe(() => undefined)

    expect(redis.status).toBe('ready')
    await expect(pubsub.publish(message)).resolves.toBeUndefined()
    expect(published(fake)).toBe(1)
    // The publisher's answers were in fact held back, so the wait above is what made it ready.
    expect(slowed).toBe(true)
  })

  // A lazy host client that nobody subscribes through is connected by its first publish, which is
  // refused: the command it would have been is not sent, and the next publish goes through.
  it('connects a lazy host client on a publish made before any subscribe', async () => {
    const fake = new FakeRespServer()
    await fake.start()
    servers.push(fake)
    const redis = client(fake.port, { lazyConnect: true, enableOfflineQueue: false })
    const pubsub = new RedisRealtimePubSub({ client: redis })

    await expect(pubsub.publish(message)).rejects.toThrow(
      '[RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: cannot publish to "bymax:realtime" (the Redis client is wait)',
    )
    await until('the client to be ready', () => redis.status === 'ready')
    await expect(pubsub.publish(message)).resolves.toBeUndefined()
    expect(published(fake)).toBe(1)
  })

  // A server that accepts the connection and never answers the handshake leaves the client
  // connecting. ioredis would queue the publish behind it and send it, late, when a later
  // connection completes; it is refused at once and never reaches the client.
  it('refuses a publish while the connection has not completed and never sends it late', async () => {
    const fake = new FakeRespServer(() => null)
    await fake.start()
    servers.push(fake)
    const redis = client(fake.port)
    const pubsub = new RedisRealtimePubSub({ client: redis })
    await until('the client to connect its socket', () => redis.status === 'connect')

    const started = Date.now()
    await expect(pubsub.publish(message)).rejects.toThrow(
      '[RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: cannot publish to "bymax:realtime" (the Redis client is connect)',
    )
    expect(Date.now() - started).toBeLessThan(200)

    fake.respond(healthyRedis)
    fake.drop()
    await until('the client to be ready', () => redis.status === 'ready', 3_000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(published(fake)).toBe(0)
  })
})
