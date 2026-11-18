/**
 * @fileoverview The SSE transport counts what it does in the tally, once for each thing, with closed reasons.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { build } from '../../../../test/fixtures/sse/transport-harness'
import { RealtimeMetricsTally } from '../../observability/realtime-metrics-tally'
import type { OutboundProbe } from './outbound-backlog'

const stuck: OutboundProbe = { written: () => 0, buffered: () => 10 }

describe('SseTransport counts in the tally', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  async function register(
    transport: ReturnType<typeof build>['transport'],
    connectionId: string,
    userId = 'u1',
    outbound?: OutboundProbe,
  ): Promise<MessageEvent[]> {
    const received: MessageEvent[] = []
    const subject = new Subject<MessageEvent>()
    subject.subscribe((event) => received.push(event))
    await transport.registerConnection({
      connectionId,
      auth: { userId },
      subject,
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: undefined,
      outbound,
    })
    return received
  }

  // Scenario: a user opens a second connection past `maxConnectionsPerUser`. Expected: one eviction for
  // the per-user cap, and no other reason moves.
  it('counts an eviction for the per-user cap', async () => {
    const tally = new RealtimeMetricsTally()
    const { transport } = build({ sse: { maxConnectionsPerUser: 1 }, tally })
    await register(transport, 'a')
    await register(transport, 'b')
    expect(tally.snapshot().evicted).toEqual({ per_user_cap: 1, slow_consumer: 0, revoked: 0 })
  })

  // Scenario: a client does not read and the bound is crossed. Expected: one slow-consumer eviction and one drop.
  it('counts a slow consumer as an eviction and as a drop', async () => {
    const tally = new RealtimeMetricsTally()
    const { transport } = build({ sse: { maxQueuedEvents: 1 }, tally })
    await register(transport, 'slow', 'u1', stuck)
    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToUser('u1', 'e', 2)
    const snapshot = tally.snapshot()
    expect(snapshot.evicted).toEqual({ per_user_cap: 0, slow_consumer: 1, revoked: 0 })
    expect(snapshot.slowConsumerDrops).toBe(1)
  })

  // Scenario: a revocation through disconnect(), for a connection held here and for one held elsewhere.
  // Expected: one revocation each, counted once the close or the publish has succeeded.
  it('counts a revocation for a local connection and for one handed to the bus', async () => {
    const tally = new RealtimeMetricsTally()
    const { transport, publish } = build({ tally })
    await register(transport, 'here')
    await transport.disconnect('here', 'REVOKED')
    await transport.disconnect('elsewhere', 'REVOKED')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(tally.snapshot().evicted.revoked).toBe(2)
  })

  // Scenario: the bus refuses the revocation. Expected: it is not counted, because nothing was closed.
  it('does not count a revocation the bus refused', async () => {
    const tally = new RealtimeMetricsTally()
    const { transport, publish } = build({ tally })
    publish.mockRejectedValueOnce(new Error('down'))
    await expect(transport.disconnect('elsewhere')).rejects.toThrow()
    expect(tally.snapshot().evicted.revoked).toBe(0)
  })

  // Scenario: events delivered by each way in. Expected: one count for each delivery on this instance, including
  // the ones a subscriber re-emits from another instance, and none for a connection that is not there.
  it('counts each delivery once, whichever way in', async () => {
    const tally = new RealtimeMetricsTally()
    const { transport } = build({ tally })
    await register(transport, 'a')
    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToTenant('t1', 'e', 1)
    await transport.emitToRoom('room', 'e', 1)
    await transport.broadcast('e', 1)
    transport.emitToUserLocal('u1', 'e', 1, 'id-1')
    transport.emitToTenantLocal('t1', 'e', 1, 'id-2')
    transport.emitToRoomLocal('room', 'e', 1, 'id-3')
    transport.broadcastLocal('e', 1, 'id-4')
    expect(tally.snapshot().emitted).toEqual({ sse: 8, websocket: 0 })
  })

  // Scenario: no tally is wired, as when the transport is built by hand. Expected: nothing throws.
  it('works without a tally', async () => {
    const { transport } = build({ sse: { maxConnectionsPerUser: 1 } })
    await register(transport, 'a')
    await register(transport, 'b')
    await expect(transport.emitToUser('u1', 'e', 1)).resolves.toBeUndefined()
  })
})
