/**
 * @fileoverview End-to-end tests for connection lifecycle hooks via SseSubscriptionHandler.
 * @layer e2e
 */
import { UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Subject } from 'rxjs'
import type { Request, Response } from 'express'
import { SseSubscriptionHandler } from '../../src/server/transports/sse/sse-subscription.handler'
import type { SseTransport } from '../../src/server/transports/sse/sse.transport'
import type { HeartbeatService } from '../../src/server/transports/sse/heartbeat.service'
import type { BymaxRealtimeModuleOptions } from '../../src/server/interfaces/realtime-module-options.interface'
import type { IConnectionLifecycleHooks } from '../../src/server/interfaces/connection-lifecycle-hooks.interface'
import type { ConnectionRecord } from '../../src/server/services/connection-registry.service'
import type {
  AuthenticationResult,
  IConnectionAuthenticator,
} from '../../src/server/interfaces/connection-authenticator.interface'
import type { RegisterSseConnectionParams } from '../../src/server/transports/sse/sse.transport'

const FIXED_AUTH: AuthenticationResult = { userId: 'u1', tenantId: 't1', roles: ['user'] }

function mkRecord(id = randomUUID(), userId = 'u1'): ConnectionRecord {
  return {
    connectionId: id,
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

/**
 * Build a SseTransport stub that captures the `subject` and `close$` from
 * `registerConnection` so tests can drive the stream directly.
 */
function mkTransport(auth: AuthenticationResult | null, record: ConnectionRecord) {
  let capturedSubject: Subject<MessageEvent> | undefined
  let capturedClose$: Subject<void> | undefined

  const transport = {
    authenticate: jest.fn().mockResolvedValue(auth),
    registerConnection: jest.fn().mockImplementation(async (params: RegisterSseConnectionParams) => {
      capturedSubject = params.subject as Subject<MessageEvent>
      capturedClose$ = params.close$ as Subject<void>
    }),
    unregisterConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getReplayEvents: jest.fn().mockReturnValue([]),
    connectionsForUser: jest.fn().mockReturnValue([]),
    getConnection: jest.fn().mockReturnValue(record),
    emitConnectionEvent: true,
  } as unknown as SseTransport & { _subject?: Subject<MessageEvent>; _close$?: Subject<void> }

  return {
    transport,
    /** Returns the subject after handle() resolves. */
    get subject(): Subject<MessageEvent> { return capturedSubject! },
    /** Returns the close$ after handle() resolves. */
    get close$(): Subject<void> { return capturedClose$! },
  }
}

function mkHeartbeat(): HeartbeatService {
  return { start: jest.fn(), stop: jest.fn() } as unknown as HeartbeatService
}

function mkReq(headers: Record<string, string> = {}): Request {
  return { headers, query: {}, ip: '127.0.0.1' } as unknown as Request
}

function mkRes(): Response {
  return { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
}

function mkOptions(): BymaxRealtimeModuleOptions {
  return { transport: 'sse', authenticator: {} as IConnectionAuthenticator }
}

describe('Connection lifecycle hooks — integration', () => {
  // onConnect is fired after a successful connection with the correct meta.
  it('fires onConnect with correct connection meta after authentication succeeds', async () => {
    const record = mkRecord()
    const { transport } = mkTransport(FIXED_AUTH, record)
    const onConnect = jest.fn()
    const hooks: IConnectionLifecycleHooks = { onConnect }
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), hooks)
    await handler.handle(mkReq(), mkRes())
    // onConnect is best-effort — flush one microtask turn.
    await Promise.resolve()
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: record.connectionId,
        userId: 'u1',
        tenantId: 't1',
        transport: 'sse',
      }),
    )
  })

  // onDisconnect is wired through transport.unregisterConnection. When the stream
  // finalizes (close$ fires), the handler calls transport.unregisterConnection.
  it('calls transport.unregisterConnection when the stream finalizes via close$', async () => {
    const record = mkRecord()
    const ref = mkTransport(FIXED_AUTH, record)
    const hooks: IConnectionLifecycleHooks = { onDisconnect: jest.fn() }
    const handler = new SseSubscriptionHandler(ref.transport, mkHeartbeat(), mkOptions(), hooks)
    const stream$ = await handler.handle(mkReq(), mkRes())
    const sub = stream$.subscribe()
    // Trigger the takeUntil operator, which fires finalize → unregisterConnection.
    ref.close$.next()
    ref.close$.complete()
    sub.unsubscribe()
    await Promise.resolve()
    expect(ref.transport.unregisterConnection).toHaveBeenCalled()
  })

  // onError is fired (best-effort) when the live subject errors.
  it('fires onError when the SSE subject emits an error', async () => {
    const record = mkRecord()
    const ref = mkTransport(FIXED_AUTH, record)
    const onError = jest.fn()
    const hooks: IConnectionLifecycleHooks = { onError }
    const handler = new SseSubscriptionHandler(ref.transport, mkHeartbeat(), mkOptions(), hooks)
    const stream$ = await handler.handle(mkReq(), mkRes())
    let completed = false
    stream$.subscribe({ complete: () => { completed = true } })
    // Error the subject created inside handle (captured via registerConnection mock).
    ref.subject.error(new Error('upstream-error'))
    // The catchError turns the error into EMPTY, completing the stream synchronously.
    expect(completed).toBe(true)
    // onError is dispatched best-effort — flush microtasks.
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'upstream-error' }),
        transport: 'sse',
      }),
    )
  })

  // A throwing onConnect hook is swallowed — the stream is still returned.
  it('swallows a throwing onConnect hook and still returns the stream', async () => {
    const record = mkRecord()
    const { transport } = mkTransport(FIXED_AUTH, record)
    const onConnect = jest.fn().mockRejectedValue(new Error('hook crash'))
    const hooks: IConnectionLifecycleHooks = { onConnect }
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), hooks)
    const stream$ = await handler.handle(mkReq(), mkRes())
    await Promise.resolve()
    expect(stream$).toBeDefined()
  })

  // All hooks absent → the full lifecycle runs without any crash.
  it('runs the full lifecycle without crashing when all hooks are undefined', async () => {
    const record = mkRecord()
    const ref = mkTransport(FIXED_AUTH, record)
    const hooks: IConnectionLifecycleHooks = {} // no hooks
    const handler = new SseSubscriptionHandler(ref.transport, mkHeartbeat(), mkOptions(), hooks)
    const stream$ = await handler.handle(mkReq(), mkRes())
    const sub = stream$.subscribe()
    ref.close$.next()
    sub.unsubscribe()
    await Promise.resolve()
    expect(ref.transport.registerConnection).toHaveBeenCalled()
  })

  // Authentication failure throws UnauthorizedException — onConnect is never called.
  it('throws UnauthorizedException without entering lifecycle when auth fails', async () => {
    const record = mkRecord()
    const { transport } = mkTransport(null, record)
    const onConnect = jest.fn()
    const hooks: IConnectionLifecycleHooks = { onConnect }
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), hooks)
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
    await Promise.resolve()
    expect(onConnect).not.toHaveBeenCalled()
  })
})
