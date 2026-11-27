/**
 * @fileoverview Publishes what the transports counted to the application's metrics registry.
 * @layer observability
 *
 * An optional subpath: it names `@bymax-one/nest-core` and `prom-client`, which an application that
 * publishes no metrics never installs, so nothing outside `src/observability` may import it. The counts are
 * kept by `RealtimeMetricsTally` in the shared runtime, in plain numbers; this class only reads them.
 */
import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'
import { Inject, Injectable } from '@nestjs/common'
import { Counter, Gauge } from 'prom-client'
import {
  ConnectionRegistry,
  EVICTION_REASONS,
  REFUSAL_REASONS,
  RealtimeMetricsTally,
  TALLY_TRANSPORTS,
} from '@bymax-one/nest-realtime/internal'

/** A counter with one closed label, read from the tally on every scrape after a reset. */
function countedBy<K extends string>(
  registry: MetricsRegistry,
  spec: {
    readonly name: string
    readonly help: string
    readonly label: string
    readonly keys: readonly K[]
    readonly read: () => Readonly<Record<K, number>>
  },
): void {
  const { label, keys, read } = spec
  new Counter({
    name: spec.name,
    help: spec.help,
    labelNames: [label],
    registers: [registry],
    collect(): void {
      this.reset()
      const counts = read()
      for (const key of keys) this.inc({ [label]: key }, counts[key])
    },
  })
}

/** A counter with no label, read from the tally on every scrape after a reset. */
function total(
  registry: MetricsRegistry,
  spec: { readonly name: string; readonly help: string; readonly read: () => number },
): void {
  const { read } = spec
  new Counter({
    name: spec.name,
    help: spec.help,
    registers: [registry],
    collect(): void {
      this.reset()
      this.inc(read())
    },
  })
}

/**
 * Registers the realtime collectors on the registry the scrape endpoint serves.
 *
 * Every counter is read from the tally on each scrape, after a reset, instead of being written as events
 * arrive: the tally starts counting before this class runs, and a counter fed by events would drop that window.
 * Labels are the closed sets the tally is keyed by; no id, tenant, user or message ever becomes one.
 *
 * @example
 * // providers: [RealtimeMetrics]  (BymaxCoreModule discovers it and calls registerMetrics once at bootstrap)
 */
@BymaxMetricsContributor()
@Injectable()
export class RealtimeMetrics implements IMetricsContributor {
  constructor(
    @Inject(RealtimeMetricsTally) private readonly tally: RealtimeMetricsTally,
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
  ) {}

  /**
   * Register the collectors against the scrape registry.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    const { tally, connections } = this

    new Gauge({
      name: 'bymax_realtime_connections',
      help: 'Connections open on this instance now, by transport.',
      labelNames: ['transport'],
      registers: [registry],
      collect(): void {
        for (const transport of TALLY_TRANSPORTS) {
          this.set({ transport }, connections.allByTransport(transport).length)
        }
      },
    })
    countedBy(registry, {
      name: 'bymax_realtime_connections_refused_total',
      help: 'Handshakes refused since start, by reason: limit, unauthorized, unavailable or error.',
      label: 'reason',
      keys: REFUSAL_REASONS,
      read: () => tally.snapshot().refused,
    })
    countedBy(registry, {
      name: 'bymax_realtime_evictions_total',
      help: 'Connections closed since start, by reason: per_user_cap, slow_consumer or revoked.',
      label: 'reason',
      keys: EVICTION_REASONS,
      read: () => tally.snapshot().evicted,
    })
    countedBy(registry, {
      name: 'bymax_realtime_events_emitted_total',
      help: 'Emit calls handled on this instance since start, by transport, whether or not a connection received the event.',
      label: 'transport',
      keys: TALLY_TRANSPORTS,
      read: () => tally.snapshot().emitted,
    })
    total(registry, {
      name: 'bymax_realtime_slow_consumer_drops_total',
      help: 'Connections cut since start for not reading what they were sent.',
      read: () => tally.snapshot().slowConsumerDrops,
    })
    total(registry, {
      name: 'bymax_realtime_adapter_publish_failures_total',
      help: 'Publishes of the Socket.IO Redis adapter rejected since start.',
      read: () => tally.snapshot().adapterPublishFailures,
    })
  }
}
