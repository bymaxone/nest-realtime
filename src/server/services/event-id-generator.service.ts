/**
 * @fileoverview Monotonic, lexicographically sortable event-id generator.
 * @layer infrastructure
 */
import { Injectable } from '@nestjs/common'

/** Width of the zero-padded counter component of an event id. */
const COUNTER_WIDTH = 6

/**
 * Generates monotonically increasing event ids of the form
 * `{epochMillis}-{counter}`, where the counter resets every millisecond.
 *
 * Guarantees:
 * - Lexicographically sortable (the counter is zero-padded to a fixed width), so
 *   `Last-Event-ID` replay can string-compare ids.
 * - Monotonic within a single instance even when called repeatedly at the same
 *   epoch millisecond.
 *
 * @example
 * ```ts
 * gen.next() // → '1717000000000-000001'
 * gen.next() // → '1717000000000-000002'
 * ```
 */
@Injectable()
export class EventIdGenerator {
  private lastMs = 0
  private counter = 0

  /** Produce the next monotonic event id. */
  next(): string {
    const now = Date.now()
    if (now === this.lastMs) {
      this.counter += 1
    } else {
      this.lastMs = now
      this.counter = 1
    }
    return `${now}-${String(this.counter).padStart(COUNTER_WIDTH, '0')}`
  }
}
