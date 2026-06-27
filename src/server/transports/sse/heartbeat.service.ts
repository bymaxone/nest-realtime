/**
 * @fileoverview Writes raw SSE keepalive comments to the response stream.
 * @layer transport
 */
import { Injectable } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'

/** The raw SSE comment line written as a keepalive (not a named event). */
const KEEPALIVE_COMMENT = ': keepalive\n\n'

/**
 * Minimum acceptable heartbeat interval in milliseconds.
 *
 * Five seconds is the practical floor — an interval shorter than this is likely
 * a misconfiguration and would generate unnecessary network traffic.
 */
const HEARTBEAT_MIN_MS = 5_000

/**
 * Maximum acceptable heartbeat interval in milliseconds.
 *
 * Ninety seconds is the safe ceiling: nginx defaults to a 60 s idle timeout and
 * Cloudflare caps at 100 s on free plans.  Staying at or below 90 s ensures
 * keepalives reach both before the proxy drops the connection.
 */
const HEARTBEAT_MAX_MS = 90_000

/** Minimal response surface the heartbeat needs — a writable text stream. */
export interface HeartbeatWritable {
  write(chunk: string): unknown
}

/**
 * Emits the SSE keepalive on an interval, per connection.
 *
 * The keepalive is a raw `: keepalive\n\n` comment written DIRECTLY to the response
 * stream — not a `MessageEvent`, not a named event, and outside the `Last-Event-ID`
 * id-space — so it never corrupts replay.  Comments keep proxies and load balancers
 * from idling out the connection.  Timers are tracked per connection and cleared on
 * `stop`.
 *
 * The configured interval must be within `[5_000, 90_000]` ms; values outside this
 * range throw a `REALTIME_INVALID_OPTIONS` error.
 *
 * See `docs/proxies-cheat-sheet.md` for nginx, Cloudflare, and AWS ALB configuration.
 */
@Injectable()
export class HeartbeatService {
  private readonly timers = new Map<string, NodeJS.Timeout>()

  /**
   * Start writing keepalives for a connection every `intervalMs`.
   *
   * @param connectionId - Unique connection identifier used to track the timer.
   * @param res - The writable response stream (or any object with a `write` method).
   * @param intervalMs - Keepalive interval in milliseconds; must be within
   *   `[5_000, 90_000]`.
   * @throws {Error} When `intervalMs` is outside the valid range.
   */
  start(connectionId: string, res: HeartbeatWritable, intervalMs: number): void {
    if (intervalMs < HEARTBEAT_MIN_MS || intervalMs > HEARTBEAT_MAX_MS) {
      throw new Error(
        `${REALTIME_ERROR_CODES.INVALID_OPTIONS}: heartbeatMs must be between ${HEARTBEAT_MIN_MS} and ${HEARTBEAT_MAX_MS} ms (got ${intervalMs})`,
      )
    }
    this.stop(connectionId)
    const timer = setInterval(() => {
      try {
        res.write(KEEPALIVE_COMMENT)
      } catch {
        // The response stream is already closed (client gone) — stop pinging it so
        // a write-after-close error in the timer never crashes the process.
        this.stop(connectionId)
      }
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
