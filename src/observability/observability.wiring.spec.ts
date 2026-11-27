/**
 * @fileoverview A host module can register the contributor and the indicator as plain providers.
 * @layer observability
 *
 * The realtime module is global and exports what they inject, so the host wires nothing else. Without the
 * tally in the exports, Nest fails the host's boot with an unresolved dependency.
 */
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'
import { BymaxRealtimeModule } from '../server/realtime.module'
import { RealtimeMetrics } from './realtime-metrics'
import { RealtimePubSubHealthIndicator } from './realtime-health'

@Module({ providers: [RealtimeMetrics, RealtimePubSubHealthIndicator] })
class HostModule {}

describe('observability providers in a host module', () => {
  it('resolve from what the realtime module exports', async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => null },
        }),
        HostModule,
      ],
    }).compile()
    const registry = new Registry()
    module.get(RealtimeMetrics).registerMetrics(registry)
    expect((await registry.getMetricsAsJSON()).length).toBe(6)
    await expect(module.get(RealtimePubSubHealthIndicator).check()).resolves.toEqual({
      status: 'up',
    })
    await module.close()
  })
})
