/**
 * @fileoverview Redis-backed pub/sub for cross-instance SSE fan-out.
 * @layer infrastructure
 */
import type Redis from 'ioredis'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../interfaces/realtime-pubsub.interface'

/** Options for RedisRealtimePubSub. */
export interface RedisRealtimePubSubOptions {
  /** The Redis client used for publishing. A separate subscriber clone is created internally. */
  readonly client: Redis
  /** The Redis pub/sub channel name. Defaults to `bymax:realtime`. */
  readonly channel?: string
}

/**
 * Redis-backed `IRealtimePubSub` for horizontal scaling.
 *
 * Uses two Redis clients: one for `PUBLISH` (the provided client) and one for
 * `SUBSCRIBE` (a lazily-duplicated clone). The subscriber clone is created on
 * the first `subscribe()` call and quit on the last `unsubscribe()`.
 *
 * Messages are JSON-encoded. Malformed payloads are silently dropped.
 *
 * @example
 * ```ts
 * const redis = new Redis(process.env.REDIS_URL)
 * BymaxRealtimeModule.forRoot({
 *   transport: 'sse',
 *   authenticator,
 *   pubsub: new RedisRealtimePubSub({ client: redis }),
 * })
 * ```
 */
export class RedisRealtimePubSub implements IRealtimePubSub {
  private readonly pub: Redis
  private readonly channel: string
  private sub: Redis | null = null
  private readonly handlers = new Set<(message: RealtimePubSubMessage) => void>()

  constructor(options: RedisRealtimePubSubOptions) {
    this.pub = options.client
    this.channel = options.channel ?? 'bymax:realtime'
  }

  async publish(message: RealtimePubSubMessage): Promise<void> {
    await this.pub.publish(this.channel, JSON.stringify(message))
  }

  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    if (!this.sub) {
      this.sub = this.pub.duplicate()
      await this.sub.subscribe(this.channel)
      this.sub.on('message', (_ch: string, payload: string) => {
        let msg: RealtimePubSubMessage
        try {
          msg = JSON.parse(payload) as RealtimePubSubMessage
        } catch {
          // Silently drop malformed payloads.
          return
        }
        for (const h of this.handlers) {
          try {
            h(msg)
          } catch {
            // Best-effort fan-out.
          }
        }
      })
    }

    this.handlers.add(handler)

    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0 && this.sub) {
        await this.sub.quit()
        this.sub = null
      }
    }
  }
}
