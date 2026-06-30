/**
 * @fileoverview Unit tests for RedisOfflineQueue using ioredis-mock.
 * @layer infrastructure
 */
import RedisMock from 'ioredis-mock'
import type { Redis } from 'ioredis'
import type { OfflineQueuedEvent } from '../interfaces/offline-queue-storage.interface'
import { RedisOfflineQueue } from './redis-offline-queue'

/** Minimal pipeline fake — implement only the methods append uses. */
function makeFakePipeline(execResult: [Error | null, unknown][] | null) {
  return {
    zadd: jest.fn(),
    zremrangebyrank: jest.fn(),
    expire: jest.fn(),
    exec: jest.fn().mockResolvedValue(execResult),
  }
}

/** Wrap a fake pipeline factory into a minimal fake Redis client. Cast once at boundary. */
function fakeClientWithPipeline(execResult: [Error | null, unknown][] | null): Redis {
  const pipeline = makeFakePipeline(execResult)
  return {
    pipeline: jest.fn().mockReturnValue(pipeline),
  } as unknown as Redis
}

function mkEvent(id: string, event = 'foo'): OfflineQueuedEvent {
  return { id, event, data: { id }, emittedAt: new Date() }
}

// Shared client reset between tests — ioredis-mock uses a global in-process store.
const sharedClient = new RedisMock() as unknown as Redis

beforeEach(async () => {
  await sharedClient.flushall()
})

function build(opts?: { maxPerUser?: number; ttlSeconds?: number }) {
  const queue = new RedisOfflineQueue({ client: sharedClient, ...opts })
  return { queue, client: sharedClient }
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

  // emittedAt is restored as a Date after the JSON round-trip through Redis.
  it('returns emittedAt as a Date after JSON serialization round-trip', async () => {
    // Covers: the JSON.parse reviver correctly restores emittedAt from string to Date.
    const { queue } = build()
    const original = new Date('2024-01-01T00:00:00.000Z')
    await queue.append('u1', { id: '100-0', event: 'x', data: {}, emittedAt: original })
    const events = await queue.retrieveSince('u1', '99-0', 10)
    expect(events[0]!.emittedAt).toBeInstanceOf(Date)
    expect(events[0]!.emittedAt.getTime()).toBe(original.getTime())
  })

  // append resolves when pipeline.exec() returns null (covers the ?? [] null branch).
  it('resolves when pipeline.exec() returns null', async () => {
    // Covers: the `?? []` null-coalescing branch when exec() resolves to null.
    const queue = new RedisOfflineQueue({ client: fakeClientWithPipeline(null) })
    await expect(queue.append('u1', mkEvent('1-0'))).resolves.toBeUndefined()
  })

  // append throws when pipeline.exec() embeds a per-command error (covers if (error) throw).
  it('throws when pipeline.exec() returns a per-command error', async () => {
    // Covers: `if (error) throw error` when ioredis embeds an error in the results tuple.
    const boom = new Error('boom')
    const queue = new RedisOfflineQueue({
      client: fakeClientWithPipeline([
        [boom, null],
        [null, 1],
        [null, 1],
      ]),
    })
    await expect(queue.append('u1', mkEvent('1-0'))).rejects.toThrow('boom')
  })
})
