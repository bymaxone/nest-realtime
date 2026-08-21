/**
 * @fileoverview Unit tests for SseSubscriptionHandler — replay and the offline queue.
 * @layer transport
 *
 * Covers `Last-Event-ID` replay, offline-queue delivery and acknowledgement, and the
 * ordering guarantees between queued, replayed and live events.
 *
 * Shared builders live in `test/fixtures/sse/subscription-harness.ts` — the suite is
 * split by area and every part needs the same fakes.
 */
import type { MessageEvent } from '@nestjs/common'
import type { Subject } from 'rxjs'
import { firstValueFrom } from 'rxjs'
import { take } from 'rxjs/operators'
import type { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import {
  collect,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'
import { SseSubscriptionHandler } from './sse-subscription.handler'

describe('SseSubscriptionHandler — replay and offline queue', () => {
  // A Last-Event-ID replays the buffered events after that id.
  it('replays buffered events when Last-Event-ID is present', async () => {
    const replayed: MessageEvent = { id: 'e2', type: 'evt', data: { n: 2 } }
    const transport = mkTransport({
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([replayed]),
    })
    const req = mkReq({ headers: { 'last-event-id': 'e1' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    expect(collect(stream)).toEqual([replayed])
    expect(transport.getReplayEvents).toHaveBeenCalledWith('u1', 'e1')
  })

  // An absent Last-Event-ID yields no replay.
  it('does not replay when Last-Event-ID is absent', async () => {
    const transport = mkTransport({ emitConnectionEvent: false })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    expect(collect(stream)).toEqual([])
    expect(transport.getReplayEvents).not.toHaveBeenCalled()
  })

  // A Last-Event-ID with no buffered events yields an empty replay stream.
  it('emits nothing extra when the replay buffer has no events for Last-Event-ID', async () => {
    const transport = mkTransport({
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([]),
    })
    const req = mkReq({ headers: { 'last-event-id': 'e1' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    expect(collect(stream)).toEqual([])
  })

  // An array-valued last-event-id header is ignored (single-header coercion).
  it('ignores array-valued last-event-id header', async () => {
    const transport = mkTransport({ emitConnectionEvent: false })
    const req = mkReq({ headers: { 'last-event-id': ['e1', 'e2'] } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    expect(transport.getReplayEvents).not.toHaveBeenCalled()
  })

  // Offline queue events are mapped to MessageEvents and emitted after ring-buffer replay.
  it('emits offline queue events as MessageEvents when Last-Event-ID is set', async () => {
    const transport = mkTransport({ getReplayEvents: jest.fn().mockReturnValue([]) })
    const offlineDelivery = {
      retrieve: jest
        .fn()
        .mockResolvedValue([{ id: 'q1', event: 'queued', data: { x: 1 }, emittedAt: new Date() }]),
      acknowledge: jest.fn().mockResolvedValue(undefined),
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    const events = collect(stream)
    const queued = events.filter((e) => e.id === 'q1')
    expect(queued).toHaveLength(1)
    expect(queued[0]?.type).toBe('queued')
    expect(queued[0]?.data).toEqual({ x: 1 })
  })

  // With the subscribe-before-register structure, subject already has a listener before
  // registerConnection runs. Any subject.next() inside registerConnection goes directly
  // to the subscriber — nothing is dropped or buffered.
  it('does not drop a live event emitted inside registerConnection (subscribe-before-register guarantee)', async () => {
    const liveEvent: MessageEvent = { id: 'live-1', type: 'live', data: { v: 1 } }
    const transport = mkTransport({
      registerConnection: jest
        .fn()
        .mockImplementation(async (params: { subject: Subject<MessageEvent> }) => {
          // Simulate a concurrent emit arriving the instant registration completes.
          params.subject.next(liveEvent)
        }),
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([]),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    const events: MessageEvent[] = []
    const sub = stream.subscribe((e) => events.push(e))
    // Yield to the microtask queue so registerConnection's async body runs.
    await Promise.resolve()
    sub.unsubscribe()
    expect(events).toContainEqual(liveEvent)
  })

  // Offline queue events must appear before live events in the stream regardless of
  // when the concurrent live emit arrives (ordering invariant).
  it('delivers offline queue events before live events that race registration (ordering invariant)', async () => {
    const liveEvent: MessageEvent = { id: 'live-1', type: 'live', data: { v: 1 } }
    const transport = mkTransport({
      registerConnection: jest
        .fn()
        .mockImplementation(async (params: { subject: Subject<MessageEvent> }) => {
          // Racing live event arrives the moment registration completes.
          params.subject.next(liveEvent)
        }),
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([]),
    })
    const offlineDelivery = {
      retrieve: jest
        .fn()
        .mockResolvedValue([
          { id: 'off-1', event: 'offline', data: { q: 1 }, emittedAt: new Date() },
        ]),
      acknowledge: jest.fn().mockResolvedValue(undefined),
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    const events: MessageEvent[] = []
    const sub = stream.subscribe((e) => events.push(e))
    // Yield to the microtask queue so registerConnection's async body runs.
    await Promise.resolve()
    sub.unsubscribe()
    expect(events).toHaveLength(2)
    // Offline (queue) event must precede the racing live event.
    expect(events[0]?.type).toBe('offline')
    expect(events[1]?.type).toBe('live')
  })

  // A replay event with no id falls back to '' in the ringBufferIds set (id ?? '' branch).
  it('handles replay events with undefined id when building ringBufferIds', async () => {
    // A MessageEvent without id covers the `e.id ?? ''` fallback branch.
    const replayEvent: MessageEvent = { type: 'x', data: {} }
    const transport = mkTransport({
      getReplayEvents: jest.fn().mockReturnValue([replayEvent]),
      emitConnectionEvent: false,
    })
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    const events = collect(stream)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('x')
  })

  // Kills L194 StringLiteral: `e.id ?? ''` → `e.id ?? "Stryker was here!"`.
  // The ringBufferIds Set is passed as 3rd arg to retrieve; undefined ids must fall back to ''.
  it('passes empty-string fallback in ringBufferIds when a replay event has no id', async () => {
    const replayEvent: MessageEvent = { type: 'x', data: {} }
    const retrieveMock = jest.fn().mockResolvedValue([])
    const transport = mkTransport({
      getReplayEvents: jest.fn().mockReturnValue([replayEvent]),
      emitConnectionEvent: false,
    })
    const offlineDelivery = {
      retrieve: retrieveMock,
      acknowledge: jest.fn().mockResolvedValue(undefined),
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    collect(stream)
    expect(retrieveMock).toHaveBeenCalledWith('u1', '0', expect.any(Set))
    const ids = retrieveMock.mock.calls[0]?.[2] as Set<string>
    expect(ids.has('')).toBe(true)
  })

  // Kills L237 ConditionalExpression (`true`) and L237 EqualityOperator (`>= 0`).
  // With empty queueEvents (retrieve returns []), acknowledge must NOT be called.
  it('does not acknowledge the offline queue when queueEvents is empty (retrieve returns [])', async () => {
    const acknowledge = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport({
      getReplayEvents: jest.fn().mockReturnValue([]),
      emitConnectionEvent: false,
    })
    const offlineDelivery = {
      retrieve: jest.fn().mockResolvedValue([]),
      acknowledge,
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    const sub = stream.subscribe()
    sub.unsubscribe()
    expect(acknowledge).not.toHaveBeenCalled()
  })

  // FINDING B: the offline queue is acknowledged exactly once, AFTER the gap events have
  // been emitted to an open subscriber — retrieve no longer prunes the durable queue.
  it('acknowledges the offline queue exactly once after emission to an open subscriber', async () => {
    const queued = { id: 'q1', event: 'queued', data: { x: 1 }, emittedAt: new Date() }
    const acknowledge = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport({ getReplayEvents: jest.fn().mockReturnValue([]) })
    const offlineDelivery = {
      retrieve: jest.fn().mockResolvedValue([queued]),
      acknowledge,
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    const events: MessageEvent[] = []
    const sub = stream.subscribe((e) => events.push(e))
    // The queue event emitted synchronously on subscribe — ack must follow that emission.
    expect(events.map((e) => e.id)).toContain('q1')
    expect(acknowledge).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledWith('u1', [queued])
    sub.unsubscribe()
  })

  // FINDING B: when the stream is never subscribed (client disconnects before subscribing),
  // the durable queue must NOT be acknowledged — the events stay durable for redelivery.
  it('does not acknowledge the offline queue when the stream is never subscribed', async () => {
    const acknowledge = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport({ getReplayEvents: jest.fn().mockReturnValue([]) })
    const offlineDelivery = {
      retrieve: jest
        .fn()
        .mockResolvedValue([{ id: 'q1', event: 'queued', data: {}, emittedAt: new Date() }]),
      acknowledge,
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    expect(acknowledge).not.toHaveBeenCalled()
  })

  // When offlineDelivery is configured but Last-Event-ID is absent, retrieve must NOT be called.
  // Kills the && → || mutation in the queueEvents ternary condition.
  it('does not call retrieve when offlineDelivery is configured but Last-Event-ID is absent', async () => {
    const retrieve = jest.fn().mockResolvedValue([])
    const offlineDelivery = {
      retrieve,
      acknowledge: jest.fn().mockResolvedValue(undefined),
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      mkTransport({ emitConnectionEvent: false }),
      mkHeartbeat(),
      mkOptions(),
      undefined,
      offlineDelivery,
    )
    await handler.handle(mkReq(), mkRes())
    expect(retrieve).not.toHaveBeenCalled()
  })

  // FINDING B: a subscriber that closes DURING emission (take(1)) leaves the subscriber
  // closed at the ack check, so the queue is left durable rather than acknowledged.
  it('does not acknowledge when the subscriber closes during emission', async () => {
    const acknowledge = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport({
      getReplayEvents: jest.fn().mockReturnValue([]),
      emitConnectionEvent: false,
    })
    const offlineDelivery = {
      retrieve: jest
        .fn()
        .mockResolvedValue([{ id: 'q1', event: 'queued', data: {}, emittedAt: new Date() }]),
      acknowledge,
    } as unknown as OfflineQueueDeliveryService
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { emitConnectionEvent: false } }),
      undefined,
      offlineDelivery,
    )
    const stream = await handler.handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
    // take(1) completes and closes the subscriber the instant the first event is emitted.
    const first = await firstValueFrom(stream.pipe(take(1)))
    expect(first.id).toBe('q1')
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
