/**
 * @fileoverview Unit tests for the dynamic SSE controller factory.
 * @layer transport
 */
import { UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { RESERVED_EVENT_NAMES } from '../constants/reserved-events.constants'
import type { SseTransport } from '../transports/sse/sse.transport'
import type { HeartbeatService } from '../transports/sse/heartbeat.service'
import { createSseController } from './sse-controller.factory'

interface SseControllerInstance {
  subscribe(req: Request, res: Response): Promise<Observable<MessageEvent>>
}

/** Collect the synchronous emissions (`of`/`EMPTY`) the stream produces on subscribe. */
function collect(stream: Observable<MessageEvent>): MessageEvent[] {
  const events: MessageEvent[] = []
  const sub = stream.subscribe((event) => events.push(event))
  sub.unsubscribe()
  return events
}

function mkTransport(over: Record<string, unknown> = {}): SseTransport {
  return {
    authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1' }),
    registerConnection: jest.fn().mockResolvedValue(undefined),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue([]),
    heartbeatMs: 30_000,
    emitConnectionEvent: true,
    ...over,
  } as unknown as SseTransport
}

function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn(), stopAll: jest.fn() } as unknown as HeartbeatService
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

function build(transport: SseTransport, heartbeat: HeartbeatService): SseControllerInstance {
  const ControllerClass = createSseController('/realtime/sse')
  return new ControllerClass(transport, heartbeat) as unknown as SseControllerInstance
}

describe('createSseController', () => {
  // The handler sets compression-buster headers before anything else.
  it('sets anti-buffering SSE headers', async () => {
    const transport = mkTransport()
    const res = mkRes()
    await build(transport, mkHeartbeat()).subscribe(mkReq(), res)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform')
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no')
  })

  // A failed authentication throws 401 (UnauthorizedException).
  it('throws Unauthorized when authentication fails', async () => {
    const transport = mkTransport({ authenticate: jest.fn().mockResolvedValue(null) })
    await expect(
      build(transport, mkHeartbeat()).subscribe(mkReq(), mkRes()),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  // On success the stream starts with the client-safe connection:established event.
  it('emits connection:established first with a client-safe trait subset', async () => {
    const transport = mkTransport()
    const heartbeat = mkHeartbeat()
    const stream = await build(transport, heartbeat).subscribe(mkReq(), mkRes())
    const events = collect(stream)
    expect(events[0]?.type).toBe(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED)
    const data = events[0]?.data as { traits: { userId: string; tenantId?: string } }
    expect(data.traits).toEqual({ userId: 'u1', tenantId: 't1', roles: undefined })
    expect(transport.registerConnection).toHaveBeenCalledTimes(1)
    expect(heartbeat.start).toHaveBeenCalledWith(expect.any(String), expect.anything(), 30_000)
  })

  // When the connection event is disabled, no established event is emitted.
  it('omits connection:established when disabled', async () => {
    const transport = mkTransport({ emitConnectionEvent: false })
    const stream = await build(transport, mkHeartbeat()).subscribe(mkReq(), mkRes())
    expect(collect(stream)).toEqual([])
  })

  // A Last-Event-ID replays the buffered events that were missed.
  it('replays buffered events on Last-Event-ID', async () => {
    const replayed: MessageEvent = { id: 'e2', type: 'evt', data: { n: 2 } }
    const transport = mkTransport({
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([replayed]),
    })
    const req = mkReq({ headers: { 'last-event-id': 'e1' } })
    const stream = await build(transport, mkHeartbeat()).subscribe(req, mkRes())
    expect(collect(stream)).toEqual([replayed])
    expect(transport.getReplayEvents).toHaveBeenCalledWith('u1', 'e1')
  })

  // A Last-Event-ID with no buffered events yields an empty replay stream.
  it('emits nothing extra when the replay buffer has no events', async () => {
    const transport = mkTransport({
      emitConnectionEvent: false,
      getReplayEvents: jest.fn().mockReturnValue([]),
    })
    const req = mkReq({ headers: { 'last-event-id': 'e1' } })
    const stream = await build(transport, mkHeartbeat()).subscribe(req, mkRes())
    expect(collect(stream)).toEqual([])
  })

  // Tearing down the stream triggers cleanup via unregisterConnection.
  it('cleans up on unsubscribe', async () => {
    const transport = mkTransport()
    const stream = await build(transport, mkHeartbeat()).subscribe(mkReq(), mkRes())
    const sub = stream.subscribe()
    sub.unsubscribe()
    expect(transport.unregisterConnection).toHaveBeenCalledTimes(1)
  })

  // The client IP is taken from X-Forwarded-For when present.
  it('resolves the IP from X-Forwarded-For', async () => {
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    await build(transport, mkHeartbeat()).subscribe(req, mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  // Without a forwarded header the request IP is used.
  it('falls back to req.ip', async () => {
    const transport = mkTransport()
    await build(transport, mkHeartbeat()).subscribe(mkReq({ ip: '9.9.9.9' }), mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '9.9.9.9' }),
    )
  })

  // With neither source the IP resolves to 'unknown'.
  it('resolves IP to "unknown" when nothing is available', async () => {
    const transport = mkTransport()
    await build(transport, mkHeartbeat()).subscribe(mkReq(), mkRes())
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: 'unknown' }),
    )
  })

  // The auth context normalizes header names and flattens array values.
  it('normalizes headers and parses cookies into the auth context', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({
      headers: {
        cookie: 'token=abc',
        'x-multi': ['a', 'b'],
        'user-agent': 'jest',
      },
    })
    await build(transport, mkHeartbeat()).subscribe(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as {
      cookies: Record<string, string>
      headers: Record<string, string | undefined>
      userAgent: string | undefined
    }
    expect(context.cookies).toEqual({ token: 'abc' })
    expect(context.headers['x-multi']).toBe('a,b')
    expect(context.userAgent).toBe('jest')
  })
})
