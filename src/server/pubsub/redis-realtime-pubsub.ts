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
import { logEvent } from '../utils/log-event'
import { quitWithin } from '../utils/quit-within'
import { unavailableError } from '../utils/unavailable-error'
import { assertBuiltinsIntact } from '../utils/builtin-baseline'
import { absorbed, firstOf, shielded, unboxed } from '../utils/within-deadline'

/** The shortest time between two reports of dropped malformed payloads. */
const MALFORMED_REPORT_INTERVAL_MS = 60_000

/**
 * The states in which an ioredis client cannot publish. A client that reports none of them, a
 * connected one or a test double with no status at all, is taken to be able to.
 */
const CANNOT_PUBLISH: ReadonlySet<string> = new Set([
  'wait',
  'connecting',
  'connect',
  'reconnecting',
  'close',
  'end',
])

/**
 * How long subscribing waits for the publishing client's first connection. The wait only spares a
 * start-up emit a refusal, so a client that stays silent past it is left unready rather than
 * allowed to block the boot.
 */
const PUBLISHER_WAIT_MS = 2_000

/**
 * How long a PUBLISH waits for the server's answer before it is given up on. A healthy Redis
 * answers in milliseconds, so the bound only matters when it does not: a paused or partitioned
 * server leaves a connected client reporting `ready` and never replies, and a publish that waited
 * for it would hold every emit and every revocation behind it.
 */
const PUBLISH_WAIT_MS = 2_000

