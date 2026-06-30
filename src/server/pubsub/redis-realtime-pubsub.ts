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
  private subInit: Promise<Redis> | null = null
  private readonly handlers = new Set<(message: RealtimePubSubMessage) => void>()

  constructor(options: RedisRealtimePubSubOptions) {
    this.pub = options.client
    this.channel = options.channel ?? 'bymax:realtime'
  }

  /** JSON-encodes the message and PUBLISHes it to the configured channel. */
  async publish(message: RealtimePubSubMessage): Promise<void> {
    await this.pub.publish(this.channel, JSON.stringify(message))
  }

  /**
   * Lazily creates the single shared subscribe client on first call; returns an async
   * unsubscribe that quits the client when the last handler is removed. Concurrent
   * subscribe calls are idempotent — only one client is ever created. Malformed
   * payloads are dropped silently.
   *
   * If the subscriber client cannot be created (e.g. Redis temporarily unavailable),
   * the handler registration is rolled back and the cached init promise is cleared so
   * the next call retries from scratch.
   */
  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    let sub: Redis
    try {
      sub = await this.ensureSubscriber()
    } catch (err) {
      // Atomically undo the handler registration and clear the failed init promise
      // so the next subscribe() retries with a fresh client.
      this.handlers.delete(handler)
      this.subInit = null
      throw err
    }
    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.subInit = null
        try {
          await sub.quit()
        } catch {
          // Quit failures are non-fatal; the reference is already cleared so the
          // next subscribe rebuilds a fresh client.
        }
      }
    }
  }

  /** Lazily create the single shared subscribe client (idempotent under concurrent calls). */
  private ensureSubscriber(): Promise<Redis> {
    if (!this.subInit) this.subInit = this.createSubscriber()
    return this.subInit
  }

  private async createSubscriber(): Promise<Redis> {
    const sub = this.pub.duplicate()
    await sub.subscribe(this.channel)
    sub.on('message', (_ch: string, payload: string) => this.dispatch(payload))
    return sub
  }

  private dispatch(payload: string): void {
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
  }
}
