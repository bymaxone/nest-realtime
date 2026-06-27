/**
 * @fileoverview Optional durable offline-queue storage for Last-Event-ID replay.
 * @layer contracts
 */

/** A single event persisted in a user's offline queue. */
export interface OfflineQueuedEvent {
  /** Monotonic id — used as `Last-Event-ID` across reconnections. */
  readonly id: string
  readonly event: string
  readonly data: unknown
  readonly emittedAt: Date
}

/**
 * Optional durable per-user offline queue.
 *
 * Consulted as a fallback when a reconnect's gap exceeds the in-memory replay
 * buffer. Implementations should enforce per-user retention (size + TTL).
 */
export interface IOfflineQueueStorage {
  /** Append an event to a user's offline queue. */
  append(userId: string, event: OfflineQueuedEvent): Promise<void>

  /** Retrieve events with `id > sinceId`, up to `limit`. */
  retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]>

  /** Mark events delivered up to `upToId`. Implementations may purge or retain. */
  acknowledge(userId: string, upToId: string): Promise<void>
}
