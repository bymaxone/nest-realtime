/**
 * @fileoverview Redis sorted-set offline queue for durable per-user event retention.
 * @layer infrastructure
 */
import type Redis from 'ioredis'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'

/** Options for RedisOfflineQueue. */
export interface RedisOfflineQueueOptions {
  /** The Redis client to use for all queue operations. */
  readonly client: Redis
  /** Maximum events retained per user (oldest are trimmed). Defaults to 500. */
  readonly maxPerUser?: number
  /** TTL for each user's key in seconds. Defaults to 3600 (1 hour). */
  readonly ttlSeconds?: number
}

/**
 * Redis sorted-set–backed implementation of `IOfflineQueueStorage`.
 *
 * Each user's events are stored in a sorted set keyed `bymax:oq:{userId}`.
 * All entries share score 0; ordering is purely lexicographic on the member
 * prefix `${ms_padded}-${counter_padded}|${json}`, which is immune to the
 * IEEE-754 double precision loss that affects fractional ZSET scores at
 * epoch-millisecond magnitude. Events are trimmed to `maxPerUser` oldest-first,
 * and the key expires after `ttlSeconds` of inactivity.
 *
 * @example
 * ```ts
 * const redis = new Redis(process.env.REDIS_URL)
 * BymaxRealtimeModule.forRoot({
 *   transport: 'sse',
 *   authenticator,
 *   offlineQueue: new RedisOfflineQueue({ client: redis }),
 * })
 * ```
 */
export class RedisOfflineQueue implements IOfflineQueueStorage {
  private readonly client: Redis
  private readonly maxPerUser: number
  private readonly ttlSeconds: number

  /** Zero-pad width for the epoch-millisecond component of the sort key. */
  private static readonly MS_PAD = 16

  /** Zero-pad width for the intra-millisecond counter component of the sort key. */
  private static readonly COUNTER_PAD = 6

  constructor(options: RedisOfflineQueueOptions) {
    this.client = options.client
    this.maxPerUser = options.maxPerUser ?? 500
    this.ttlSeconds = options.ttlSeconds ?? 3600
  }

  private key(userId: string): string {
    return `bymax:oq:${userId}`
  }

  /**
   * Build the fixed-width lexicographic sort key for an event id.
   *
   * Handles two id formats:
   * - `{ms}-{counter}` from EventIdGenerator: `1717000000000-000001`
   * - Legacy plain numeric strings: `1700000000000`
   */
  private lexKey(id: string): string {
    const dashIdx = id.indexOf('-')
    const ms = dashIdx === -1 ? Number(id) : Number(id.slice(0, dashIdx))
    const counter = dashIdx === -1 ? 0 : Number(id.slice(dashIdx + 1))
    return (
      String(ms).padStart(RedisOfflineQueue.MS_PAD, '0') +
      '-' +
      String(counter).padStart(RedisOfflineQueue.COUNTER_PAD, '0')
    )
  }

  /**
   * Return the lexicographically next sort key after `id`, used as an
   * inclusive ZRANGEBYLEX lower bound that excludes the `id` event itself.
   */
  private lexKeyNext(id: string): string {
    const dashIdx = id.indexOf('-')
    const ms = dashIdx === -1 ? Number(id) : Number(id.slice(0, dashIdx))
    const counter = dashIdx === -1 ? 0 : Number(id.slice(dashIdx + 1))
    const counterMax = 10 ** RedisOfflineQueue.COUNTER_PAD - 1
    const nextMs = counter < counterMax ? ms : ms + 1
    const nextCounter = counter < counterMax ? counter + 1 : 0
    return (
      String(nextMs).padStart(RedisOfflineQueue.MS_PAD, '0') +
      '-' +
      String(nextCounter).padStart(RedisOfflineQueue.COUNTER_PAD, '0')
    )
  }

  /** Encode an event into a lexicographically sortable ZSET member string. */
  private encodeMember(event: OfflineQueuedEvent): string {
    return `${this.lexKey(event.id)}|${JSON.stringify(event)}`
  }

  async append(userId: string, event: OfflineQueuedEvent): Promise<void> {
    const key = this.key(userId)
    const pipeline = this.client.pipeline()
    // Score 0 for all entries; lexicographic member ordering provides exact sorting.
    pipeline.zadd(key, 0, this.encodeMember(event))
    // Trim oldest entries beyond the per-user cap.
    pipeline.zremrangebyrank(key, 0, -(this.maxPerUser + 1))
    pipeline.expire(key, this.ttlSeconds)
    const results = (await pipeline.exec()) ?? []
    for (const [error] of results) {
      if (error) throw error
    }
  }

  async retrieveSince(
    userId: string,
    sinceId: string,
    limit: number,
  ): Promise<OfflineQueuedEvent[]> {
    // Inclusive lower bound starting at the next key after sinceId excludes the
    // sinceId event itself while correctly ordering same-millisecond events.
    const lowerBound = `[${this.lexKeyNext(sinceId)}`
    const raw = await this.client.zrangebylex(this.key(userId), lowerBound, '+', 'LIMIT', 0, limit)
    return raw.map(
      (entry) =>
        JSON.parse(entry.slice(entry.indexOf('|') + 1), (k, value: unknown) =>
          k === 'emittedAt' ? new Date(value as string) : value,
        ) as OfflineQueuedEvent,
    )
  }

  async acknowledge(userId: string, upToId: string): Promise<void> {
    // Exclusive upper bound just past the last possible member with key = upToId
    // ensures the upToId event itself is included in the removal range.
    const upperBound = `(${this.lexKeyNext(upToId)}`
    const toRemove = await this.client.zrangebylex(this.key(userId), '-', upperBound)
    if (toRemove.length > 0) {
      await this.client.zrem(this.key(userId), ...toRemove)
    }
  }
}
