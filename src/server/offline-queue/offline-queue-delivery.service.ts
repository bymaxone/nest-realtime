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
 * Fetches events from the offline queue that the client missed since `lastEventId`,
 * de-duplicates them against the in-memory replay buffer, and acknowledges the last
 * delivered event so the storage backend can prune.
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
   * @param userId - The reconnecting user.
   * @param lastEventId - The `Last-Event-ID` header value.
   * @param ringBufferIds - Set of event ids already replayed from the ring buffer.
   * @returns Gap events, or an empty array when no offline queue is configured.
   */
  async deliver(
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

    const gap = events.filter((e) => !ringBufferIds.has(e.id))

    if (gap.length > 0) {
      const lastId = gap[gap.length - 1]!.id
      try {
        await this.storage.acknowledge(userId, lastId)
      } catch (err) {
        this.logger.warn(`Offline queue acknowledge failed: ${(err as Error).message}`)
      }
    }

    return gap
  }
}
