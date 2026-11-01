/**
 * @fileoverview Redis-backed pub/sub for cross-instance SSE fan-out.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../interfaces/realtime-pubsub.interface'
import { describeError } from '../utils/describe-error'
import { unavailableError } from '../utils/unavailable-error'

/** The shortest time between two reports of dropped malformed payloads. */
const MALFORMED_REPORT_INTERVAL_MS = 60_000

/** A connection failure as text: ioredis wraps a refused connect in an error with no message. */
function connectionReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  const text = describeError(err)
  return [typeof code === 'string' ? code : '', text].filter(Boolean).join(' ') || String(err)
}

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
 * Messages are JSON-encoded. A malformed payload is dropped and counted, and the count is
 * reported at most once a minute.
 *
 * Whether this instance hears the other instances is a state, `isSubscribed()`, that follows the
 * subscriber connection for the life of the process. `subscribe()` fails when the server answers
 * with an error reply (a wrong password, a missing permission), which no retry can fix; when the
 * server cannot be reached it resolves at once and the instance stays unsubscribed until a
 * connection succeeds. Each change of that state is logged once, not once per retry.
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
  /**
   * The publishing Redis client.
   *
   * An ECMAScript private field for the same reason as the subscriber below: an
   * ioredis instance carries `options.password` as a plain field, and a
   * TypeScript `private` one is erased at runtime, leaving it enumerable to
   * anything that serializes this pubsub adapter.
   */
  readonly #pub: Redis
  private readonly channel: string
  /** The lazily created subscriber connection, which carries the same credentials. */
  #subInit: Promise<Redis> | null = null
  private readonly handlers = new Set<(message: RealtimePubSubMessage) => void>()
  private readonly logger = new Logger(RedisRealtimePubSub.name)
  /** Payloads dropped as unparsable since the last report, and when that report was made. */
  private malformedDropped = 0
  private malformedReportedAt = 0
  /** Whether the subscriber connection holds a confirmed SUBSCRIBE right now. */
  #subscribed = false
  /** Whether the current outage has been logged, so a retry loop adds no line. */
  // Stryker disable next-line BooleanLiteral: equivalent — createSubscriber sets it before any use
  #outageLogged = false
  /** Connections closed on purpose, whose `close` is not an outage and says nothing of a successor. */
  readonly #retired = new WeakSet<Redis>()

  constructor(options: RedisRealtimePubSubOptions) {
    this.#pub = options.client
    this.channel = options.channel ?? 'bymax:realtime'
  }

  /**
   * Whether this instance holds a confirmed subscription to the channel, so the events and
   * revocations other instances publish reach it. False before the first successful subscribe,
   * while the subscriber connection is down, and after the last handler has unsubscribed.
   */
  isSubscribed(): boolean {
    return this.#subscribed
  }

  /** JSON-encodes the message and PUBLISHes it to the configured channel. */
  async publish(message: RealtimePubSubMessage): Promise<void> {
    await this.#pub.publish(this.channel, JSON.stringify(message))
  }

  /**
   * Lazily creates the single shared subscribe client on first call; returns an async
   * unsubscribe that quits the client when the last handler is removed. Concurrent
   * subscribe calls are idempotent — only one client is ever created. Malformed
   * payloads are dropped, and reported at most once a minute with their count.
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
      this.#subInit = null
      throw err
    }
    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.#subInit = null
        this.#retired.add(sub)
        const connected = this.#subscribed
        this.#subscribed = false
        try {
          // QUIT queues behind a connection that never came up and would never answer.
          if (connected) await sub.quit()
          else sub.disconnect()
        } catch {
          // Quit failures are non-fatal; the reference is already cleared so the
          // next subscribe rebuilds a fresh client.
        }
      }
    }
  }

  /** Lazily create the single shared subscribe client (idempotent under concurrent calls). */
  private ensureSubscriber(): Promise<Redis> {
    if (!this.#subInit) this.#subInit = this.createSubscriber()
    return this.#subInit
  }

  private async createSubscriber(): Promise<Redis> {
    this.#outageLogged = false
    // ioredis's own replay after a reconnect has no handler for a refusal, which would surface
    // as an unhandled rejection; the SUBSCRIBE sent on `ready` below replaces it.
    const sub = this.#pub.duplicate({ autoResubscribe: false })
    let attached = false
    sub.on('message', (_ch: string, payload: string) => this.dispatch(payload))
    // An error reply is the server's answer and reaches the caller as the SUBSCRIBE's rejection;
    // anything else, an error or a close with no error at all, is the connection failing, which
    // ioredis retries on its own.
    const unreachableFirst = new Promise<{ readonly unreachable: unknown }>((resolve) => {
      sub.on('error', (err: Error) => {
        if (err.name !== 'ReplyError') resolve({ unreachable: err })
      })
      sub.on('close', () => {
        resolve({ unreachable: new Error('connection closed') })
        if (!this.#retired.has(sub)) this.markDown('connection closed')
      })
    })
    // After a reconnect the subscription is gone with the old connection; subscribing again is
    // what restores it, and its answer is what confirms it.
    sub.on('ready', () => {
      if (attached) this.confirm(sub)
    })
    const first = sub.subscribe(this.channel)
    try {
      const outcome = await Promise.race([
        first.then(() => 'subscribed' as const),
        unreachableFirst,
      ])
      if (outcome === 'subscribed') {
        this.markUp()
      } else {
        this.markDown(connectionReason(outcome.unreachable))
        // A confirmation needs no handler here: the connection's first `ready` sends its own.
        first.catch((err: unknown) => this.refused(err))
      }
    } catch (err) {
      this.#retired.add(sub)
      sub.disconnect()
      throw unavailableError(
        REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
        RedisRealtimePubSub.name,
        `could not subscribe to "${this.channel}"`,
        err,
      )
    }
    attached = true
    return sub
  }

  private confirm(sub: Redis): void {
    sub.subscribe(this.channel).then(
      () => this.markUp(),
      (err: unknown) => this.refused(err),
    )
  }

  /** A server that was reached and refused the SUBSCRIBE after boot: it stays unsubscribed. */
  private refused(err: unknown): void {
    // A command rejected because the connection closed is an outage, which 'close' reports.
    if ((err as { name?: unknown } | null)?.name !== 'ReplyError') return
    this.#subscribed = false
    this.logger.warn(
      `${REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE}: the server refused the subscription to "${this.channel}": ${describeError(err)}`,
    )
  }

  private markUp(): void {
    if (this.#subscribed) return
    this.#subscribed = true
    this.#outageLogged = false
    this.logger.log(
      `Subscribed to "${this.channel}"; remote events and revocations reach this instance`,
    )
  }

  private markDown(reason: string): void {
    this.#subscribed = false
    if (this.#outageLogged) return
    this.#outageLogged = true
    this.logger.warn(
      `${REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE}: not subscribed to "${this.channel}": ${reason}. Remote events and revocations will not reach this instance until it subscribes again`,
    )
  }

  /**
   * Count a payload dropped as unparsable and report the count at most once per minute, so a
   * producer on an incompatible version is visible without flooding the log.
   */
  private reportMalformed(): void {
    this.malformedDropped++
    const now = Date.now()
    if (now - this.malformedReportedAt < MALFORMED_REPORT_INTERVAL_MS) return
    this.logger.warn(
      `${REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE}: dropped ${this.malformedDropped} malformed payload(s) on "${this.channel}" since the last report`,
    )
    this.malformedDropped = 0
    this.malformedReportedAt = now
  }

  private dispatch(payload: string): void {
    let msg: RealtimePubSubMessage
    try {
      msg = JSON.parse(payload) as RealtimePubSubMessage
    } catch {
      this.reportMalformed()
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
