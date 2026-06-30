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

  // A handler that throws does not block delivery to the remaining handlers.
  it('isolates a throwing handler from subsequent handlers', async () => {
    const throwing = jest.fn().mockImplementation(() => {
      throw new Error('boom')
    })
    const safe = jest.fn()
    await pubsub.subscribe(throwing)
    await pubsub.subscribe(safe)
    await pubsub.publish(message)
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(safe).toHaveBeenCalledWith(message)
  })

  // The handlers store is a Set — subscribing the same function reference twice is
  // de-duplicated, so the handler is invoked exactly once per publish.
  it('de-duplicates the same handler reference subscribed twice', async () => {
    const handler = jest.fn()
    await pubsub.subscribe(handler)
    await pubsub.subscribe(handler)
    await pubsub.publish(message)
    // Set.add with the same reference is a no-op, so the handler fires only once.
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // Unsubscribing a handler that has already been removed is a no-op.
  it('double-unsubscribe is a no-op', async () => {
    const handler = jest.fn()
    const unsub = await pubsub.subscribe(handler)
    await unsub()
    await expect(unsub()).resolves.toBeUndefined()
    await pubsub.publish(message)
    expect(handler).not.toHaveBeenCalled()
  })

  // publish with no subscribers resolves without error.
  it('resolves successfully when there are no subscribers', async () => {
    await expect(pubsub.publish(message)).resolves.toBeUndefined()
  })

  // Delivery is deferred one microtask so synchronous code after publish still runs first.
  it('defers delivery by one microtask', async () => {
    const order: string[] = []
    await pubsub.subscribe(() => order.push('handler'))
    const p = pubsub.publish(message)
    order.push('after-publish')
    await p
    expect(order).toEqual(['after-publish', 'handler'])
  })

  // A high-throughput burst does not lose any deliveries.
  it('delivers all messages under a stress burst', async () => {
    const count = 50
    const received: number[] = []
    await pubsub.subscribe((m) => received.push((m.args as { n: number }).n))
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        pubsub.publish({ op: 'broadcast', args: { n: i }, origin: 'x' }),
      ),
    )
    expect(received).toHaveLength(count)
  })
})
