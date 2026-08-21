/**
 * @fileoverview Test harness — shared builders for the `SseSubscriptionHandler` specs.
 * @layer test-fixture
 *
 * The handler's suite is split by area (auth context, stream lifecycle, replay and
 * offline queue) and every part needs the same fakes, so they live here rather than
 * being copied into each file. Keeping them under `test/` means they are neither
 * collected for coverage nor mutated, which is correct: a builder has no behaviour
 * of its own to prove.
 *
 * This file lives in `test/` and is never part of the published package.
 */
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { Subject } from 'rxjs'
import type { BymaxRealtimeModuleOptions } from '../../../src/server/interfaces/realtime-module-options.interface'
import type { ConnectionRecord } from '../../../src/server/services/connection-registry.service'
import type { IConnectionLifecycleHooks } from '../../../src/server/interfaces/connection-lifecycle-hooks.interface'
import type { HeartbeatService } from '../../../src/server/transports/sse/heartbeat.service'
import type { SseTransport } from '../../../src/server/transports/sse/sse.transport'
import { SseSubscriptionHandler } from '../../../src/server/transports/sse/sse-subscription.handler'

/** Collect the synchronous emissions (of/EMPTY) the stream produces on subscribe. */
export function collect(stream: Observable<MessageEvent>): MessageEvent[] {
  const events: MessageEvent[] = []
  const sub = stream.subscribe((event) => events.push(event))
  sub.unsubscribe()
  return events
}

/** Build a registered connection record, optionally carrying authenticator roles. */
export function mkRecord(
  id: string,
  userId: string,
  connectedAt?: Date,
  roles?: readonly string[],
): ConnectionRecord {
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
    originalAuth: { userId, tenantId: undefined, roles },
  }
}

/** Build a fake `SseTransport`; `over` replaces any member per test. */
export function mkTransport(over: Partial<Record<string, unknown>> = {}): SseTransport {
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

/** Build a fake `HeartbeatService` recording start/stop calls. */
export function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn() } as unknown as HeartbeatService
}

/** Build minimal SSE module options; `over` merges on top. */
export function mkOptions(
  over: Partial<BymaxRealtimeModuleOptions> = {},
): BymaxRealtimeModuleOptions {
  return {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    ...over,
  }
}

/** Build a fake Express request with only the fields the handler reads. */
export function mkReq(over: Partial<Record<string, unknown>> = {}): Request {
  return {
    headers: (over.headers as Request['headers']) ?? {},
    query: over.query ?? {},
    ip: over.ip,
  } as unknown as Request
}

/** Build a fake Express response recording header writes. */
export function mkRes(): Response {
  return { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
}

/** Construct the handler under test. */
export function build(
  transport: SseTransport,
  heartbeat: HeartbeatService,
  options: BymaxRealtimeModuleOptions,
  hooks?: IConnectionLifecycleHooks,
): SseSubscriptionHandler {
  return new SseSubscriptionHandler(transport, heartbeat, options, hooks)
}
