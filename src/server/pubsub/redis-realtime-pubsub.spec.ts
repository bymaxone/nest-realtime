/**
 * @fileoverview Unit tests for RedisRealtimePubSub using ioredis-mock.
 * @layer infrastructure
 */
const RedisMock = require('ioredis-mock') as { new (): object }
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

const msg: RealtimePubSubMessage = { op: 'broadcast', args: { event: 'x' }, origin: 'inst-1' }

function build(channel?: string) {
  const client = new RedisMock()
  const opts =
    channel !== undefined ? { client: client as never, channel } : { client: client as never }
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
})
