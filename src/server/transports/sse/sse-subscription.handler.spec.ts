/**
 * @fileoverview Unit tests for SseSubscriptionHandler.
 * @layer transport
 */
import { Logger, UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { firstValueFrom, Subject } from 'rxjs'
import { take } from 'rxjs/operators'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import type { HeartbeatService } from './heartbeat.service'
import type { SseTransport } from './sse.transport'
import { SseSubscriptionHandler } from './sse-subscription.handler'

/** Collect the synchronous emissions (of/EMPTY) the stream produces on subscribe. */
function collect(stream: Observable<MessageEvent>): MessageEvent[] {
  const events: MessageEvent[] = []
  const sub = stream.subscribe((event) => events.push(event))
  sub.unsubscribe()
  return events
}

function mkRecord(id: string, userId: string, connectedAt?: Date): ConnectionRecord {
  return {
    connectionId: id,
    userId,
    tenantId: undefined,
    transport: 'sse',
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: connectedAt ?? new Date(),
    subject: new Subject(),
    close$: new Subject<void>(),
    originalAuth: { userId, tenantId: undefined, roles: undefined },
  }
}

function mkTransport(over: Partial<Record<string, unknown>> = {}): SseTransport {
  const defaultRecord = mkRecord('conn-1', 'u1')
  return {
    authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1' }),
    registerConnection: jest.fn().mockResolvedValue(undefined),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue([]),
    connectionsForUser: jest.fn().mockReturnValue([]),
    getConnection: jest.fn().mockReturnValue(defaultRecord),
    heartbeatMs: 30_000,
    emitConnectionEvent: true,
    ...over,
  } as unknown as SseTransport
}

function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn() } as unknown as HeartbeatService
}

function mkOptions(over: Partial<BymaxRealtimeModuleOptions> = {}): BymaxRealtimeModuleOptions {
  return {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    ...over,
  }
}

function mkReq(over: Partial<Record<string, unknown>> = {}): Request {
  return {
    headers: (over.headers as Request['headers']) ?? {},
    query: over.query ?? {},
    ip: over.ip,
  } as unknown as Request
}

