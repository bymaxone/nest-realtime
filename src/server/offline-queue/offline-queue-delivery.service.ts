/**
 * @fileoverview Delivers missed offline-queue events on reconnect.
 * @layer application
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { REALTIME_OFFLINE_QUEUE_TOKEN } from '../constants/injection-tokens.constants'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'

const RETRIEVE_LIMIT = 200

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

  constructor(
    @Optional()
    @Inject(REALTIME_OFFLINE_QUEUE_TOKEN)
    private readonly storage?: IOfflineQueueStorage,
  ) {}

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
   * @returns Gap events, or an empty array when no offline queue is configured.
   */
  async retrieve(
    userId: string,
    lastEventId: string,
    ringBufferIds: Set<string>,
  ): Promise<OfflineQueuedEvent[]> {
    if (!this.storage) return []

    let events: OfflineQueuedEvent[]
    try {
      events = await this.storage.retrieveSince(userId, lastEventId, RETRIEVE_LIMIT)
    } catch (err) {
      this.logger.warn(`Offline queue retrieve failed: ${(err as Error).message}`)
      return []
    }

    if (events.length === RETRIEVE_LIMIT) {
      this.logger.warn(
        `Offline queue retrieve hit the ${RETRIEVE_LIMIT}-event limit for user; older gap events may be dropped.`,
      )
    }

    return events.filter((e) => !ringBufferIds.has(e.id))
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
      this.logger.warn(`Offline queue acknowledge failed: ${(err as Error).message}`)
    }
  }
}
