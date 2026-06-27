/**
 * @fileoverview End-to-end tests for Last-Event-ID reconnection replay.
 * @layer e2e
 */
import type { MessageEvent } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { firstValueFrom, toArray } from 'rxjs'
import { take } from 'rxjs/operators'
import type { Request, Response } from 'express'
import { SseSubscriptionHandler } from '../../src/server/transports/sse/sse-subscription.handler'
import type { SseTransport } from '../../src/server/transports/sse/sse.transport'
import type { HeartbeatService } from '../../src/server/transports/sse/heartbeat.service'
import type { BymaxRealtimeModuleOptions } from '../../src/server/interfaces/realtime-module-options.interface'
import type { AuthenticationResult, IConnectionAuthenticator } from '../../src/server/interfaces/connection-authenticator.interface'
import type { ConnectionRecord } from '../../src/server/services/connection-registry.service'
import type { RegisterSseConnectionParams } from '../../src/server/transports/sse/sse.transport'

const FIXED_AUTH: AuthenticationResult = { userId: 'replay-u1', tenantId: 't1', roles: [] }

function mkRecord(userId = 'replay-u1'): ConnectionRecord {
  const { Subject } = require('rxjs') as typeof import('rxjs')
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

function mkTransport(
  auth: AuthenticationResult | null,
  record: ConnectionRecord,
  replayEvents: MessageEvent[],
  emitConnectionEvent = false,
) {
  return {
    authenticate: jest.fn().mockResolvedValue(auth),
    registerConnection: jest.fn().mockResolvedValue(undefined),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue(replayEvents),
    connectionsForUser: jest.fn().mockReturnValue([]),
    getConnection: jest.fn().mockReturnValue(record),
    emitConnectionEvent,
  } as unknown as SseTransport
}

function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn() } as unknown as HeartbeatService
}

function mkReq(lastEventId?: string): Request {
  return {
    headers: lastEventId !== undefined ? { 'last-event-id': lastEventId } : {},
    query: {},
    ip: '127.0.0.1',
  } as unknown as Request
}

function mkRes(): Response {
  return { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
}

function mkOptions(): BymaxRealtimeModuleOptions {
  return { transport: 'sse', authenticator: {} as IConnectionAuthenticator, sse: { emitConnectionEvent: false } }
}

/** Collect synchronous emissions from a stream (unsubscribes immediately after). */
function collectSync(stream: import('rxjs').Observable<MessageEvent>): MessageEvent[] {
  const events: MessageEvent[] = []
  const sub = stream.subscribe((e) => events.push(e))
  sub.unsubscribe()
  return events
}

describe('Last-Event-ID replay — integration', () => {
  // When Last-Event-ID is present and replay events exist, they are prepended to the stream.
  it('emits replay events before live events when Last-Event-ID is set', async () => {
    const replay: MessageEvent[] = [
      { id: '2', type: 'chat', data: { text: 'hello' } },
      { id: '3', type: 'chat', data: { text: 'world' } },
    ]
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, replay)
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    const stream$ = await handler.handle(mkReq('1'), mkRes())
    const events = collectSync(stream$)
    // Replay events arrive before any live events.
    expect(events).toHaveLength(2)
    expect(events[0]?.id).toBe('2')
    expect(events[1]?.id).toBe('3')
  })

  // Without a Last-Event-ID header, getReplayEvents is not called.
  it('does not request replay events when Last-Event-ID header is absent', async () => {
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, [])
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), mkRes())
    expect(transport.getReplayEvents).not.toHaveBeenCalled()
  })

  // When Last-Event-ID is present but no buffered events exist after it, the stream starts clean.
  it('starts a clean stream when no events are available after Last-Event-ID', async () => {
    const record = mkRecord()
    // getReplayEvents returns empty (ID not found or no newer events).
    const transport = mkTransport(FIXED_AUTH, record, [])
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    const stream$ = await handler.handle(mkReq('999'), mkRes())
    expect(transport.getReplayEvents).toHaveBeenCalledWith('replay-u1', '999')
    const events = collectSync(stream$)
    // No replay events — stream starts empty (no live emissions in this test).
    expect(events).toHaveLength(0)
  })

  // getReplayEvents is called with the correct userId and lastEventId.
  it('passes the authenticated userId and Last-Event-ID to getReplayEvents', async () => {
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, [])
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq('evt-42'), mkRes())
    expect(transport.getReplayEvents).toHaveBeenCalledWith('replay-u1', 'evt-42')
  })

  // Replay events are delivered in their original buffered order.
  it('preserves the original buffered order of replay events', async () => {
    const replay: MessageEvent[] = [
      { id: 'a', type: 'order', data: 1 },
      { id: 'b', type: 'order', data: 2 },
      { id: 'c', type: 'order', data: 3 },
    ]
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, replay)
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    const stream$ = await handler.handle(mkReq('base'), mkRes())
    const events = collectSync(stream$)
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  // When connection:established is enabled on the transport, it is the very first emission.
  it('emits connection:established before replay events when emitConnectionEvent is true', async () => {
    const replay: MessageEvent[] = [{ id: '10', type: 'update', data: {} }]
    const record = mkRecord()
    // emitConnectionEvent: true → handler emits connection:established before replay.
    const transport = mkTransport(FIXED_AUTH, record, replay, true)
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    const stream$ = await handler.handle(mkReq('9'), mkRes())
    const events = collectSync(stream$)
    expect(events[0]?.type).toBe('connection:established')
    expect(events[1]?.id).toBe('10')
  })
})
