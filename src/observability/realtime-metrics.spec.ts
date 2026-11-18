/**
 * @fileoverview The metrics contributor publishes what the transports counted, with every label set closed.
 * @layer observability
 */
import { BYMAX_METRICS_CONTRIBUTOR_METADATA } from '@bymax-one/nest-core/metrics'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Registry } from 'prom-client'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import type { ConnectionRecord } from '../server/services/connection-registry.service'
import { RealtimeMetricsTally } from '../server/observability/realtime-metrics-tally'
import { RealtimeMetrics } from './realtime-metrics'

const SENTINEL = 'SENTINEL-user-42'

function record(connectionId: string, transport: 'sse' | 'websocket'): ConnectionRecord {
  return {
    connectionId,
    userId: SENTINEL,
    tenantId: SENTINEL,
    transport,
    connectedAt: new Date(0),
  } as unknown as ConnectionRecord
}

/** The samples of one metric, as `labels -> value`. */
async function samples(registry: Registry, name: string): Promise<Record<string, number>> {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name)
  const out: Record<string, number> = {}
  for (const { labels, value } of metric?.values ?? []) {
    out[
      Object.entries(labels)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')
    ] = value
  }
  return out
}

function build(): {
  registry: Registry
  tally: RealtimeMetricsTally
  connections: ConnectionRegistry
} {
  const registry = new Registry()
  const tally = new RealtimeMetricsTally()
  const connections = new ConnectionRegistry()
  new RealtimeMetrics(tally, connections).registerMetrics(registry)
  return { registry, tally, connections }
}

describe('RealtimeMetrics', () => {
  // Scenario: the class is discovered by nest-core through its marker. Expected: the marker is present.
  it('is marked as a metrics contributor', () => {
    expect(Reflect.getMetadata(BYMAX_METRICS_CONTRIBUTOR_METADATA, RealtimeMetrics)).toBe(true)
  })

  // Scenario: nothing has happened yet. Expected: every sample of every closed label set is 0, so a rate
  // is computable from the first scrape.
  it('publishes every closed label value at zero before anything happens', async () => {
    const { registry } = build()
    expect(await samples(registry, 'bymax_realtime_connections')).toEqual({
      'transport=sse': 0,
      'transport=websocket': 0,
    })
    expect(await samples(registry, 'bymax_realtime_connections_refused_total')).toEqual({
      'reason=limit': 0,
      'reason=unauthorized': 0,
      'reason=unavailable': 0,
    })
    expect(await samples(registry, 'bymax_realtime_evictions_total')).toEqual({
      'reason=per_user_cap': 0,
      'reason=slow_consumer': 0,
      'reason=revoked': 0,
    })
    expect(await samples(registry, 'bymax_realtime_events_emitted_total')).toEqual({
      'transport=sse': 0,
      'transport=websocket': 0,
    })
    expect(await samples(registry, 'bymax_realtime_slow_consumer_drops_total')).toEqual({ '': 0 })
  })

  // Scenario: connections open and close. Expected: the gauge reads the registry at scrape time.
  it('reads the connection gauge from the registry at each scrape', async () => {
    const { registry, connections } = build()
    connections.register(record('a', 'sse'))
    connections.register(record('b', 'sse'))
    connections.register(record('c', 'websocket'))
    expect(await samples(registry, 'bymax_realtime_connections')).toEqual({
      'transport=sse': 2,
      'transport=websocket': 1,
    })
    connections.unregister('a')
    expect(await samples(registry, 'bymax_realtime_connections')).toEqual({
      'transport=sse': 1,
      'transport=websocket': 1,
    })
  })

  // Scenario: the transports count. Expected: each counter shows its own count, once per scrape however
  // often it is scraped (a counter that added the tally to itself on every scrape would double).
  it('publishes each count once, however often it is scraped', async () => {
    const { registry, tally } = build()
    tally.refused('limit')
    tally.refused('limit')
    tally.refused('unauthorized')
    tally.evicted('per_user_cap')
    tally.evicted('revoked')
    tally.evicted('revoked')
    tally.emitted('sse')
    tally.emitted('websocket')
    tally.emitted('websocket')
    tally.slowConsumerDropped()
    for (let scrape = 0; scrape < 3; scrape++) {
      expect(await samples(registry, 'bymax_realtime_connections_refused_total')).toEqual({
        'reason=limit': 2,
        'reason=unauthorized': 1,
        'reason=unavailable': 0,
      })
      expect(await samples(registry, 'bymax_realtime_evictions_total')).toEqual({
        'reason=per_user_cap': 1,
        'reason=slow_consumer': 0,
        'reason=revoked': 2,
      })
      expect(await samples(registry, 'bymax_realtime_events_emitted_total')).toEqual({
        'transport=sse': 1,
        'transport=websocket': 2,
      })
      expect(await samples(registry, 'bymax_realtime_slow_consumer_drops_total')).toEqual({ '': 1 })
    }
  })

  // Scenario: a user and a tenant are connected. Expected: nothing that identifies them is in the scrape, and
  // every label name is one of the closed set.
  it('carries no identifier and only closed label names', async () => {
    const { registry, connections } = build()
    connections.register(record('a', 'sse'))
    const text = await registry.metrics()
    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain('connectionId')
    const labelNames = new Set(
      (await registry.getMetricsAsJSON()).flatMap((m) =>
        (m.values ?? []).flatMap((v) => Object.keys(v.labels)),
      ),
    )
    expect([...labelNames].sort()).toEqual(['reason', 'transport'])
  })

  // Scenario: every metric documents itself. Expected: a help text, and names that follow the standard.
  it('names and documents every metric', async () => {
    const { registry } = build()
    const all = await registry.getMetricsAsJSON()
    expect(all.map((m) => m.name).sort()).toEqual([
      'bymax_realtime_connections',
      'bymax_realtime_connections_refused_total',
      'bymax_realtime_events_emitted_total',
      'bymax_realtime_evictions_total',
      'bymax_realtime_slow_consumer_drops_total',
    ])
    for (const metric of all) expect(metric.help.length).toBeGreaterThan(10)

    // The README table lists each one, so an operator finds what a name means.
    const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')
    for (const metric of all) expect(readme).toContain(`\`${metric.name}\``)
  })
})
