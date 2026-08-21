/**
 * @fileoverview Unit tests for SseSubscriptionHandler — stream lifecycle and hooks.
 * @layer transport
 *
 * Covers the response headers, the `connection:established` event, the heartbeat, stream
 * teardown and eviction, and the `onConnect`/`onError` lifecycle hooks.
 *
 * Shared builders live in `test/fixtures/sse/subscription-harness.ts` — the suite is
 * split by area and every part needs the same fakes.
 */
import { Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Subject } from 'rxjs'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import {
  collect,
  mkRecord,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'
import { SseSubscriptionHandler } from './sse-subscription.handler'

describe('SseSubscriptionHandler — stream lifecycle and hooks', () => {
  // Anti-buffering headers are set before any other processing.
  it('sets anti-buffering SSE headers', async () => {
    const transport = mkTransport()
    const res = mkRes()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), res)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform')
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no')
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

  // Unsubscribing the stream has to tear the INNER pipeline down as well. Every other case here
  // unsubscribes and then asserts something that happened during subscribe, so a teardown that
  // does nothing reads exactly the same — while in a server it leaks the merged subscription and
  // its `takeUntil` for every disconnected client: one leak per dropped SSE connection.
  it('tears the inner pipeline down when the caller unsubscribes', async () => {
    let capturedSubject: Subject<MessageEvent> | undefined
    const transport = mkTransport({
      registerConnection: jest
        .fn()
        .mockImplementation(async (params: { subject: Subject<MessageEvent> }) => {
          capturedSubject = params.subject
        }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())

    const sub = stream.subscribe()
    await Promise.resolve()
    const observedWhileOpen = capturedSubject?.observed
    sub.unsubscribe()

    expect(observedWhileOpen).toBe(true)
    expect(capturedSubject?.observed).toBe(false)
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

  // onConnect receives the roles the authenticator produced, read off the record.
  it('passes the connection roles to onConnect', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined)
    const transport = mkTransport({
      getConnection: jest.fn().mockReturnValue(mkRecord('conn-1', 'u1', undefined, ['admin'])),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ roles: ['admin'] }))
  })

  // An authenticator that returns no roles yields undefined, not an empty list.
  it('passes undefined roles to onConnect when the connection has none', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined)
    const handler = build(mkTransport(), mkHeartbeat(), mkOptions(), { onConnect })
    const stream = await handler.handle(mkReq(), mkRes())
    const sub = stream.subscribe()
    await Promise.resolve()
    sub.unsubscribe()
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ roles: undefined }))
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

  // The handler works without hooks injected (hooks is @Optional).
  it('works when hooks is not provided', async () => {
    const transport = mkTransport()
    const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), mkOptions(), undefined)
    await expect(handler.handle(mkReq(), mkRes())).resolves.toBeDefined()
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
})
