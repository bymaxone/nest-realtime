/**
 * @fileoverview Delivers missed offline-queue events on reconnect.
 * @layer application
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import {
  REALTIME_HOOKS_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../constants/injection-tokens.constants'
import type { IConnectionLifecycleHooks } from '../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { describeError } from '../utils/describe-error'
import { reportDeliveryFailure } from '../utils/report-delivery-failure'

const RETRIEVE_LIMIT = 200

/** `authenticateTimeoutMs` when it is not set. */
const DEFAULT_TIMEOUT_MS = 10_000

/** `maxPendingHandshakes` when it is not set. */
const DEFAULT_MAX_PENDING = 1_000

/** How long a window of timeouts is summarised in one log line. */
const REPORT_WINDOW_MS = 10_000

/** What the first read of a reconnect's gap came to. */
export interface OfflineQueueRead {
  /** The gap events, in queue order. */
  readonly events: OfflineQueuedEvent[]
  /**
   * Whether the store failed: the gap is then empty, and the reconnect is served without it, as an
   * outage of the store has always been served, so no second read is made for it.
   */
  readonly degraded: boolean
}

/** The read of the offline queue did not settle in time: the handshake is given up on. */
export class OfflineQueueTimeoutError extends Error {
  constructor() {
    super('the offline queue did not answer in time')
  }
}

/**
 * Fetches events from the offline queue that the client missed since `lastEventId`
 * and de-duplicates them against the in-memory replay buffer.
 *
 * Retrieval and acknowledgment are split to preserve at-least-once delivery:
 * `retrieve` never prunes the durable queue, and `acknowledge` is called only after
 * the events have been emitted to a live subscriber. A client that disconnects before
 * emission therefore keeps its gap events durable for redelivery on the next reconnect.
 *
 * Injected `@Optional()` so consumers that do not configure an offline queue still
 * get a no-op service (returns `[]`).
 */
@Injectable()
export class OfflineQueueDeliveryService {
  private readonly logger = new Logger(OfflineQueueDeliveryService.name)
  private readonly timeoutMs: number
  private readonly maxPending: number
  private pending = 0
  private windowStartedAt = Number.NEGATIVE_INFINITY
  private timedOut = 0

  constructor(
    @Optional()
    @Inject(REALTIME_OFFLINE_QUEUE_TOKEN)
    private readonly storage?: IOfflineQueueStorage,
    @Optional()
    @Inject(REALTIME_HOOKS_TOKEN)
    private readonly hooks?: IConnectionLifecycleHooks,
    @Optional()
    @Inject(REALTIME_OPTIONS_TOKEN)
    options?: BymaxRealtimeModuleOptions,
  ) {
    this.timeoutMs = options?.authenticateTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxPending = options?.maxPendingHandshakes ?? DEFAULT_MAX_PENDING
  }

  /**
   * Return events for `userId` that arrived after `lastEventId` and are NOT
   * already covered by `ringBufferIds` (already replayed from in-memory buffer).
   *
   * Retrieval does NOT acknowledge: the durable queue is pruned only after the events
   * have been emitted to a live subscriber via {@link acknowledge}. This guarantees
   * at-least-once delivery — events that never reach the client are never lost.
   *
   * @param userId - The reconnecting user.
   * @param lastEventId - The `Last-Event-ID` header value.
   * @param ringBufferIds - Set of event ids already replayed from the ring buffer.
   * @returns Gap events, or an empty array when no offline queue is configured or it fails.
   * @throws OfflineQueueTimeoutError when the queue has not answered in `authenticateTimeoutMs`: the
   *   read is part of the handshake, so a queue that hangs must not keep the request open. The call
   *   to the storage cannot be cancelled and runs on, and its late answer is ignored. It keeps its
   *   place among the `maxPendingHandshakes` reads waiting at once until it settles, and a read that
   *   finds them all taken is refused the same way without calling the storage.
   */
  async retrieve(
    userId: string,
    lastEventId: string,
    ringBufferIds: Set<string>,
  ): Promise<OfflineQueuedEvent[]> {
    const { events } = await this.retrieveGap(userId, lastEventId)
    return events.filter((e) => !ringBufferIds.has(e.id))
  }

  /**
   * The first read of a reconnect's gap: what {@link retrieve} returns, with whether the store failed.
   * A reconnect that was served without the gap because the store failed is not asked a second time
   * for what was appended since ({@link retrieveAppended}): the store is down, and the reconnect
   * degrades as it always has.
   *
   * @param userId - The reconnecting user.
   * @param lastEventId - The `Last-Event-ID` header value.
   * @throws OfflineQueueTimeoutError as {@link retrieve} does.
   */
  async retrieveGap(userId: string, lastEventId: string): Promise<OfflineQueueRead> {
    const storage = this.storage
    if (!storage) return { events: [], degraded: false }

    let events: OfflineQueuedEvent[]
    try {
      events = await this.read(storage, userId, lastEventId, RETRIEVE_LIMIT)
    } catch (err) {
      if (err instanceof OfflineQueueTimeoutError) throw err
      reportDeliveryFailure(
        this.logger,
        this.hooks,
        {
          code: REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
          op: 'offlineRetrieve',
          error: err,
        },
        'Offline queue retrieve failed',
      )
      return { events: [], degraded: true }
    }

    if (events.length === RETRIEVE_LIMIT) {
      this.logger.warn(
        `Offline queue retrieve hit the ${RETRIEVE_LIMIT}-event limit for user; older gap events may be dropped.`,
      )
    }

    return { events, degraded: false }
  }

