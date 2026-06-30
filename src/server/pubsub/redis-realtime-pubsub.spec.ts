/**
 * @fileoverview Unit tests for RedisRealtimePubSub using ioredis-mock.
 * @layer infrastructure
 */
import RedisMock from 'ioredis-mock'
import type { Redis } from 'ioredis'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

const msg: RealtimePubSubMessage = { op: 'broadcast', args: { event: 'x' }, origin: 'inst-1' }

function build(channel?: string) {
  const client = new RedisMock() as unknown as Redis
  const opts = channel !== undefined ? { client, channel } : { client }
  const pubsub = new RedisRealtimePubSub(opts)
  return { pubsub, client }
}

describe('RedisRealtimePubSub', () => {
  // publish serialises the message to the configured Redis channel.
  it('publishes a JSON-encoded message to the channel', async () => {
    const { pubsub, client } = build('test:ch')
    const received: string[] = []
    const sub = client.duplicate()
    await sub.subscribe('test:ch')
    sub.on('message', (_ch: string, payload: string) => received.push(payload))
    await pubsub.publish(msg)
    // Give the event loop a tick to propagate.
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]!)).toMatchObject({ op: 'broadcast', origin: 'inst-1' })
    await sub.quit()
  })

  // subscribe delivers published messages to the handler.
  it('subscribe handler receives published messages', async () => {
    const { pubsub } = build()
    const received: RealtimePubSubMessage[] = []
    await pubsub.subscribe((m) => received.push(m))
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ op: 'broadcast' })
  })

  // Multiple handlers on the same instance all receive the message.
  it('delivers to multiple handlers on the same instance', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // Unsubscribing the last handler quits the sub client.
  it('quits the sub client when the last handler unsubscribes', async () => {
    const { pubsub } = build()
    const handler = jest.fn()
    const unsub = await pubsub.subscribe(handler)
    await unsub()
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()
  })

  // A second subscriber re-uses the existing sub client (no duplicate connection).
  it('reuses the sub client for additional subscribers', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // Malformed JSON from Redis is silently dropped.
  it('drops malformed JSON payloads silently', async () => {
    const { pubsub, client } = build()
    const handler = jest.fn()
    await pubsub.subscribe(handler)
    // Directly publish raw malformed bytes to the channel.
    await client.publish('bymax:realtime', '{not json')
    await new Promise((r) => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()
  })

  // A throwing handler does not block other handlers.
  it('isolates a throwing handler from remaining handlers', async () => {
    const { pubsub } = build()
    const throwing = jest.fn().mockImplementation(() => {
      throw new Error('boom')
    })
    const safe = jest.fn()
    await pubsub.subscribe(throwing)
    await pubsub.subscribe(safe)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(safe).toHaveBeenCalledTimes(1)
  })

  // The default channel name is bymax:realtime.
  it('defaults to the bymax:realtime channel', async () => {
    const { pubsub } = build(undefined)
    const received: RealtimePubSubMessage[] = []
    await pubsub.subscribe((m) => received.push(m))
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
  })

  // When subscriber init fails, the handler is rolled back and subInit is cleared so the
  // next subscribe() retries with a fresh client instead of re-awaiting the rejected promise.
  it('rolls back handler and clears subInit when subscriber init fails', async () => {
    let duplicateCall = 0
    const failingSub = {
      subscribe: jest.fn().mockRejectedValue(new Error('redis down')),
      on: jest.fn(),
    }
    const recoverySub = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    }
    const fakePub = {
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest
        .fn()
        .mockImplementation(() => (duplicateCall++ === 0 ? failingSub : recoverySub)),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const handler = jest.fn()

    // First subscribe fails — must reject and not leave the handler registered.
    await expect(pubsub.subscribe(handler)).rejects.toThrow('redis down')

    // Second subscribe must retry (duplicate called a second time) and succeed.
    const unsub = await pubsub.subscribe(handler)
    expect(fakePub.duplicate).toHaveBeenCalledTimes(2)
    await unsub()
  })

  // Concurrent subscribe() calls are idempotent — the sub client is created exactly once.
  it('concurrent subscribe() calls create the sub client only once', async () => {
    // Covers: ensureSubscriber() returns the same in-flight promise for concurrent calls.
    const { pubsub, client } = build()
    const duplicateSpy = jest.spyOn(client, 'duplicate')
    await Promise.all([pubsub.subscribe(jest.fn()), pubsub.subscribe(jest.fn())])
    expect(duplicateSpy).toHaveBeenCalledTimes(1)
  })

  // When quit() rejects on the last unsubscribe, the unsubscribe still resolves and the
  // next subscribe creates a fresh client.
  it('swallows a quit failure and lets the next subscribe create a new client', async () => {
    // Covers: subInit is cleared before quit so a failing quit does not strand the reference.
    const makeSub = (quitImpl: () => Promise<void>) => ({
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      quit: jest.fn().mockImplementation(quitImpl),
    })

    let callCount = 0
    const fakePub = {
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest
        .fn()
        .mockImplementation(() =>
          callCount++ === 0
            ? makeSub(() => Promise.reject(new Error('quit failure')))
            : makeSub(() => Promise.resolve()),
        ),
    }

    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub = await pubsub.subscribe(jest.fn())

    // The last unsubscribe triggers quit — must resolve even if quit rejects.
    await expect(unsub()).resolves.toBeUndefined()

    // Next subscribe must call duplicate again (new client, since subInit was cleared).
    await pubsub.subscribe(jest.fn())
    expect(fakePub.duplicate).toHaveBeenCalledTimes(2)
  })
  // The default channel must be the 'bymax:realtime' string, not an empty string.
  it('publishes to the bymax:realtime channel when no channel option is provided', async () => {
    const client = new RedisMock() as unknown as Redis
    const publishSpy = jest.spyOn(client as unknown as { publish: jest.Mock }, 'publish')
    const pubsub = new RedisRealtimePubSub({ client })
    await pubsub.publish(msg)
    expect(publishSpy).toHaveBeenCalledWith('bymax:realtime', expect.any(String))
    publishSpy.mockRestore()
  })

  // The second handler must still receive messages after the first handler unsubscribes.
  it('second handler receives messages after first handler is removed', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    const unsub1 = await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await unsub1()
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 10))
    expect(b).toHaveBeenCalledTimes(1)
  })

  // The sub client's quit() is called when the last handler unsubscribes.
  it('calls quit on the sub client when the last handler unsubscribes', async () => {
    // Kills BlockStatement mutation that removes the try { await sub.quit() } block.
    const quitMock = jest.fn().mockResolvedValue('OK')
    const fakeSub = {
      subscribe: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      quit: quitMock,
    }
    const fakePub = {
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(fakeSub),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub = await pubsub.subscribe(jest.fn())
    await unsub()
    expect(quitMock).toHaveBeenCalled()
  })

  // Kills L78 ConditionalExpression: `if (this.handlers.size === 0)` → `if (true)`.
  // With two handlers, removing only the first still leaves handlers.size=1, so quit must NOT fire.
  it('does not quit the sub client when a second handler is still registered', async () => {
    const quitMock = jest.fn().mockResolvedValue('OK')
    const fakeSub = {
      subscribe: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      quit: quitMock,
    }
    const fakePub = {
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(fakeSub),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub1 = await pubsub.subscribe(jest.fn())
    await pubsub.subscribe(jest.fn())
    await unsub1()
    expect(quitMock).not.toHaveBeenCalled()
  })
})
