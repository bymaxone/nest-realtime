/**
 * @fileoverview End-to-end tests for offline queue delivery on reconnect.
 * @layer e2e
 */
import type { MessageEvent } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { firstValueFrom, toArray } from 'rxjs'
import { take } from 'rxjs/operators'
import { Subject } from 'rxjs'
import type { Request, Response } from 'express'
import { SseSubscriptionHandler } from '../../src/server/transports/sse/sse-subscription.handler'
import type { SseTransport } from '../../src/server/transports/sse/sse.transport'
import type { HeartbeatService } from '../../src/server/transports/sse/heartbeat.service'
import type { BymaxRealtimeModuleOptions } from '../../src/server/interfaces/realtime-module-options.interface'
import type { AuthenticationResult, IConnectionAuthenticator } from '../../src/server/interfaces/connection-authenticator.interface'
import type { ConnectionRecord } from '../../src/server/services/connection-registry.service'
import { OfflineQueueDeliveryService } from '../../src/server/offline-queue/offline-queue-delivery.service'
import type { IOfflineQueueStorage, OfflineQueuedEvent } from '../../src/server/interfaces/offline-queue-storage.interface'

const FIXED_AUTH: AuthenticationResult = { userId: 'oq-u1', tenantId: 't1', roles: [] }

function mkRecord(userId = 'oq-u1'): ConnectionRecord {
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
  replayEvents: MessageEvent[] = [],
): SseTransport {
  return {
    authenticate: jest.fn().mockResolvedValue(auth),
    registerConnection: jest.fn().mockResolvedValue(undefined),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue(replayEvents),
    connectionsForUser: jest.fn().mockReturnValue([]),
    getConnection: jest.fn().mockReturnValue(record),
    emitConnectionEvent: false,
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
  return {
    transport: 'sse',
    authenticator: {} as IConnectionAuthenticator,
    sse: { emitConnectionEvent: false },
  }
}

function mkStorage(events: OfflineQueuedEvent[]): IOfflineQueueStorage {
  return {
    retrieveSince: jest.fn().mockResolvedValue(events),
    acknowledge: jest.fn().mockResolvedValue(undefined),
    append: jest.fn().mockResolvedValue(undefined),
  }
}

describe('Offline queue delivery — integration', () => {
  // Queue events are merged into the stream when Last-Event-ID is present.
  it('emits offline queue events when Last-Event-ID is set', async () => {
    const queueEvents: OfflineQueuedEvent[] = [
      { id: '10', event: 'chat', data: { text: 'hello' }, emittedAt: new Date() },
      { id: '11', event: 'chat', data: { text: 'world' }, emittedAt: new Date() },
    ]
    const storage = mkStorage(queueEvents)
    const delivery = new OfflineQueueDeliveryService(storage)
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, [])
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), undefined, delivery)
    const stream$ = await handler.handle(mkReq('9'), mkRes())
    const events = await firstValueFrom(stream$.pipe(take(2), toArray()))
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('chat')
    expect(events[0]?.id).toBe('10')
  })

  // Queue events are de-duplicated against replay-buffer events.
  it('deduplicates queue events against ring-buffer replay events', async () => {
    const replayEvents: MessageEvent[] = [{ id: '10', type: 'chat', data: {} }]
    const queueEvents: OfflineQueuedEvent[] = [
      { id: '10', event: 'chat', data: {}, emittedAt: new Date() },
      { id: '11', event: 'chat', data: {}, emittedAt: new Date() },
    ]
    const storage = mkStorage(queueEvents)
    const delivery = new OfflineQueueDeliveryService(storage)
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, replayEvents)
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), undefined, delivery)
    const stream$ = await handler.handle(mkReq('9'), mkRes())
    const events = await firstValueFrom(stream$.pipe(take(2), toArray()))
    const queueOnlyEvents = events.filter((e) => e.id === '11')
    const duplicates = events.filter((e) => e.id === '10')
    // id:10 comes from replay only; id:11 from the queue only.
    expect(duplicates).toHaveLength(1)
    expect(queueOnlyEvents).toHaveLength(1)
  })

  // No queue events are injected when Last-Event-ID is absent.
  it('skips the offline queue when Last-Event-ID is absent', async () => {
    const storage = mkStorage([
      { id: '5', event: 'x', data: {}, emittedAt: new Date() },
    ])
    const delivery = new OfflineQueueDeliveryService(storage)
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, [])
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), undefined, delivery)
    // No Last-Event-ID header — request without it.
    const stream$ = await handler.handle(mkReq(undefined), mkRes())
    const events: MessageEvent[] = []
    const sub = stream$.subscribe((e) => events.push(e))
    sub.unsubscribe()
    const queueEvents = events.filter((e) => e.id === '5')
    expect(queueEvents).toHaveLength(0)
    expect(storage.retrieveSince).not.toHaveBeenCalled()
  })

  // When no OfflineQueueDeliveryService is provided, the stream is unaffected.
  it('stream works normally without an OfflineQueueDeliveryService', async () => {
    const replayEvents: MessageEvent[] = [{ id: '1', type: 'chat', data: {} }]
    const record = mkRecord()
    const transport = mkTransport(FIXED_AUTH, record, replayEvents)
    // No offline delivery service (undefined — simulates the @Optional() path).
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions())
    const stream$ = await handler.handle(mkReq('0'), mkRes())
    const events: MessageEvent[] = []
    const sub = stream$.subscribe((e) => events.push(e))
    sub.unsubscribe()
    expect(events).toHaveLength(1)
    expect(events[0]?.id).toBe('1')
  })
})
