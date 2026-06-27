/**
 * @fileoverview Unit tests for SseSubscriptionHandler.
 * @layer transport
 */
import { UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { Subject } from 'rxjs'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
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

  // The heartbeat is started with the configured interval.
  it('starts the heartbeat with the configured interval', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const handler = build(transport, heartbeat, mkOptions({ sse: { heartbeatMs: 45_000 } }))
    await handler.handle(mkReq(), mkRes())
    expect(heartbeat.start).toHaveBeenCalledWith(expect.any(String), expect.anything(), 45_000)
  })

  // With no heartbeatMs option, the default 30 000 ms is used.
  it('uses the default heartbeat interval when sse.heartbeatMs is unset', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const handler = build(transport, heartbeat, mkOptions())
    await handler.handle(mkReq(), mkRes())
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

  // registerConnection is called with the correct parameters.
  it('passes connection parameters to registerConnection', async () => {
    const transport = mkTransport()
    const req = mkReq({ ip: '1.2.3.4', headers: { 'user-agent': 'jest' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4', userAgent: 'jest' }),
    )
  })

  // The IP is resolved from X-Forwarded-For when present.
  it('resolves the IP from X-Forwarded-For', async () => {
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  // Without a forwarded header the request IP is used.
  it('falls back to req.ip when X-Forwarded-For is absent', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq({ ip: '9.9.9.9' }), mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '9.9.9.9' }),
    )
  })

  // With neither source the IP resolves to 'unknown'.
  it('resolves IP to "unknown" when nothing is available', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), mkRes())
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
    await handler.handle(mkReq(), mkRes())
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
    await handler.handle(mkReq(), mkRes())
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
    await handler.handle(mkReq(), mkRes())
    const call = (transport.registerConnection as jest.Mock).mock.calls[0]?.[0] as {
      auth: { tenantId?: string }
    }
    expect(call.auth.tenantId).toBeUndefined()
  })

  // onConnect hook is fired best-effort after registration when the connection record exists.
  it('fires onConnect best-effort after registration', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    await handler.handle(mkReq(), mkRes())
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })

  // A throwing onConnect hook does not break the connection lifecycle.
  it('swallows a throwing onConnect hook', async () => {
    const onConnect = jest.fn().mockRejectedValue(new Error('hook boom'))
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    await expect(handler.handle(mkReq(), mkRes())).resolves.toBeDefined()
  })

  // When getConnection returns undefined, onConnect is silently skipped.
  it('skips onConnect when getConnection returns undefined', async () => {
    const onConnect = jest.fn()
    const transport = mkTransport({ getConnection: jest.fn().mockReturnValue(undefined) })
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    await handler.handle(mkReq(), mkRes())
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

  // FIFO eviction removes exactly one connection when the cap is at its limit (max=2, 2 exist).
  it('evicts the oldest connection when maxConnectionsPerUser is reached', async () => {
    const old1 = mkRecord('c1', 'u1', new Date(1_000))
    const old2 = mkRecord('c2', 'u1', new Date(2_000))
    const transport = mkTransport({
      connectionsForUser: jest.fn().mockReturnValue([old1, old2]),
    })
    const handler = build(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { maxConnectionsPerUser: 2 } }),
    )
    await handler.handle(mkReq(), mkRes())
    // max=2, existing=[c1, c2] → length(2) >= max(2) → evict c1 → length(1) < max(2) → stop
    expect(transport.disconnect).toHaveBeenCalledTimes(1)
    expect(transport.disconnect).toHaveBeenCalledWith('c1', 'REALTIME_TOO_MANY_CONNECTIONS')
  })

  // FIFO eviction removes two connections when the cap is exceeded by two (max=1, 2 exist).
  it('evicts multiple connections until the count is below the cap', async () => {
    const old1 = mkRecord('c1', 'u1', new Date(1_000))
    const old2 = mkRecord('c2', 'u1', new Date(2_000))
    const transport = mkTransport({
      connectionsForUser: jest.fn().mockReturnValue([old1, old2]),
    })
    const handler = build(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { maxConnectionsPerUser: 1 } }),
    )
    await handler.handle(mkReq(), mkRes())
    // max=1, existing=[c1, c2] → length(2) >= 1 → evict c1 → length(1) >= 1 → evict c2 → done
    expect(transport.disconnect).toHaveBeenCalledTimes(2)
    expect(transport.disconnect).toHaveBeenNthCalledWith(1, 'c1', 'REALTIME_TOO_MANY_CONNECTIONS')
    expect(transport.disconnect).toHaveBeenNthCalledWith(2, 'c2', 'REALTIME_TOO_MANY_CONNECTIONS')
  })

  // No eviction when maxConnectionsPerUser is 0 (disabled).
  it('skips eviction when maxConnectionsPerUser is 0', async () => {
    const transport = mkTransport({
      connectionsForUser: jest.fn().mockReturnValue([mkRecord('c1', 'u1')]),
    })
    const handler = build(
      transport,
      mkHeartbeat(),
      mkOptions({ sse: { maxConnectionsPerUser: 0 } }),
    )
    await handler.handle(mkReq(), mkRes())
    expect(transport.disconnect).not.toHaveBeenCalled()
  })

  // No eviction when maxConnectionsPerUser is unset.
  it('skips eviction when maxConnectionsPerUser is unset', async () => {
    const transport = mkTransport({
      connectionsForUser: jest.fn().mockReturnValue([mkRecord('c1', 'u1')]),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), mkRes())
    expect(transport.disconnect).not.toHaveBeenCalled()
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
})
