/**
 * @fileoverview A revocation through `RealtimeService.disconnect` is counted once, after the transport has acted on it.
 * @layer services
 */
import { RealtimeMetricsTally } from '../observability/realtime-metrics-tally'
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeService } from './realtime.service'

describe('RealtimeService.disconnect', () => {
  // Scenario: the transport closes the connection, or hands the revocation to the bus. Expected: one revocation
  // for the call, whatever the transport did inside it.
  it('counts one revocation once the transport has resolved', async () => {
    const tally = new RealtimeMetricsTally()
    const disconnect = jest.fn().mockResolvedValue(undefined)
    const service = new RealtimeService({ disconnect } as unknown as ITransport, undefined, tally)
    await service.disconnect('c1', 'REVOKED')
    expect(disconnect).toHaveBeenCalledWith('c1', 'REVOKED')
    expect(tally.snapshot().evicted.revoked).toBe(1)
  })

  // Scenario: the transport refuses. Expected: the rejection reaches the caller and nothing is counted, because
  // the connection may still be open.
  it('counts nothing when the transport rejects', async () => {
    const tally = new RealtimeMetricsTally()
    const service = new RealtimeService(
      { disconnect: jest.fn().mockRejectedValue(new Error('down')) } as unknown as ITransport,
      undefined,
      tally,
    )
    await expect(service.disconnect('c1')).rejects.toThrow('down')
    expect(tally.snapshot().evicted.revoked).toBe(0)
  })

  // Scenario: no tally is wired. Expected: the call works.
  it('works without a tally', async () => {
    const service = new RealtimeService({
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as unknown as ITransport)
    await expect(service.disconnect('c1')).resolves.toBeUndefined()
  })
})