function mkRes(): Response {
  return { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
}

function build(
  transport: SseTransport,
  heartbeat: HeartbeatService,
  options: BymaxRealtimeModuleOptions,
  hooks?: IConnectionLifecycleHooks,
): SseSubscriptionHandler {
  return new SseSubscriptionHandler(transport, heartbeat, options, hooks)
}

describe('SseSubscriptionHandler', () => {
  // Anti-buffering headers are set before any other processing.
  it('sets anti-buffering SSE headers', async () => {
    const transport = mkTransport()
    const res = mkRes()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), res)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform')
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no')
  })

  // A failed authentication throws 401 with the canonical error code.
  it('throws UnauthorizedException when authentication fails', async () => {
    const transport = mkTransport({ authenticate: jest.fn().mockResolvedValue(null) })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
  })

  // On success the stream starts with the connection:established event.
  it('emits connection:established first with the client-safe trait subset', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    const events = collect(stream)
    expect(events[0]?.type).toBe(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED)
    // Assert the EXACT data shape — connectionId + traits only; metadata must NOT be present.
    // If a future change leaks ip, userAgent, connectedAt, or other internal fields, this fails.
    expect(events[0]?.data).toEqual({
      connectionId: expect.any(String),
      traits: { userId: 'u1', tenantId: 't1', roles: undefined },
    })
  })

  // When the connection event is disabled, no established event is emitted.
  it('omits connection:established when emitConnectionEvent is false', async () => {
    const transport = mkTransport({ emitConnectionEvent: false })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    expect(collect(stream)).toEqual([])
  })

  // The heartbeat is started with the configured interval after registration resolves.
  it('starts the heartbeat with the configured interval', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const handler = build(transport, heartbeat, mkOptions({ sse: { heartbeatMs: 45_000 } }))
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    // Yield to the microtask queue so registerConnection's .then() runs.
    await Promise.resolve()
    sub.unsubscribe()
    expect(heartbeat.start).toHaveBeenCalledWith(expect.any(String), expect.anything(), 45_000)
  })

  // With no heartbeatMs option, the default 30 000 ms is used.
  it('uses the default heartbeat interval when sse.heartbeatMs is unset', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const handler = build(transport, heartbeat, mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(heartbeat.start).toHaveBeenCalledWith(expect.any(String), expect.anything(), 30_000)
  })

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

  // registerConnection is called with the correct parameters on subscribe.
  it('passes connection parameters to registerConnection', async () => {
    const transport = mkTransport()
    const req = mkReq({ ip: '1.2.3.4', headers: { 'user-agent': 'jest' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4', userAgent: 'jest' }),
    )
  })

  // The IP is resolved from X-Forwarded-For when present.
  it('resolves the IP from X-Forwarded-For', async () => {
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  // Without a forwarded header the request IP is used.
  it('falls back to req.ip when X-Forwarded-For is absent', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq({ ip: '9.9.9.9' }), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '9.9.9.9' }),
    )
  })

  // With neither source the IP resolves to 'unknown'.
  it('resolves IP to "unknown" when nothing is available', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: 'unknown' }),
    )
  })

  // The authorization header is stripped from the SSE auth context.
  it('strips the authorization header from the SSE context', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { authorization: 'Bearer secret', 'x-keep': 'yes' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as {
      headers: Record<string, string | undefined>
    }
    expect(context.headers['authorization']).toBeUndefined()
    expect(context.headers['x-keep']).toBe('yes')
  })

  // Cookies are parsed and passed in the auth context.
  it('parses cookies into the auth context', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { cookie: 'token=abc' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { cookies: Record<string, string> }
    expect(context.cookies).toEqual({ token: 'abc' })
  })

  // Query parameters are flattened to strings (array values become undefined).
  it('sanitizes query parameters to flat strings', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ query: { ticket: 'abc', multi: ['a', 'b'] } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { query: Record<string, string | undefined> }
    expect(context.query['ticket']).toBe('abc')
    expect(context.query['multi']).toBeUndefined()
  })

  // The tenantResolver overrides the auth tenantId when provided.
  it('applies tenantResolver to override the auth tenantId', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 'from-auth' }),
      getConnection: jest.fn().mockReturnValue(mkRecord('c1', 'u1')),
    })
    const tenantResolver = jest.fn().mockReturnValue('from-resolver')
    const handler = build(transport, mkHeartbeat(), mkOptions({ tenantResolver }))
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(tenantResolver).toHaveBeenCalled()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ tenantId: 'from-resolver' }) }),
    )
  })

  // When tenantResolver returns undefined, the auth tenantId is preserved.
  it('preserves auth.tenantId when tenantResolver returns undefined', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 'original' }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions({ tenantResolver: () => undefined }))
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ tenantId: 'original' }) }),
    )
  })

  // When there is no tenantId in auth and no resolver, tenantId is absent.
  it('omits tenantId when auth has none and tenantResolver is absent', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1' }),
      getConnection: jest.fn().mockReturnValue(mkRecord('c1', 'u1')),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    const call = (transport.registerConnection as jest.Mock).mock.calls[0]?.[0] as {
      auth: { tenantId?: string }
    }
    expect(call.auth.tenantId).toBeUndefined()
  })

  // onConnect hook is fired best-effort after registration resolves.
  it('fires onConnect best-effort after registration', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })

  // A throwing onConnect hook does not break the connection lifecycle.
  it('swallows a throwing onConnect hook', async () => {
    const onConnect = jest.fn().mockRejectedValue(new Error('hook boom'))
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(onConnect).toHaveBeenCalled()
  })

  // When getConnection returns undefined, onConnect is silently skipped.
  it('skips onConnect when getConnection returns undefined', async () => {
    const onConnect = jest.fn()
    const transport = mkTransport({ getConnection: jest.fn().mockReturnValue(undefined) })
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(onConnect).not.toHaveBeenCalled()
  })

  // Tearing down the stream stops the heartbeat and unregisters the connection.
  it('cleans up on unsubscribe (heartbeat stop + unregisterConnection)', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const handler = build(transport, heartbeat, mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    sub.unsubscribe()
    expect(heartbeat.stop).toHaveBeenCalledTimes(1)
    expect(transport.unregisterConnection).toHaveBeenCalledTimes(1)
  })

  // FIFO eviction is delegated to SseTransport.registerConnection — the handler itself
  // never calls transport.disconnect for eviction.
  it('delegates FIFO eviction to the transport via registerConnection (never calls disconnect directly)', async () => {
    const transport = mkTransport()
    const handler = build(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { maxConnectionsPerUser: 1 } }),
    )
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    // The handler must call registerConnection so the transport can enforce the cap.
    expect(transport.registerConnection).toHaveBeenCalledTimes(1)
    // The handler must NOT call disconnect — eviction is entirely the transport's responsibility.
    expect(transport.disconnect).not.toHaveBeenCalled()
  })

  // An error on the live subject is caught, the stream completes, and onError fires best-effort.
  it('swallows stream errors and fires onError hook best-effort (catchError coverage)', async () => {
    let capturedSubject: Subject<MessageEvent> | undefined
    const transport = mkTransport({
      registerConnection: jest
        .fn()
        .mockImplementation(async (params: { subject: Subject<MessageEvent> }) => {
          capturedSubject = params.subject
        }),
      emitConnectionEvent: false,
    })
    const onError = jest.fn()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onError })
    const stream$ = await handler.handle(mkReq(), mkRes())
    let completed = false
    stream$.subscribe({
      complete: () => {
        completed = true
      },
    })
    // Yield so registerConnection's async body runs and capturedSubject is assigned.
    await Promise.resolve()
    capturedSubject!.error(new Error('stream-error'))
    // catchError converts the error to EMPTY, completing the stream synchronously.
    expect(completed).toBe(true)
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }))
  })

  // Multi-valued headers are collapsed (array values yield undefined for single-value fields).
  it('ignores array-valued single headers (cookie, user-agent)', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate, emitConnectionEvent: false })
    const req = mkReq({
      headers: {
        cookie: ['a=1', 'b=2'],
        'user-agent': ['ua1', 'ua2'],
      },
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as {
      cookies: Record<string, string>
      userAgent: string | undefined
    }
    // Array cookie is ignored by singleHeader → parseCookieHeader receives ''
    expect(context.cookies).toEqual({})
    expect(context.userAgent).toBeUndefined()
  })

  // The handler works without hooks injected (hooks is @Optional).
  it('works when hooks is not provided', async () => {
    const transport = mkTransport()
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), undefined)
    await expect(handler.handle(mkReq(), mkRes())).resolves.toBeDefined()
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

  // When registerConnection rejects, onError fires best-effort and the stream errors
  // so the @Sse consumer receives a deterministic failure response.
  it('routes a registerConnection failure to onError and errors the stream', async () => {
    const regError = new Error('registration-failed')
    const transport = mkTransport({
      registerConnection: jest.fn().mockRejectedValue(regError),
      emitConnectionEvent: false,
    })
    const onError = jest.fn()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onError })
    const stream = await handler.handle(mkReq(), mkRes())
    const errors: unknown[] = []
    stream.subscribe({ error: (err) => errors.push(err) })
    // The rejected promise propagates through .then() then .catch(), requiring two
    // microtask hops before the catch handler (and subscriber.error) fires.
    await Promise.resolve()
    await Promise.resolve()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(regError)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: regError }))
  })

  // FINDING A: registration is async and can resolve AFTER the downstream subscriber has
  // already torn down. The late .then() must NOT fire onConnect or start a fresh heartbeat
  // (that would leak the connection + write after close); it must instead perform idempotent
  // late cleanup (heartbeat stop + unregister) so no registered connection is left behind.
  it('does not activate when registration resolves after unsubscribe (late cleanup only)', async () => {
    let resolveRegistration: () => void = () => undefined
    const registerConnection = jest.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRegistration = resolve
      }),
    )
    const onConnect = jest.fn()
    const heartbeat = mkHeartbeat()
    const transport = mkTransport({ registerConnection, emitConnectionEvent: false })
    const handler = build(transport, heartbeat, mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    // Client disconnects before registration completes: finalize() runs once.
    sub.unsubscribe()
    expect(heartbeat.stop).toHaveBeenCalledTimes(1)
    expect(transport.unregisterConnection).toHaveBeenCalledTimes(1)
    // Registration now resolves LATE — the .then() observes a closed subscriber.
    resolveRegistration()
    await Promise.resolve()
    await Promise.resolve()
    // No re-activation: onConnect never fires and no heartbeat is started.
    expect(onConnect).not.toHaveBeenCalled()
    expect(heartbeat.start).not.toHaveBeenCalled()
    // Late cleanup ran idempotently: stop + unregister fired a second time, nothing leaked.
    expect(heartbeat.stop).toHaveBeenCalledTimes(2)
    expect(transport.unregisterConnection).toHaveBeenCalledTimes(2)
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

  // When a lifecycle hook throws, fireHook logs a warn with the error message.
  // Kills BlockStatement and StringLiteral mutations on the logger.warn in fireHook.
  it('logs a warn when a lifecycle hook throws', async () => {
    const onConnect = jest.fn().mockRejectedValue(new Error('hook-crash'))
    const transport = mkTransport()
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
      const stream = await handler.handle(mkReq(), mkRes())
      const sub = stream.subscribe()
      await Promise.resolve()
      await Promise.resolve()
      sub.unsubscribe()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hook-crash'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  // onConnect receives the full connection metadata including transport type.
  // Kills mutations to transport: 'sse', ip, and connectedAt in buildMeta.
  it('passes full metadata including transport sse to the onConnect hook', async () => {
    const onConnect = jest.fn()
    const record = mkRecord('conn-1', 'u1')
    const transport = mkTransport({
      getConnection: jest.fn().mockReturnValue(record),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    const meta = (onConnect as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>
    expect(meta['transport']).toBe('sse')
    expect(meta['connectionId']).toBe('conn-1')
    expect(meta['ip']).toBe('127.0.0.1')
    expect(meta['connectedAt']).toBeInstanceOf(Date)
  })

  // onError receives transport: 'sse' when the stream errors.
  // Kills StringLiteral mutations on 'sse' in the onError call arguments.
  it('passes transport sse to the onError hook when the stream errors', async () => {
    let capturedSubject: Subject<MessageEvent> | undefined
    const transport = mkTransport({
      registerConnection: jest
        .fn()
        .mockImplementation(async (params: { subject: Subject<MessageEvent> }) => {
          capturedSubject = params.subject
        }),
      emitConnectionEvent: false,
    })
    const onError = jest.fn()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onError })
    const stream$ = await handler.handle(mkReq(), mkRes())
    stream$.subscribe()
    await Promise.resolve()
    capturedSubject!.error(new Error('stream-error'))
    await Promise.resolve()
    const ctx = (onError as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>
    expect(ctx['transport']).toBe('sse')
  })

  // onError receives transport: 'sse' when registerConnection rejects.
  // Kills StringLiteral mutations on 'sse' in the activateConnection onError call.
  it('passes transport sse to onError when registerConnection rejects', async () => {
    const transport = mkTransport({
      registerConnection: jest.fn().mockRejectedValue(new Error('reg-fail')),
      emitConnectionEvent: false,
    })
    const onError = jest.fn()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onError })
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe({ error: () => undefined })
    await Promise.resolve()
    await Promise.resolve()
    const ctx = (onError as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>
    expect(ctx['transport']).toBe('sse')
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

  it('trims whitespace from the X-Forwarded-For candidate before using it as the IP', async () => {
    // Without trim(), " 1.2.3.4 " leaks as-is into the connection ip.
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  it('joins array-valued headers with a comma separator in the auth context', async () => {
    // Kills StringLiteral mutation that changes join(',') to join('').
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { 'x-multi': ['part-a', 'part-b'] as unknown as string } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { headers: Record<string, string> }
    expect(context.headers['x-multi']).toBe('part-a,part-b')
  })

  it('sets transport to "sse" in the auth context passed to authenticate', async () => {
    // Kills StringLiteral mutation that blanks out the transport field.
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { transport: string }
    expect(context.transport).toBe('sse')
  })
})