/** The events that name a status other than connecting: each ends a first connection attempt. */
const CONNECTION_OVER = ['ready', 'close', 'reconnecting', 'end'] as const

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
  /** The reason of the refusal last logged, until the instance next subscribes, so a repeat adds no line. */
  #lastRefusal: string | undefined

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
    return this.#subscribed && !CANNOT_PUBLISH.has(this.#pub.status)
  }

  /**
   * JSON-encodes the message and PUBLISHes it to the configured channel, if the client can publish.
   * ioredis queues a command issued while it cannot and sends it, late, when the connection
   * returns, and never gives up on one waiting behind a peer that does not answer, so a revocation
   * would wait out the whole outage and then be sent after its caller was told it failed. It is
   * refused at once instead, and never handed to the client.
   *
   * A client that can publish but whose server stops answering is given {@link PUBLISH_WAIT_MS}:
   * after it the publish rejects the same way. That rejection means the server did not confirm the
   * publish in time, not that it was not delivered: the command was already written to the socket
   * and Redis can still process it when it answers, so a message can arrive after its caller was
   * told it failed. The command also stays queued in the client until the server answers or the
   * connection drops; `commandTimeout` on the host's ioredis client is what rejects the command
   * itself.
   */
  async publish(message: RealtimePubSubMessage): Promise<void> {
    const status = this.#pub.status
    if (CANNOT_PUBLISH.has(status)) {
      this.connectLazyClient()
      throw this.cannotPublish(`the Redis client is ${status}`)
    }
    const sent = this.#pub.publish(this.channel, JSON.stringify(message))
    let timer: NodeJS.Timeout | undefined
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(this.cannotPublish(`the server did not answer within ${PUBLISH_WAIT_MS} ms`)),
        PUBLISH_WAIT_MS,
      )
      timer.unref()
    })
    try {
      await Promise.race([sent, expired])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * A host client built with lazyConnect waits for its first command to connect, and that command
   * would be refused; connecting it is what the command would have done. Its failures show as its
   * status.
   */
  private connectLazyClient(): void {
    if (this.#pub.status === 'wait') this.#pub.connect().catch(() => undefined)
  }

  /**
   * Resolves once the publishing client's first connection attempt is over, however it ended:
   * ready, closed (to retry or to give up), or ended with no close when its connector fails. The
   * client is created just before the application boots, so for its first milliseconds it is still
   * connecting, and an emit from another provider's start-up hook would be refused for it. A
   * client that answers nothing is given up on after the deadline.
   */
  private publisherSettled(): Promise<void> {
    const pub = this.#pub
    if (pub.status !== 'connecting' && pub.status !== 'connect') return Promise.resolve()
    return new Promise((resolve) => {
      const settle = (): void => {
        clearTimeout(deadline)
        for (const event of CONNECTION_OVER) pub.off(event, settle)
        resolve()
      }
      const deadline = setTimeout(settle, PUBLISHER_WAIT_MS)
      deadline.unref()
      for (const event of CONNECTION_OVER) pub.once(event, settle)
    })
  }

  private cannotPublish(reason: string): Error {
    return unavailableError(
      REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
      RedisRealtimePubSub.name,
      `cannot publish to "${this.channel}" (${reason})`,
      new Error(reason),
    )
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
    // Only now: the subscriber is attached, so it recovers from a reconnect while this waits.
    await this.publisherSettled()
    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.#subInit = null
        this.#retired.add(sub)
        const connected = this.#subscribed
        this.#subscribed = false
        try {
          // QUIT queues behind a connection that never came up and would never answer, and on one
          // that stopped answering it never settles: closing waits for it only up to a bound.
          if (connected) await quitWithin(sub)
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
    this.#lastRefusal = undefined
    this.connectLazyClient()
    // ioredis's own replay after a reconnect has no handler for a refusal, which would surface
    // as an unhandled rejection; the SUBSCRIBE sent on `ready` below replaces it. The offline queue
    // is forced on, whatever the host client chose: the first SUBSCRIBE is issued before the
    // connection exists.
    // `disconnectTimeout` is how long ioredis lets a socket close after `disconnect()` before it
    // destroys it, 2,000 ms by default. The timer that waits is cleared only by the socket's
    // `close`, which a subscriber that has ended, or is waiting to reconnect, no longer has coming,
    // so the default would keep the process alive that long. A retired subscriber has nothing in
    // flight worth waiting for.
    const sub = this.#pub.duplicate({
      autoResubscribe: false,
      disconnectTimeout: 1,
      enableOfflineQueue: true,
    })
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
        resolve({ unreachable: new Error() })
        if (!this.#retired.has(sub)) this.markDown('connection closed')
      })
    })
    // After a reconnect the subscription is gone with the old connection; subscribing again is
    // what restores it, and its answer is what confirms it.
    sub.on('ready', () => {
      if (attached) this.confirm(sub)
    })
    await this.negotiate(sub, sub.subscribe(this.channel), unreachableFirst)
    attached = true
    return sub
  }

  /**
   * Settles the boot against the first SUBSCRIBE. An error reply is the server refusing, which
   * fails the boot; any other failure, an error event or a close or a rejection that is not an
   * error reply, is the connection failing, which lets the boot go on unready.
   */
  private async negotiate(
    sub: Redis,
    first: Promise<unknown>,
    unreachableFirst: Promise<{ readonly unreachable: unknown }>,
  ): Promise<void> {
    // A refusal below leaves `first` unread, and closing the connection then rejects it.
    void absorbed(first)
    try {
      const subscribed = shielded(
        (async () => {
          // Outside the `try`: a refusal is not the connection failing.
          assertBuiltinsIntact()
          try {
            await first
            return 'subscribed' as const
          } catch (err) {
            if ((err as Error).name === 'ReplyError') throw err
            // The last statement before an object return, which asks the object for a `then`.
            assertBuiltinsIntact()
            return { unreachable: err }
          }
        })(),
      )
      const outcome = unboxed(await firstOf(subscribed, unreachableFirst))
      if (outcome === 'subscribed') {
        this.markUp()
      } else {
        this.markDown(undefined, outcome.unreachable)
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
    // The same refusal can answer more than one SUBSCRIBE around a boot; it is one fact.
    const reason = describeError(err)
    if (reason === this.#lastRefusal) return
    this.#lastRefusal = reason
    logEvent(
      this.logger,
      'warn',
      'REALTIME_PUBSUB_UNAVAILABLE',
      'the server refused the subscription',
      {},
      err,
    )
  }

  private markUp(): void {
    if (this.#subscribed) return
    this.#subscribed = true
    this.#outageLogged = false
    this.#lastRefusal = undefined
    this.logger.log(
      `Subscribed to the realtime channel; remote events and revocations reach this instance`,
    )
  }

  /** The bus is not subscribed: `wording` is the library's own text, `error` what the connection raised. */
  private markDown(wording: string | undefined, error?: unknown): void {
    this.#subscribed = false
    if (this.#outageLogged) return
    this.#outageLogged = true
    logEvent(
      this.logger,
      'warn',
      'REALTIME_PUBSUB_UNAVAILABLE',
      `not subscribed${wording === undefined ? '' : `: ${wording}`}. Remote events and revocations will not reach this instance until it subscribes again`,
      {},
      error,
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
    logEvent(
      this.logger,
      'warn',
      'REALTIME_PUBSUB_DROPPED',
      `dropped ${this.malformedDropped} malformed payload(s) since the last report`,
      { count: this.malformedDropped, last: 'malformed' },
    )
    this.malformedDropped = 0
    this.malformedReportedAt = now
  }

  private dispatch(payload: string): void {
    let msg: RealtimePubSubMessage
    try {
      const parsed: unknown = JSON.parse(payload)
      // Valid JSON that is not an object has no op to act on; a handler would be handed `null`.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.reportMalformed()
        return
      }
      msg = parsed as RealtimePubSubMessage
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
