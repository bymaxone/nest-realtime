/**
 * @fileoverview The events a reconnect missed are read as late as the route allows: whatever the
 * application runs between the guard and the handler cannot leave an event out.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import {
  collect,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'

describe('SseSubscriptionHandler: the ring buffer is read when the stream is built', () => {
  // An interceptor that awaits before it calls the handler leaves time between the guard and the
  // route; an event emitted then is in the ring, and the connection is not registered to get it live.
  it('replays an event that was emitted between the guard and the handler', async () => {
    const ring: MessageEvent[] = [{ id: 'e1', type: 'evt', data: {} }]
    const transport = mkTransport({
      emitConnectionEvent: false,
      getReplayEvents: jest.fn(() => [...ring]),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const req = mkReq({ headers: { 'last-event-id': 'e0' } })
    const res = mkRes()
    await handler.authenticateBeforeCommit(req, res)

    ring.push({ id: 'e2', type: 'evt', data: {} })
    const stream = await handler.handle(req, res)

    expect(collect(stream).map((event) => event.id)).toEqual(['e1', 'e2'])
  })

  it('reads the ring once, when the stream is built, not in the guard', async () => {
    const getReplayEvents = jest.fn().mockReturnValue([])
    const handler = build(
      mkTransport({ emitConnectionEvent: false, getReplayEvents }),
      mkHeartbeat(),
      mkOptions(),
    )
    const req = mkReq({ headers: { 'last-event-id': 'e0' } })
    const res = mkRes()

    await handler.authenticateBeforeCommit(req, res)
    expect(getReplayEvents).not.toHaveBeenCalled()
    await handler.handle(req, res)

    expect(getReplayEvents).toHaveBeenCalledTimes(1)
  })
})
