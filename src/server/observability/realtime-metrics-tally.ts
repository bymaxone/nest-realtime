/**
 * @fileoverview The counts the transports keep for whoever publishes metrics, with every label set closed.
 * @layer services
 */
import { Injectable } from '@nestjs/common'

/** Why a handshake was refused. */
export const REFUSAL_REASONS = ['limit', 'unauthorized', 'unavailable', 'error'] as const

/** Why a connection was closed by the library or by a revocation. */
export const EVICTION_REASONS = ['per_user_cap', 'slow_consumer', 'revoked'] as const

/** The transports a count is kept for. */
export const TALLY_TRANSPORTS = ['sse', 'websocket'] as const

/** A reason a handshake is refused, one of `REFUSAL_REASONS`. */
export type RefusalReason = (typeof REFUSAL_REASONS)[number]
/** A reason a connection is closed, one of `EVICTION_REASONS`. */
export type EvictionReason = (typeof EVICTION_REASONS)[number]
/** A transport a count is kept for, one of `TALLY_TRANSPORTS`. */
export type TallyTransport = (typeof TALLY_TRANSPORTS)[number]

/** A zeroed count for each member of a closed set. */
function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

/**
 * Counts what the transports do, in plain numbers.
 *
 * It exists so that the code that does the work never imports a metrics library: an application that
 * publishes nothing pays for a few integer increments, and the optional `observability` subpath reads
 * these numbers when it is scraped. Each count is keyed by a closed set, so no label can grow with the
 * traffic, and nothing a client or a host supplied is ever a key.
 */
@Injectable()
export class RealtimeMetricsTally {
  readonly #refused = zeroed(REFUSAL_REASONS)
  readonly #evicted = zeroed(EVICTION_REASONS)
  readonly #emitted = zeroed(TALLY_TRANSPORTS)
  #slowConsumerDrops = 0
  #adapterPublishFailures = 0

  /** A handshake was refused for `reason`. */
  refused(reason: RefusalReason): void {
    this.#refused[reason] += 1
  }

  /** A connection was closed for `reason`. */
  evicted(reason: EvictionReason): void {
    this.#evicted[reason] += 1
  }

  /** An event was delivered through `transport` on this instance. */
  emitted(transport: TallyTransport): void {
    this.#emitted[transport] += 1
  }

  /** A connection was cut for not reading what it was sent. */
  slowConsumerDropped(): void {
    this.#slowConsumerDrops += 1
  }

  /** A publish of the Socket.IO Redis adapter was rejected. */
  adapterPublishFailed(): void {
    this.#adapterPublishFailures += 1
  }

  /** The counts so far, as copies. */
  snapshot(): {
    readonly refused: Readonly<Record<RefusalReason, number>>
    readonly evicted: Readonly<Record<EvictionReason, number>>
    readonly emitted: Readonly<Record<TallyTransport, number>>
    readonly slowConsumerDrops: number
    readonly adapterPublishFailures: number
  } {
    return {
      refused: { ...this.#refused },
      evicted: { ...this.#evicted },
      emitted: { ...this.#emitted },
      slowConsumerDrops: this.#slowConsumerDrops,
      adapterPublishFailures: this.#adapterPublishFailures,
    }
  }
}
