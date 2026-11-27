/**
 * @fileoverview End-to-end test of a Redis adapter whose publishes are rejected.
 * @layer e2e
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import IORedisMock from 'ioredis-mock'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeMetricsTally } from '../../src/server/observability/realtime-metrics-tally'
import { RealtimeService } from '../../src/server/services/realtime.service'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

describe('WebSocket Redis adapter with rejected publishes (e2e)', () => {
  // Scenario: Redis rejects every publish, as an outage or an ACL does. Expected: emits and
  // revocations leave no unhandled rejection (Jest fails the test on one), and each is counted.
  it('survives rejected publishes on the emit and disconnect paths, counting each', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const pubClient = new IORedisMock()
    const publish = jest.fn(() => Promise.reject(new Error('NOPERM secret-host:6379')))
    Object.assign(pubClient, { publish })
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          websocket: { redisAdapter: { pubClient } },
        }),
      ],
    }).compile()
    const app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    try {
      const service = app.get(RealtimeService)
      await service.emitToUser('u1', 'notice', {})
      await service.broadcast('notice', {})
      await service.disconnect('unknown-connection')
      await service.disconnectUser('u1')
      await new Promise((resolve) => setImmediate(resolve))

      expect(publish.mock.calls.length).toBeGreaterThanOrEqual(4)
      expect(app.get(RealtimeMetricsTally).snapshot().adapterPublishFailures).toBe(
        publish.mock.calls.length,
      )
      const lines = warn.mock.calls
        .map(([line]) => line as { event?: string })
        .filter((line) => line.event === 'REALTIME_ADAPTER_PUBLISH_FAILED')
      expect(lines).toHaveLength(1)
      expect(JSON.stringify(lines)).not.toContain('secret-host')
      // The host's own client keeps its own publish.
      expect(pubClient.publish).toBe(publish)
    } finally {
      await app.close()
      jest.restoreAllMocks()
    }
  })
})