  /**
   * Acknowledge delivered offline events so the storage backend can prune them.
   *
   * At-least-once contract: call this ONLY after the events have been emitted to a
   * still-open subscriber. Acknowledging before emission would permanently drop events
   * that never reached the client. A failure is swallowed (logged) so a transient
   * storage error never disrupts delivery; the events simply redeliver on reconnect.
   *
   * @param userId - The user whose queue is acknowledged.
   * @param events - The delivered gap events; the last id is the prune watermark.
   */
  async acknowledge(userId: string, events: readonly OfflineQueuedEvent[]): Promise<void> {
    if (!this.storage || events.length === 0) return

    const lastId = events[events.length - 1]!.id
    try {
      await this.storage.acknowledge(userId, lastId)
    } catch (err) {
      this.logger.warn(`Offline queue acknowledge failed: ${describeError(err)}`)
    }
  }

  /**
   * Return what was appended to the queue after `read`, the first read of the same reconnect: the
   * events with an id after the last of them, or after `lastEventId` when it returned none, never
   * more than the one reconnect's limit in all. The first read is made before the response is
   * committed, and a user with no connection here has no replay ring, so an event emitted while the
   * application's interceptors ran sits in the queue and nowhere else.
   *
   * When the first read failed (`read.degraded`) there is nothing to add to: the store is down and the
   * reconnect is served as it always has been, without a second read. When it succeeded, every
   * failure of this read is thrown, the store's own error included, and the attempt ends before it
   * delivers anything: a stream built without these events moves the client's cursor past them with
   * the next event it receives, and an attempt that delivers nothing leaves the cursor where it was.
   * The read has the same deadline and the same share of `maxPendingHandshakes` as the first.
   *
   * @param userId - The reconnecting user.
   * @param lastEventId - The `Last-Event-ID` header value.
   * @param read - What the first read of this reconnect returned.
   * @returns The events appended since, in queue order; empty when no queue is configured, the first
   *   read failed, or it already reached the limit.
   * @throws OfflineQueueTimeoutError when the queue did not answer in time or the reads waiting at
   *   once are all taken; the store's own error when it fails.
   */
  async retrieveAppended(
    userId: string,
    lastEventId: string,
    read: OfflineQueueRead,
  ): Promise<OfflineQueuedEvent[]> {
    const storage = this.storage
    const room = RETRIEVE_LIMIT - read.events.length
    if (!storage || read.degraded || room <= 0) return []
    return this.read(storage, userId, read.events.at(-1)?.id ?? lastEventId, room)
  }

  /** One bounded call to the storage: refused at once when the reads waiting are all taken. */
  private async read(
    storage: IOfflineQueueStorage,
    userId: string,
    sinceId: string,
    limit: number,
  ): Promise<OfflineQueuedEvent[]> {
    if (this.pending >= this.maxPending) {
      this.countTimeout()
      throw new OfflineQueueTimeoutError()
    }
    try {
      const call = storage.retrieveSince(userId, sinceId, limit)
      // The call cannot be cancelled, so it keeps its place until it actually settles, not until it
      // was given up on: a store that never answers fills the limit instead of piling up one more
      // abandoned call for every reconnect.
      this.pending += 1
      const settled = (): void => void (this.pending -= 1)
      call.then(settled, settled)
      return await this.withinDeadline(call)
    } catch (err) {
      if (err instanceof OfflineQueueTimeoutError) this.countTimeout()
      throw err
    }
  }

  /** Settle with `read`, or reject with an OfflineQueueTimeoutError once the deadline has passed. */
  private async withinDeadline<T>(read: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new OfflineQueueTimeoutError()), this.timeoutMs)
      timer.unref()
    })
    try {
      return await Promise.race([read, expired])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Count a timeout, and log at most one line for each window, so a hung queue cannot flood the log. */
  private countTimeout(): void {
    this.timedOut += 1
    const now = performance.now()
    if (now - this.windowStartedAt < REPORT_WINDOW_MS) return
    this.windowStartedAt = now
    const count = this.timedOut
    this.timedOut = 0
    this.logger.warn(
      `reconnects given up on since the last report: ${count}, because the offline queue did not answer in ${this.timeoutMs} ms or already had ${this.maxPending} reads waiting`,
    )
  }
}
