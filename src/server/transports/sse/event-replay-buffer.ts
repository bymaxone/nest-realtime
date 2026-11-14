/**
 * @fileoverview Per-user in-memory ring buffer for Last-Event-ID replay, bounded in the users it keeps.
 * @layer transport
 */
import { Inject, Injectable } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'

/** Default ring-buffer capacity when `sse.replayBufferSize` is unset. */
const DEFAULT_REPLAY_BUFFER_SIZE = 100

/** Default time an entry is kept after its user's last connection closed, in milliseconds. */
const DEFAULT_REPLAY_TTL_MS = 300_000

/** Default number of users kept after their last connection closed. */
const DEFAULT_REPLAY_MAX_IDLE_USERS = 1_000

/** A user's ring, and how many connections of theirs are open on this instance. */
interface Ring {
  readonly events: MessageEvent[]
  live: number
}

/**
 * Per-user ring buffer of recent events for `Last-Event-ID` replay.
 *
 * In-memory by design, and per instance: it survives only as long as the process, and it holds the
 * events of the users that have a connection here or had one lately. A user whose connections have
 * all closed is idle, and an idle entry is kept for `sse.replayTtlMs` and no more than
 * `sse.replayMaxIdleUsers` of them are kept at once, the one that closed longest ago going first. A
 * user with a connection open is never evicted: their number is bounded by the connections. Expiry
 * is checked when the buffer is used, so there is no timer to leak. For durable replay (another
 * instance, a restart, or a gap larger than the buffer), a consumer can plug `IOfflineQueueStorage`.
 *
 * @example
 * ```ts
 * // On reconnect with `Last-Event-ID: <id>`, replay what was missed:
 * const missed = replayBuffer.since(userId, lastEventId)
 * ```
 */
@Injectable()
export class EventReplayBuffer {
  private readonly rings = new Map<string, Ring>()
  /** The users with no connection open, in the order their last one closed, with the time it did. */
  private readonly idle = new Map<string, number>()

  constructor(
    @Inject(REALTIME_OPTIONS_TOKEN)
    private readonly opts: BymaxRealtimeModuleOptions,
  ) {}

  /** A connection of the user opened: from now on their events are kept, and the entry cannot expire. */
  open(userId: string): void {
    this.sweep()
    let ring = this.rings.get(userId)
    if (!ring) {
      ring = { events: [], live: 0 }
      this.rings.set(userId, ring)
    }
    ring.live += 1
    this.idle.delete(userId)
  }

  /** A connection of the user closed: with the last one the entry becomes idle and starts to age. */
  close(userId: string): void {
    const ring = this.rings.get(userId)
    if (!ring || ring.live === 0) return
    ring.live -= 1
    if (ring.live > 0) return
    this.idle.set(userId, performance.now())
    const max = this.opts.sse?.replayMaxIdleUsers ?? DEFAULT_REPLAY_MAX_IDLE_USERS
    for (const oldest of this.idle.keys()) {
      if (this.idle.size <= max) break
      this.drop(oldest)
    }
  }

  /**
   * Append an event to a user's ring buffer, evicting the oldest beyond the cap. A user with no
   * entry has had no connection here, so nothing would ever replay it, and it is not kept.
   */
  append(userId: string, event: MessageEvent): void {
    this.sweep()
    const ring = this.rings.get(userId)
    if (!ring) return
    ring.events.push(event)
    if (ring.events.length > (this.opts.sse?.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE)) {
      ring.events.shift()
    }
  }

  /**
   * Return the events emitted after `lastEventId`.
   *
   * Returns an empty array when the user has no buffer, or when `lastEventId` is
   * not present (a gap — the caller should fall back to `IOfflineQueueStorage`).
   */
  since(userId: string, lastEventId: string): MessageEvent[] {
    this.sweep()
    const events = this.rings.get(userId)?.events
    if (!events) return []
    const idx = events.findIndex((event) => event.id === lastEventId)
    if (idx === -1) return []
    return events.slice(idx + 1)
  }

  /** Number of events currently buffered for a user (diagnostics). */
  size(userId: string): number {
    this.sweep()
    return this.rings.get(userId)?.events.length ?? 0
  }

  /** Forget the idle entries that have aged past the TTL, oldest first. */
  private sweep(): void {
    const ttl = this.opts.sse?.replayTtlMs ?? DEFAULT_REPLAY_TTL_MS
    const now = performance.now()
    for (const [userId, closedAt] of this.idle) {
      if (now - closedAt < ttl) break
      this.drop(userId)
    }
  }

  private drop(userId: string): void {
    this.rings.delete(userId)
    this.idle.delete(userId)
  }
}
