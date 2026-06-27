/**
 * @fileoverview Unit tests for the default in-process pub/sub.
 * @layer infrastructure
 */
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { InMemoryPubSub } from './in-memory-pubsub'

const message: RealtimePubSubMessage = { op: 'broadcast', args: { event: 'x' }, origin: 'inst-1' }

describe('InMemoryPubSub', () => {
  let pubsub: InMemoryPubSub

  beforeEach(() => {
    pubsub = new InMemoryPubSub()
  })

  // publish invokes every registered handler in-process.
  it('invokes all subscribed handlers on publish', async () => {
    const a = jest.fn()
    const b = jest.fn()
    await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await pubsub.publish(message)
    expect(a).toHaveBeenCalledWith(message)
    expect(b).toHaveBeenCalledWith(message)
  })

  // The unsubscribe handle removes the handler so later publishes skip it.
  it('stops invoking a handler after unsubscribe', async () => {
    const handler = jest.fn()
    const unsubscribe = await pubsub.subscribe(handler)
    await unsubscribe()
    await pubsub.publish(message)
    expect(handler).not.toHaveBeenCalled()
  })
})
