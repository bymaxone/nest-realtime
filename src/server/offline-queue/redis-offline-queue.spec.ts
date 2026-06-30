/**
 * @fileoverview Unit tests for RedisOfflineQueue using ioredis-mock.
 * @layer infrastructure
 */
const RedisMock = require('ioredis-mock') as { new (): object }
import type { OfflineQueuedEvent } from '../interfaces/offline-queue-storage.interface'
import { RedisOfflineQueue } from './redis-offline-queue'

function mkEvent(id: string, event = 'foo'): OfflineQueuedEvent {
  return { id, event, data: { id }, emittedAt: new Date() }
}

function build(opts?: { maxPerUser?: number; ttlSeconds?: number }) {
  const client = new RedisMock()
  const queue = new RedisOfflineQueue({ client: client as never, ...opts })
  return { queue, client }
}

describe('RedisOfflineQueue', () => {
  // append stores an event and it can be retrieved.
  it('appends an event and retrieves it', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('100-0'))
    const events = await queue.retrieveSince('u1', '99-0', 10)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe('100-0')
  })

  // retrieveSince uses exclusive lower bound — the sinceId event is not returned.
  it('excludes the sinceId event from results', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('100-0'))
    await queue.append('u1', mkEvent('101-0'))
    const events = await queue.retrieveSince('u1', '100-0', 10)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe('101-0')
  })

  // acknowledge removes events up to and including the given id.
  it('acknowledge removes delivered events up to upToId', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('100-0'))
    await queue.append('u1', mkEvent('101-0'))
    await queue.append('u1', mkEvent('102-0'))
    await queue.acknowledge('u1', '101-0')
    const remaining = await queue.retrieveSince('u1', '0-0', 10)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe('102-0')
  })

  // Trimming keeps only the most recent maxPerUser events.
  it('trims oldest entries beyond maxPerUser', async () => {
    const { queue } = build({ maxPerUser: 3 })
    for (let i = 1; i <= 5; i++) {
      await queue.append('u1', mkEvent(`${100 + i}-0`))
    }
    const all = await queue.retrieveSince('u1', '0-0', 100)
    expect(all).toHaveLength(3)
    expect(all[0]!.id).toBe('103-0')
    expect(all[2]!.id).toBe('105-0')
  })

  // Scores from different users do not collide.
  it('isolates events per user', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('100-0', 'a'))
    await queue.append('u2', mkEvent('100-0', 'b'))
    const u1 = await queue.retrieveSince('u1', '0-0', 10)
    const u2 = await queue.retrieveSince('u2', '0-0', 10)
    expect(u1[0]!.event).toBe('a')
    expect(u2[0]!.event).toBe('b')
  })

  // The limit parameter caps the number of returned events.
  it('respects the limit parameter in retrieveSince', async () => {
    const { queue } = build()
    for (let i = 1; i <= 10; i++) {
      await queue.append('u1', mkEvent(`${i}-0`))
    }
    const events = await queue.retrieveSince('u1', '0-0', 5)
    expect(events).toHaveLength(5)
  })

  // Handles plain numeric ids without a dash (legacy format).
  it('handles plain numeric ids (legacy format)', async () => {
    const { queue } = build()
    await queue.append('u1', { id: '1700000000000', event: 'x', data: {}, emittedAt: new Date() })
    const events = await queue.retrieveSince('u1', '1699999999999', 10)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe('1700000000000')
  })

  // retrieveSince on an empty queue returns an empty array.
  it('returns empty array when the queue is empty', async () => {
    const { queue } = build()
    const events = await queue.retrieveSince('u1', '0-0', 10)
    expect(events).toHaveLength(0)
  })
})
