/**
 * @fileoverview Writes raw SSE keepalive comments to the response stream.
 * @layer transport
 */
import { Injectable } from '@nestjs/common'

/** The raw SSE comment line written as a keepalive (not a named event). */
const KEEPALIVE_COMMENT = ': keepalive\n\n'

/** Minimal response surface the heartbeat needs — a writable text stream. */
export interface HeartbeatWritable {
  write(chunk: string): unknown
}

/**
 * Emits the SSE keepalive on an interval, per connection.
 *
 * The keepalive is a raw `: keepalive\n\n` comment written DIRECTLY to the response
 * stream — not a `MessageEvent`, not a named event, and outside the `Last-Event-ID`
 * id-space — so it never corrupts replay. Comments keep proxies and load balancers
 * from idling out the connection. Timers are tracked per connection and cleared on
 * `stop`.
 */
@Injectable()
export class HeartbeatService {
  private readonly timers = new Map<string, NodeJS.Timeout>()

  /** Start writing keepalives for a connection every `intervalMs`. */
  start(connectionId: string, res: HeartbeatWritable, intervalMs: number): void {
    this.stop(connectionId)
    const timer = setInterval(() => {
      res.write(KEEPALIVE_COMMENT)
    }, intervalMs)
    // Do not let a keepalive timer keep the process alive on its own.
    timer.unref()
    this.timers.set(connectionId, timer)
  }

  /** Stop and clear the keepalive timer for a connection (idempotent). */
  stop(connectionId: string): void {
    const timer = this.timers.get(connectionId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(connectionId)
    }
  }

  /** Stop every keepalive timer (used on shutdown). */
  stopAll(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }
}
