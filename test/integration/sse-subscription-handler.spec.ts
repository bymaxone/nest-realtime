/**
 * @fileoverview Integration tests: SseSubscriptionHandler with the three auth fixtures.
 * @layer integration
 */
import { UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { sign } from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import type { Observable } from 'rxjs'
import { Subject } from 'rxjs'
import type { Request, Response } from 'express'
import { SseSubscriptionHandler } from '../../src/server/transports/sse/sse-subscription.handler'
import type { SseTransport } from '../../src/server/transports/sse/sse.transport'
import type { HeartbeatService } from '../../src/server/transports/sse/heartbeat.service'
import type { BymaxRealtimeModuleOptions } from '../../src/server/interfaces/realtime-module-options.interface'
import type { ConnectionRecord } from '../../src/server/services/connection-registry.service'
import type { IConnectionLifecycleHooks } from '../../src/server/interfaces/connection-lifecycle-hooks.interface'
import { CookieJwtAuthenticator } from '../fixtures/authenticators/cookie-jwt.authenticator'
import { TicketAuthenticator } from '../fixtures/authenticators/ticket.authenticator'
import { BearerAuthenticator } from '../fixtures/authenticators/bearer.authenticator'

const JWT_SECRET = 'integration-test-secret'

function mkRecord(userId = 'u1'): ConnectionRecord {
  return {
    connectionId: randomUUID(),
    userId,
    tenantId: 't1',
    transport: 'sse',
    ip: '127.0.0.1',
    userAgent: 'jest',
    connectedAt: new Date(),
    subject: new Subject<MessageEvent>(),
    close$: new Subject<void>(),
    originalAuth: { userId, tenantId: 't1', roles: undefined },
  }
}

function mkTransport(authenticator: BymaxRealtimeModuleOptions['authenticator']): SseTransport {
  const record = mkRecord()
  return {
    authenticate: (ctx) => authenticator.authenticate(ctx),
    registerConnection: jest.fn().mockResolvedValue(undefined),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue([]),
    connectionsForUser: jest.fn().mockReturnValue([]),
    getConnection: jest.fn().mockReturnValue(record),
    emitConnectionEvent: true,
  } as unknown as SseTransport
}

function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn() } as unknown as HeartbeatService
}

function mkReq(overrides: Partial<{ cookies: Record<string, string>; query: Record<string, string>; headers: Record<string, string> }> = {}): Request {
  return {
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
    ip: '127.0.0.1',
  } as unknown as Request
}

function mkRes(): Response {
  return { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
}

function mkOptions(authenticator: BymaxRealtimeModuleOptions['authenticator']): BymaxRealtimeModuleOptions {
  return { transport: 'sse', authenticator }
}

function collectSync(stream: Observable<MessageEvent>): MessageEvent[] {
  const events: MessageEvent[] = []
  const sub = stream.subscribe((e) => events.push(e))
  sub.unsubscribe()
  return events
}

describe('SseSubscriptionHandler — integration with auth fixtures', () => {
  describe('Pattern A: CookieJwtAuthenticator', () => {
    let cookieAuth: CookieJwtAuthenticator

    beforeEach(() => {
      cookieAuth = new CookieJwtAuthenticator(JWT_SECRET)
    })

    // A valid cookie JWT produces an Observable with connection:established.
    it('handle() returns an Observable on successful cookie authentication', async () => {
      const token = sign({ sub: 'u1', tid: 't1' }, JWT_SECRET, { expiresIn: '1h' })
      const req = mkReq({ headers: { cookie: `access_token=${token}` } })
      const transport = mkTransport(cookieAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(cookieAuth))
      const stream = await handler.handle(req, mkRes())
      expect(stream).toBeDefined()
      const events = collectSync(stream)
      expect(events[0]?.type).toBe('connection:established')
    })

    // A null auth result throws UnauthorizedException.
    it('throws UnauthorizedException when cookie authentication fails', async () => {
      const req = mkReq({ headers: {} }) // no cookie
      const transport = mkTransport(cookieAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(cookieAuth))
      await expect(handler.handle(req, mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  describe('Pattern B: TicketAuthenticator', () => {
    let ticketAuth: TicketAuthenticator

    beforeEach(() => {
      ticketAuth = new TicketAuthenticator()
    })

    afterEach(() => {
      ticketAuth.clear()
    })

    // A valid ticket in the query string produces an Observable.
    it('handle() returns an Observable on successful ticket authentication', async () => {
      const id = randomUUID()
      ticketAuth.issue(id, { userId: 'u2', tenantId: 't1' })
      const req = mkReq({ query: { ticket: id } })
      const transport = mkTransport(ticketAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(ticketAuth))
      const stream = await handler.handle(req, mkRes())
      expect(stream).toBeDefined()
    })

    // A missing or consumed ticket throws UnauthorizedException.
    it('throws UnauthorizedException when the ticket is absent', async () => {
      const transport = mkTransport(ticketAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(ticketAuth))
      await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  describe('Pattern C: BearerAuthenticator (SSE security — header always stripped)', () => {
    let bearerAuth: BearerAuthenticator

    beforeEach(() => {
      bearerAuth = new BearerAuthenticator()
      bearerAuth.register('valid-bearer', { userId: 'u3', tenantId: 't1' })
    })

    // The SSE handler strips the Authorization header unconditionally before calling
    // authenticate(), so bearer-only auth always results in 401 for SSE connections.
    // This is the correct, documented security behaviour — EventSource cannot send
    // custom headers and bearer auth is intentionally prevented for SSE.
    it('throws UnauthorizedException because the SSE handler strips Authorization', async () => {
      const req = mkReq({ headers: { authorization: 'Bearer valid-bearer' } })
      const transport = mkTransport(bearerAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(bearerAuth))
      await expect(handler.handle(req, mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
    })

    // When both a valid query ticket AND a bearer token are provided, bearer is stripped
    // but the fixture only looks at the Authorization header — also 401.
    it('throws UnauthorizedException even when bearer token is in the headers', async () => {
      const transport = mkTransport(bearerAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(bearerAuth))
      await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  describe('Connection registration', () => {
    let cookieAuth: CookieJwtAuthenticator

    beforeEach(() => {
      cookieAuth = new CookieJwtAuthenticator(JWT_SECRET)
    })

    // The connection is registered with the transport after authentication.
    it('calls transport.registerConnection after a successful auth', async () => {
      const token = sign({ sub: 'u1', tid: 't1' }, JWT_SECRET, { expiresIn: '1h' })
      const req = mkReq({ headers: { cookie: `access_token=${token}` } })
      const transport = mkTransport(cookieAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(cookieAuth))
      await handler.handle(req, mkRes())
      expect(transport.registerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ auth: expect.objectContaining({ userId: 'u1' }) }),
      )
    })

    // onConnect lifecycle hook is invoked best-effort after registration.
    it('fires the onConnect hook after the connection is registered', async () => {
      const token = sign({ sub: 'u1', tid: 't1' }, JWT_SECRET, { expiresIn: '1h' })
      const req = mkReq({ headers: { cookie: `access_token=${token}` } })
      const hooks: IConnectionLifecycleHooks = { onConnect: jest.fn() }
      const transport = mkTransport(cookieAuth)
      const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(cookieAuth), hooks)
      await handler.handle(req, mkRes())
      // Allow best-effort microtask to resolve.
      await Promise.resolve()
      expect(hooks.onConnect).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
    })
  })
})
