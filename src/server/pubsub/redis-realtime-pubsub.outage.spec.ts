/**
 * @fileoverview RedisRealtimePubSub.publish against a real ioredis client whose server goes away:
 * the publish is refused at once and is never sent when the connection returns.
 * @layer test
 */
import Redis from 'ioredis'
import { createTestInstances } from '../../../test/e2e/helpers/create-test-instance'
import { FakeRespServer } from '../../../test/fixtures/fake-resp-server'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

jest.setTimeout(5_000)

const message: RealtimePubSubMessage = {
  op: 'disconnect',
  args: { connectionId: 'c1', reason: 'revoked' },
  origin: 'inst-1',
}

const clients: Redis[] = []
const servers: FakeRespServer[] = []

async function until(what: string, condition: () => boolean, ms = 1_500): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
})

describe('RedisRealtimePubSub.publish during an outage', () => {
  // The client is left on ioredis's defaults: its offline queue is on and a command waits for the
  // reconnect, so the adapter must refuse at once or a revocation is held for the whole outage.
  it('rejects at once and never sends the publish when the connection returns', async () => {
    const fake = new FakeRespServer()
    await fake.start()
    servers.push(fake)
    const redis = new Redis({ host: '127.0.0.1', port: fake.port, retryStrategy: () => 40 })
    redis.on('error', () => undefined)
    clients.push(redis)
    const pubsub = new RedisRealtimePubSub({ client: redis })
    await until('the client to be ready', () => redis.status === 'ready')
    await pubsub.publish(message)
    expect(fake.seen.filter((command) => command[0] === 'PUBLISH')).toHaveLength(1)

    await fake.stop()
    await until('the client to start reconnecting', () => redis.status === 'reconnecting')
    const started = Date.now()
    await expect(pubsub.publish(message)).rejects.toThrow(
      '[RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: cannot publish to "bymax:realtime" (the Redis client is reconnecting)',
    )
    expect(Date.now() - started).toBeLessThan(200)

    await fake.start()
    servers.push(fake)
    await until('the client to be ready again', () => redis.status === 'ready')
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Only the publish made while the server was up was ever sent.
    expect(fake.seen.filter((command) => command[0] === 'PUBLISH')).toHaveLength(1)
    await expect(pubsub.publish(message)).resolves.toBeUndefined()
  })
  // The transport on top: a revocation that cannot be published answers with the pub/sub code at
  // once, so the caller can retry, and an emit does not stall on the outage either.
  it('makes disconnect() reject at once and emitToUser resolve at once while the client reconnects', async () => {
    const fake = new FakeRespServer()
    await fake.start()
    servers.push(fake)
    const redis = new Redis({ host: '127.0.0.1', port: fake.port, retryStrategy: () => 40 })
    redis.on('error', () => undefined)
    clients.push(redis)
    const {
      instances: [instance],
    } = createTestInstances(1, () => new RedisRealtimePubSub({ client: redis }))

    await fake.stop()
    await until('the client to start reconnecting', () => redis.status === 'reconnecting')
    const started = Date.now()
    await expect(instance!.transport.disconnect('c-remote', 'revoked')).rejects.toMatchObject({
      code: 'REALTIME_PUBSUB_UNAVAILABLE',
    })
    await expect(instance!.transport.disconnect('c-remote', 'revoked')).rejects.toThrow(
      '[SseTransport] REALTIME_PUBSUB_UNAVAILABLE: the revocation of c-remote could not be published ([RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: cannot publish to "bymax:realtime" (the Redis client is reconnecting))',
    )
    await expect(instance!.transport.emitToUser('u1', 'evt', {})).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(400)
  })
})
