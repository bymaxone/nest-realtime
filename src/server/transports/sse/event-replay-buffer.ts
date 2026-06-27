/**
 * @fileoverview Per-user in-memory ring buffer for Last-Event-ID replay.
 * @layer transport
 */
import { Inject, Injectable } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'

/** Default ring-buffer capacity when `sse.replayBufferSize` is unset. */
const DEFAULT_REPLAY_BUFFER_SIZE = 100

/**
 * Per-user ring buffer of recent events for `Last-Event-ID` replay.
 *
 * In-memory by design — it survives only as long as the process. Per-user buffers
 * prevent one user from poisoning another's replay state. For durable replay
 * (instance restart, or a gap larger than the buffer), a consumer can plug
 * `IOfflineQueueStorage` as a fallback.
 *
 * @example
 * ```ts
 * // On reconnect with `Last-Event-ID: <id>`, replay what was missed:
 * const missed = replayBuffer.since(userId, lastEventId)
 * ```
 */
@Injectable()
export class EventReplayBuffer {
  private readonly buffers = new Map<string, MessageEvent[]>()

  constructor(
    @Inject(REALTIME_OPTIONS_TOKEN)
    private readonly opts: BymaxRealtimeModuleOptions,
  ) {}

  /** Append an event to a user's ring buffer, evicting the oldest beyond the cap. */
  append(userId: string, event: MessageEvent): void {
    const buf = this.buffers.get(userId) ?? []
    buf.push(event)
    const cap = this.opts.sse?.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE
    if (buf.length > cap) buf.shift()
    this.buffers.set(userId, buf)
  }

  /**
   * Return the events emitted after `lastEventId`.
   *
   * Returns an empty array when the user has no buffer, or when `lastEventId` is
   * not present (a gap — the caller should fall back to `IOfflineQueueStorage`).
   */
  since(userId: string, lastEventId: string): MessageEvent[] {
    const buf = this.buffers.get(userId)
    if (!buf) return []
    const idx = buf.findIndex((event) => event.id === lastEventId)
    if (idx === -1) return []
    return buf.slice(idx + 1)
  }

  /** Number of events currently buffered for a user (diagnostics). */
  size(userId: string): number {
    return this.buffers.get(userId)?.length ?? 0
  }
}
