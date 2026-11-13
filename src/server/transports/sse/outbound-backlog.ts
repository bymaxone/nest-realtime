/**
 * @fileoverview What an SSE connection has been sent but its client has not yet read.
 * @layer transport
 */

/** What the transport can read from a connection's response without owning it. */
export interface OutboundProbe {
  /** Bytes the socket has accepted so far; it only grows. */
  written(): number
  /** Bytes the response is holding while the client does not read. */
  buffered(): number
}

/** The bounds on a connection's backlog; `0` switches a bound off. */
export interface BacklogLimits {
  readonly maxBytes: number
  readonly maxEvents: number
}

/**
 * Bounds what one SSE connection may have queued behind a client that is slow to read.
 *
 * The response writes one event at a time and waits for the socket to drain before the next, so
 * everything behind that wait is held in server memory. Sizes are counted from the payload, which
 * is never more than what is written; a count that ran high would cut a client that is keeping up.
 * What the socket has accepted settles what was sent, so a client that reads is never cut however
 * much it receives in total.
 */
export class OutboundBacklog {
  /** Cumulative end offset of every event still queued, oldest first. */
  private ends: number[] = []
  private head = 0
  private sent = 0
  private readonly baseline: number

  constructor(
    private readonly limits: BacklogLimits,
    private readonly probe: OutboundProbe,
  ) {
    this.baseline = probe.written()
  }

  /** Bytes sent and not yet accepted by the socket. */
  get queuedBytes(): number {
    this.settle()
    return this.pendingBytes()
  }

  /** Offsets still held, settled ones included until the queue is compacted (diagnostics). */
  get retained(): number {
    return this.ends.length
  }

  /** Events sent and not yet accepted by the socket. */
  get queuedEvents(): number {
    this.settle()
    return this.ends.length - this.head
  }

  /**
   * Account for one more event of `size` bytes.
   *
   * @returns `false`, and counts nothing, when the event would take the backlog past a bound.
   */
  admit(size: number): boolean {
    this.settle()
    const { maxBytes, maxEvents } = this.limits
    const queued = this.ends.length - this.head
    // An event that is alone in the queue is always taken: one larger than the bound is not a
    // sign that the client is slow, and refusing it would make it undeliverable to anyone.
    if (maxBytes > 0 && queued > 0 && this.pendingBytes() + size > maxBytes) return false
    if (maxEvents > 0 && queued + 1 > maxEvents) return false
    this.sent += size
    this.ends.push(this.sent)
    return true
  }

  private pendingBytes(): number {
    return Math.max(0, this.sent - this.settledOffset())
  }

  private settledOffset(): number {
    return Math.max(0, this.probe.written() - this.baseline)
  }

  /** Drop the events the socket has taken, and compact the queue once the dead prefix grows. */
  private settle(): void {
    const settled = this.settledOffset()
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent — past the last offset `this.ends[this.head]` is `undefined`, and `undefined <= settled` is false, so the loop ends there whether or not the bound is tested
    while (this.head < this.ends.length && (this.ends[this.head] as number) <= settled) this.head++
    if (this.head > 1024 && this.head * 2 > this.ends.length) {
      this.ends = this.ends.slice(this.head)
      this.head = 0
    }
  }
}

/**
 * Tells a connection the client has stopped reading: the response holds bytes and the socket has
 * taken none of them for several checks in a row.
 */
export class StallWatch {
  private last = -1
  private stalledChecks = 0

  constructor(private readonly checks: number) {}

  /** @returns `true` once the connection has been stalled for the configured number of checks. */
  stalled(probe: OutboundProbe): boolean {
    if (this.checks <= 0) return false
    const written = probe.written()
    const stuck = probe.buffered() > 0 && written === this.last
    this.last = written
    this.stalledChecks = stuck ? this.stalledChecks + 1 : 0
    return this.stalledChecks >= this.checks
  }
}
