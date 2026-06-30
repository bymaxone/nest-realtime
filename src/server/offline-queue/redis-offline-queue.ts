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
 * The score is derived from the event's `id` (which is a `{ms}-{counter}` string
 * or a plain numeric string). Events are trimmed to `maxPerUser` oldest-first,
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

  constructor(options: RedisOfflineQueueOptions) {
    this.client = options.client
    this.maxPerUser = options.maxPerUser ?? 500
    this.ttlSeconds = options.ttlSeconds ?? 3600
  }

  private key(userId: string): string {
    return `bymax:oq:${userId}`
  }

  /**
   * Parse an event id into a numeric sort score.
   *
   * Handles two formats:
   * - `{ms}-{counter}` from EventIdGenerator: `1700000000000-3` → `1700000000000.000003`
   * - Legacy plain numeric strings: `1700000000000` → `1700000000000`
   */
  private parseScore(id: string): number {
    const dashIdx = id.indexOf('-')
    if (dashIdx === -1) return Number(id)
    const ms = Number(id.slice(0, dashIdx))
    const counter = Number(id.slice(dashIdx + 1))
    // Encode counter as fractional part so ties sort by insertion order.
    return ms + counter / 1_000_000
  }

  async append(userId: string, event: OfflineQueuedEvent): Promise<void> {
    const key = this.key(userId)
    const score = this.parseScore(event.id)
    const payload = JSON.stringify(event)
    const pipeline = this.client.pipeline()
    pipeline.zadd(key, score, payload)
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
    const score = this.parseScore(sinceId)
    // Use exclusive lower bound `(${score}` to exclude the sinceId event itself.
    const raw = await this.client.zrangebyscore(
      this.key(userId),
      `(${score}`,
      '+inf',
      'LIMIT',
      0,
      limit,
    )
    return raw.map(
      (entry) =>
        JSON.parse(entry, (key, value: unknown) =>
          key === 'emittedAt' ? new Date(value as string) : value,
        ) as OfflineQueuedEvent,
    )
  }

  async acknowledge(userId: string, upToId: string): Promise<void> {
    const score = this.parseScore(upToId)
    await this.client.zremrangebyscore(this.key(userId), '-inf', score)
  }
}
