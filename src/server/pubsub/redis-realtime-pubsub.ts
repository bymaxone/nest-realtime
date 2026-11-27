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
import { windowedReport } from '../utils/windowed-report'
import { assertBuiltinsIntact, returnable } from '../utils/builtin-baseline'
import { absorbed, firstOf, shielded, unboxed, withinDeadline } from '../utils/within-deadline'
import { PROBE_DEADLINE_MS, PROBE_INTERVAL_MS, watchLiveness } from './watch-liveness'

/** The window of the report of dropped malformed payloads. */
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
 * How long subscribing waits for the first SUBSCRIBE to be answered. A server that takes the
 * connection and says nothing raises neither an error nor a close, and ioredis by default waits
 * with no bound, so past this the boot goes on unsubscribed.
 */
const SUBSCRIBE_WAIT_MS = 2_000

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

/**
 * The retry delay of a replacement whose host's `sentinelRetryStrategy` gives up: ioredis's own cap
 * for that strategy. ioredis does not clear that wait on `disconnect()`, so it stays short.
 */
const SENTINEL_RETRY_MS = 1_000

/** The subscriber's `sentinelCommandTimeout` when the host sets none: ioredis has no default. */
const SENTINEL_COMMAND_TIMEOUT_MS = 5_000

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
 * Messages are JSON-encoded. A malformed payload is dropped, counted and reported.
 *
 * Whether this instance hears the other instances is a state, `isSubscribed()`, that follows the
 * subscriber connection for the life of the process. `subscribe()` fails when the server answers in
 * time with an error reply (a wrong password, a missing permission), which no retry can fix; when
 * the server cannot be reached, or has not answered in {@link SUBSCRIBE_WAIT_MS}, it resolves and
 * the instance stays unsubscribed until a SUBSCRIBE is confirmed. Each change of that state is
 * logged once, not once per retry.
 *
 * A subscriber connection that stops answering without closing raises no event, so
 * {@link watchLiveness} PINGs it while it is ready; an unanswered PING marks the instance
 * unsubscribed and replaces the connection.
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
  /** Payloads dropped as unparsable, counted between reports. */
  private readonly malformed = windowedReport(
    () => 0,
    (count) => {
      logEvent(
        this.logger,
        'warn',
        'REALTIME_PUBSUB_DROPPED',
        `dropped ${count} malformed payload(s) since the last report`,
        { count, last: 'malformed' },
      )
    },
    MALFORMED_REPORT_INTERVAL_MS,
  )
  /** Whether the subscriber connection holds a confirmed SUBSCRIBE right now. */
  #subscribed = false
  /** Whether the current outage has been logged, so a retry loop adds no line. */
  // Stryker disable next-line BooleanLiteral: equivalent — createSubscriber sets it before any use
  #outageLogged = false
  /** Connections closed on purpose, whose `close` is not an outage and says nothing of a successor. */
  readonly #retired = new WeakSet<Redis>()
  /** What stops the PING watch of each subscriber connection. */
  readonly #unwatch = new WeakMap<Redis, () => void>()
  /** Connections the watch replaced and that have not been ready since. */
  readonly #silenced = new WeakSet<Redis>()
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
   * connection drops, and ioredis can send it again on the next connection by default.
   * `commandTimeout` on the host's ioredis client rejects the command without stopping that;
   * `autoResendUnfulfilledCommands: false` stops it, and needs `commandTimeout` with it, or a
   * command lost at a reconnect stays pending.
   */
  async publish(message: RealtimePubSubMessage): Promise<void> {
    const status = this.#pub.status
    if (CANNOT_PUBLISH.has(status)) {
      this.connectLazyClient()
      throw this.cannotPublish(`the Redis client is ${status}`)
    }
    const sent = this.#pub.publish(this.channel, JSON.stringify(message))
    await withinDeadline(sent, PUBLISH_WAIT_MS, {
      timeoutError: () =>
        this.cannotPublish(`the server did not answer within ${PUBLISH_WAIT_MS} ms`),
    })
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
   * payloads are dropped and reported with their count.
   *
   * If the subscriber client cannot be created (e.g. Redis temporarily unavailable),
   * the handler registration is rolled back and the cached init promise is cleared so
   * the next call retries from scratch.
   */
  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    let sub: Redis
    try {
      sub = await shielded(this.ensureSubscriber())
    } catch (err) {
      // Atomically undo the handler registration and clear the failed init promise
      // so the next subscribe() retries with a fresh client.
      this.handlers.delete(handler)
      this.#subInit = null
      throw err
    }
    // Only now: the subscriber is attached, so it recovers from a reconnect while this waits.
    await shielded(this.publisherSettled())
    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        this.#subInit = null
        this.retire(sub)
        const connected = this.#subscribed
        this.#subscribed = false
        this.malformed.stop()
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

  /** The publishing client's duplicate, with the options this connection depends on. */
  private duplicateForSubscribing(): Redis {
    // ioredis's own replay after a reconnect has no handler for a refusal, which would surface
    // as an unhandled rejection; the SUBSCRIBE sent on `ready` below replaces it. The offline queue
    // is forced on, whatever the host client chose: the first SUBSCRIBE is issued before the
    // connection exists.
    // `disconnectTimeout` is how long ioredis lets a socket close after `disconnect()` before it
    // destroys it, 2,000 ms by default. The timer that waits is cleared only by the socket's
    // `close`, which a subscriber that has ended, or is waiting to reconnect, no longer has coming,
    // so the default would keep the process alive that long. A retired subscriber has nothing in
    // flight worth waiting for.
    // Auto-pipelining is off: a pipeline lost with its connection is never completed when the host
    // does not resend, and no later PING would be written.
    // The host's retry strategies decide as before, except while the watch is replacing a silent
    // connection: giving up there would end a subscriber that an open connection would have kept.
    // The two Sentinel options are inert without Sentinel. With no command timeout, a Sentinel that
    // accepts and never answers holds a replacement in `connecting`, even after `disconnect()`.
    const sub: Redis = this.#pub.duplicate({
      autoResubscribe: false,
      disconnectTimeout: 1,
      enableAutoPipelining: false,
      enableOfflineQueue: true,
      sentinelCommandTimeout:
        this.#pub.options?.sentinelCommandTimeout ?? SENTINEL_COMMAND_TIMEOUT_MS,
      retryStrategy: (times: number) =>
        this.retryDelay('retryStrategy', times, sub, PROBE_INTERVAL_MS),
      sentinelRetryStrategy: (times: number) =>
        this.retryDelay('sentinelRetryStrategy', times, sub, SENTINEL_RETRY_MS),
    })
    return sub
  }

  /** The delay the host's strategy gives, or `held` where it gives none to a replacement of `sub`. */
  private retryDelay(
    name: 'retryStrategy' | 'sentinelRetryStrategy',
    times: number,
    sub: Redis,
    held: number,
  ): number | void | null {
    const host = this.#pub.options
    // ioredis takes anything else, which an untyped host can pass, as "do not retry".
    const delay = typeof host[name] === 'function' ? host[name](times) : undefined
    return typeof delay === 'number' || !this.#silenced.has(sub) ? delay : held
  }

  private async createSubscriber(): Promise<Redis> {
    this.#outageLogged = false
    this.#lastRefusal = undefined
    this.connectLazyClient()
    const sub = this.duplicateForSubscribing()
    let attached = false
    sub.on('message', (_ch: string, payload: string) => this.dispatch(payload))
    // An error reply in time is the server's answer and reaches the caller as the rejection;
    // anything else, an error or a close with no error at all, is the connection failing, which
    // ioredis retries on its own.
    let unanswered: NodeJS.Timeout | undefined
    const unreachableFirst = new Promise<{ readonly unreachable: unknown }>((resolve) => {
      unanswered = setTimeout(() => {
        resolve({ unreachable: new Error(`no answer to SUBSCRIBE within ${SUBSCRIBE_WAIT_MS} ms`) })
      }, SUBSCRIBE_WAIT_MS)
      unanswered.unref()
      sub.on('error', (err: Error) => {
        if (err.name !== 'ReplyError') resolve({ unreachable: err })
      })
      sub.on('close', () => {
        resolve({ unreachable: new Error() })
        if (!this.#retired.has(sub)) this.markDown('connection closed')
      })
    })
    this.#unwatch.set(
      sub,
      watchLiveness(sub, () => this.replace(sub)),
    )
    // After a reconnect the subscription is gone with the old connection; subscribing again is
    // what restores it, and its answer is what confirms it.
    sub.on('ready', () => {
      this.#silenced.delete(sub)
      if (attached) this.confirm(sub)
    })
    try {
      await shielded(this.negotiate(sub, sub.subscribe(this.channel), unreachableFirst))
    } finally {
      clearTimeout(unanswered)
    }
    attached = true
    return sub
  }

  /**
   * Settles the boot against the first SUBSCRIBE. An error reply in time is the server refusing, which
   * fails the boot; any other failure, an error event or a close or a rejection that is not an
   * error reply, or no answer in time, lets the boot go on unready.
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
            return returnable({ unreachable: err })
          }
        })(),
      )
      const outcome = unboxed(await firstOf(subscribed, unreachableFirst))
      if (outcome === 'subscribed') {
        this.markUp()
      } else {
        this.markDown(undefined, outcome.unreachable)
        // The server may still answer this SUBSCRIBE. Its confirmation counts where the
        // connection's `ready` has already fired and so sends no SUBSCRIBE of its own.
        first.then(
          () => this.confirmedBy(sub),
          (err: unknown) => this.unconfirmed(sub, err),
        )
      }
    } catch (err) {
      this.retire(sub)
      sub.disconnect()
      throw unavailableError(
        REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
        RedisRealtimePubSub.name,
        `could not subscribe to "${this.channel}"`,
        err,
      )
    }
  }

  /** A subscriber closed on purpose: its `close` is no outage and it is not watched again. */
  private retire(sub: Redis): void {
    this.#retired.add(sub)
    this.#unwatch.get(sub)?.()
  }

  /** The connection is open and silent: nothing else would close it. `ready` subscribes the next. */
  private replace(sub: Redis): void {
    this.markDown(`no answer to PING within ${PROBE_DEADLINE_MS} ms`)
    this.#silenced.add(sub)
    sub.disconnect(true)
  }

  private confirm(sub: Redis): void {
    sub.subscribe(this.channel).then(
      () => this.confirmedBy(sub),
      (err: unknown) => this.refused(err),
    )
  }

  /**
   * The first SUBSCRIBE failed after the boot went on. On a ready connection only the host's
   * `commandTimeout`, armed before `ready`, does that, and no `ready` is coming to send another.
   */
  private unconfirmed(sub: Redis, err: unknown): void {
    this.refused(err)
    if ((err as { name?: unknown } | null)?.name !== 'ReplyError' && sub.status === 'ready') {
      this.confirm(sub)
    }
  }

  /** A confirmation can arrive on a subscriber that was retired while the answer was on its way. */
  private confirmedBy(sub: Redis): void {
    if (!this.#retired.has(sub)) this.markUp()
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

  private dispatch(payload: string): void {
    let msg: RealtimePubSubMessage
    try {
      const parsed: unknown = JSON.parse(payload)
      // Valid JSON that is not an object has no op to act on; a handler would be handed `null`.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.malformed((count) => count + 1)
        return
      }
      msg = parsed as RealtimePubSubMessage
    } catch {
      this.malformed((count) => count + 1)
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
