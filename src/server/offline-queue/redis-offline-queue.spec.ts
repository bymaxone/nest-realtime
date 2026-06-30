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

  // Intra-millisecond events are stored and retrieved in counter order even when
  // many share the same epoch-millisecond (regression guard for the double-precision bug).
  it('preserves ordering for many events within the same millisecond', async () => {
    const { queue } = build()
    const COUNT = 300
    for (let i = 1; i <= COUNT; i++) {
      await queue.append('u1', mkEvent(`1000-${String(i).padStart(6, '0')}`))
    }
    const events = await queue.retrieveSince('u1', '1000-000000', COUNT)
    expect(events).toHaveLength(COUNT)
    for (let i = 0; i < COUNT; i++) {
      expect(events[i]!.id).toBe(`1000-${String(i + 1).padStart(6, '0')}`)
    }
  })

  // acknowledge on an empty (or fully-acknowledged) queue is a no-op.
  it('acknowledge on an empty queue resolves without error', async () => {
    const { queue } = build()
    await expect(queue.acknowledge('u1', '100-0')).resolves.toBeUndefined()
  })

  // When sinceId carries the maximum counter value (999999) the next sort key wraps to
  // the next millisecond, ensuring retrieveSince still excludes the boundary event.
  it('retrieveSince wraps to the next millisecond when sinceId counter is at max', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('1000-999999'))
    await queue.append('u1', mkEvent('1001-000001'))
    // sinceId = '1000-999999' — lexKeyNext must wrap to '1001-000000', so only '1001-000001' is returned.
    const events = await queue.retrieveSince('u1', '1000-999999', 10)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe('1001-000001')
  })

  // append resolves when pipeline.exec() returns null (covers the ?? [] null branch).
  it('resolves when pipeline.exec() returns null', async () => {
    // Covers: the `?? []` null-coalescing branch when exec() resolves to null.
    const queue = new RedisOfflineQueue({ client: fakeClientWithPipeline(null) })
    await expect(queue.append('u1', mkEvent('1-0'))).resolves.toBeUndefined()
  })

  // retrieveSince with a sinceId at the max counter value includes the event at the wrap boundary.
  it('includes the event exactly at the wrap-to-next-millisecond boundary', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('1000-999999'))
    await queue.append('u1', mkEvent('1001-000000'))
    await queue.append('u1', mkEvent('1001-000001'))
    const events = await queue.retrieveSince('u1', '1000-999999', 10)
    expect(events.map((e) => e.id)).toEqual(['1001-000000', '1001-000001'])
  })

  // acknowledge removes exactly the events up to and including upToId but leaves
  // the event at lexKeyNext(upToId) untouched (validates the exclusive upper bound).
  it('does not acknowledge the event immediately after upToId', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('100-0'))
    await queue.append('u1', mkEvent('100-1'))
    await queue.append('u1', mkEvent('100-2'))
    await queue.acknowledge('u1', '100-0')
    const remaining = await queue.retrieveSince('u1', '0-0', 10)
    expect(remaining.map((e) => e.id)).toEqual(['100-1', '100-2'])
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
  // Plain numeric sinceId must be excluded from results (same id is the boundary).
  it('excludes a plain numeric sinceId event from retrieveSince', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('1700000000000'))
    const events = await queue.retrieveSince('u1', '1700000000000', 10)
    expect(events).toHaveLength(0)
  })

  // retrieveSince with a plain numeric sinceId returns the event at sinceId+1 counter.
  it('returns the event at sinceId counter+1 when sinceId is a plain numeric id', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('1700000000000-1'))
    const events = await queue.retrieveSince('u1', '1700000000000', 10)
    expect(events).toHaveLength(1)
    expect(events[0]!.id).toBe('1700000000000-1')
  })

  // acknowledge must remove an event stored with a plain numeric id from durable storage.
  it('acknowledge removes an event stored with a plain numeric id', async () => {
    const { queue } = build()
    await queue.append('u1', mkEvent('1700000000000'))
    await queue.acknowledge('u1', '1700000000000')
    const remaining = await queue.retrieveSince('u1', '0-0', 10)
    expect(remaining).toHaveLength(0)
  })

  // zrem must not be called when no events match the acknowledge range (avoids spreading empty array).
  it('does not call zrem when acknowledge finds an empty match set', async () => {
    const { queue, client } = build()
    const zremSpy = jest.spyOn(client as unknown as { zrem: jest.Mock }, 'zrem')
    await queue.acknowledge('u1', '999-999999')
    expect(zremSpy).not.toHaveBeenCalled()
    zremSpy.mockRestore()
  })
})
