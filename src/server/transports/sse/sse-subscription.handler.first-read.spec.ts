/**
 * @fileoverview What the guard hands the route when a reconnect has nothing to ask the offline queue.
 * @layer transport
 */
import {
  build,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  mkTransport,
} from '../../../../test/fixtures/sse/subscription-harness'

describe('SseSubscriptionHandler: the first read of a reconnect with no queue to ask', () => {
  // Scenario: no Last-Event-ID, so the queue is not asked. Expected: the first read the guard keeps for the route is an
  // empty gap that is not marked degraded, since that mark means the store failed.
  it('is an empty gap that is not degraded', async () => {
    const handler = build(mkTransport({ emitConnectionEvent: false }), mkHeartbeat(), mkOptions())
    const req = mkReq()
    await handler.authenticateBeforeCommit(req, mkRes())

    expect(handler['authenticated'].get(req)?.queueRead).toEqual({ events: [], degraded: false })
  })
})
