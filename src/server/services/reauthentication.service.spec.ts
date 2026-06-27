/**
 * @fileoverview Unit tests for the periodic re-authentication service.
 * @layer application
 */
import { RESERVED_EVENT_NAMES } from '../../shared/constants/reserved-events.constants'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { ReauthenticationService } from './reauthentication.service'
import type { ConnectionRecord } from './connection-registry.service'

/** Drain the microtask queue through several turns. */
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

function mkRecord(id = 'c1', userId = 'u1'): ConnectionRecord {
  return {
    connectionId: id,
    userId,
    tenantId: 't1',
    transport: 'sse',
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: new Date(),
    subject: null,
    close$: null,
    originalAuth: { userId, tenantId: 't1', roles: undefined },
  }
}

function mkConnections(records: ConnectionRecord[]) {
  return { allByTransport: jest.fn().mockReturnValue(records) }
}

function mkRealtime() {
  return {
    emitToUser: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  }
}

function mkAuth(revalidate?: jest.Mock) {
  const auth: Record<string, unknown> = { authenticate: jest.fn() }
  if (revalidate) auth['revalidate'] = revalidate
  return auth
}

function mkOptions(policy?: {
  intervalSeconds?: number
  onFailure?: 'disconnect' | 'event'
  cacheTtlMs?: number
}) {
  return { transport: 'sse', authenticator: {}, reauthenticationPolicy: policy }
}

function build(
  connections: ReturnType<typeof mkConnections>,
  realtime: ReturnType<typeof mkRealtime>,
  auth: ReturnType<typeof mkAuth>,
  options: ReturnType<typeof mkOptions>,
  hooks?: object,
) {
  return new ReauthenticationService(
    connections as never,
    realtime as never,
    auth as never,
    options as never,
    hooks as never,
  )
}

describe('ReauthenticationService', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  // When the authenticator has no revalidate method, no timer is scheduled.
  it('does not schedule a timer when revalidate is absent', async () => {
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth() // no revalidate
    const svc = build(connections, realtime, auth, mkOptions())
    svc.onModuleInit()
    jest.advanceTimersByTime(600_000) // advance 10 minutes — no timer should fire
    await flush()
    expect(connections.allByTransport).not.toHaveBeenCalled()
  })

  // When revalidate is present, the timer fires on the configured interval.
  it('schedules a revalidation cycle on the configured interval', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 10 }))
    svc.onModuleInit()
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledWith('c1', expect.objectContaining({ userId: 'u1' }))
  })

  // A positive-cache hit skips the revalidate call within cacheTtlMs.
  it('skips revalidation for connections within the positive-cache window', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    // cacheTtlMs (120_000) >> intervalSeconds*2 (20_000) — second tick always cached.
    const svc = build(
      connections,
      realtime,
      auth,
      mkOptions({ intervalSeconds: 10, cacheTtlMs: 120_000 }),
    )
    svc.onModuleInit()
    // First tick: revalidate called, cache set.
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledTimes(1)
    // Second tick: cache age 10,000 ms < 120,000 ms TTL → skip.
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledTimes(1)
  })

  // An expired cache entry triggers revalidation again.
  it('revalidates after the positive-cache TTL expires', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    // intervalSeconds=10, cacheTtlMs=15_000 — cache expires between tick 1 (10s) and tick 3 (30s).
    const svc = build(
      connections,
      realtime,
      auth,
      mkOptions({ intervalSeconds: 10, cacheTtlMs: 15_000 }),
    )
    svc.onModuleInit()
    // Tick 1 (t=10s): revalidate called, lastValid=10_000.
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledTimes(1)
    // Tick 2 (t=20s): now-lastValid=10_000 < 15_000 → cached, skip.
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledTimes(1)
    // Tick 3 (t=30s): now-lastValid=20_000 > 15_000 → expired, revalidate again.
    jest.advanceTimersByTime(10_000)
    await flush()
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  // revalidate returns false + onFailure:'disconnect' → only disconnect is called.
  it('disconnects the connection when revalidate returns false (onFailure: disconnect)', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(
      connections,
      realtime,
      auth,
      mkOptions({ intervalSeconds: 60, onFailure: 'disconnect' }),
    )
    await svc.runCycle()
    await flush()
    expect(realtime.disconnect).toHaveBeenCalledWith(
      'c1',
      REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED,
    )
    expect(realtime.emitToUser).not.toHaveBeenCalled()
  })

  // revalidate returns false + onFailure:'event' → reserved event emitted, then disconnect.
  it('emits the failure event then disconnects (onFailure: event)', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(
      connections,
      realtime,
      auth,
      mkOptions({ intervalSeconds: 60, onFailure: 'event' }),
    )
    await svc.runCycle()
    await flush()
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      'u1',
      RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED,
      { reason: REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED },
    )
    expect(realtime.disconnect).toHaveBeenCalledWith(
      'c1',
      REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED,
    )
  })

  // A throwing revalidate is non-fatal — the cycle continues for other connections.
  it('continues processing other connections when one revalidate throws', async () => {
    const revalidate = jest
      .fn()
      .mockRejectedValueOnce(new Error('revalidate boom'))
      .mockResolvedValue(true)
    const connections = mkConnections([mkRecord('c1', 'u1'), mkRecord('c2', 'u2')])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    await expect(svc.runCycle()).resolves.toBeUndefined()
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  // onApplicationShutdown clears the timer — no cycles fire after shutdown.
  it('clears the timer on shutdown', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 10 }))
    svc.onModuleInit()
    svc.onApplicationShutdown()
    jest.advanceTimersByTime(60_000)
    await flush()
    expect(revalidate).not.toHaveBeenCalled()
  })

  // The onReauthenticationFailed hook fires best-effort on a failure.
  it('fires the onReauthenticationFailed hook best-effort on failure', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const hooks = { onReauthenticationFailed: jest.fn().mockResolvedValue(undefined) }
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }), hooks)
    await svc.runCycle()
    await flush()
    expect(hooks.onReauthenticationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', userId: 'u1', transport: 'sse' }),
    )
  })

  // A throwing onReauthenticationFailed hook is swallowed — disconnect still fires.
  it('swallows a throwing onReauthenticationFailed hook and still disconnects', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const hooks = { onReauthenticationFailed: jest.fn().mockRejectedValue(new Error('hook boom')) }
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }), hooks)
    await svc.runCycle()
    await flush()
    // Disconnect is still called despite the hook throwing.
    expect(realtime.disconnect).toHaveBeenCalledWith(
      'c1',
      REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED,
    )
  })

  // Covers the spread branches in originalAuth construction: tenantId absent + roles present.
  it('passes originalAuth without tenantId and with roles when those fields are set accordingly', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    // tenantId: undefined → spread emits {}; roles: defined → spread emits { roles }
    const record: ConnectionRecord = {
      connectionId: 'c-spread',
      userId: 'u-spread',
      tenantId: undefined,
      transport: 'sse',
      ip: '127.0.0.1',
      userAgent: undefined,
      connectedAt: new Date(),
      subject: null,
      close$: null,
      originalAuth: { userId: 'u-spread', tenantId: undefined, roles: ['admin'] },
    }
    const connections = mkConnections([record])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c-spread',
      expect.objectContaining({ userId: 'u-spread', roles: ['admin'] }),
    )
    // tenantId should be absent (not present as undefined) on the passed object.
    const passedAuth = revalidate.mock.calls[0][1] as Record<string, unknown>
    expect('tenantId' in passedAuth).toBe(false)
  })

  // No hooks provided (undefined) — runCycle completes without crashing.
  it('runs without crashing when no hooks are provided', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    // No hooks argument → hooks is undefined.
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    await expect(svc.runCycle()).resolves.toBeUndefined()
  })

  // onApplicationShutdown when the timer was never started (no revalidate on auth) → no-op.
  it('onApplicationShutdown is a no-op when the timer was never started', () => {
    const connections = mkConnections([])
    const realtime = mkRealtime()
    const auth = mkAuth() // no revalidate → onModuleInit skips timer creation
    const svc = build(connections, realtime, auth, mkOptions())
    svc.onModuleInit() // no-op (no revalidate)
    // Must not throw even though this.timer is null.
    expect(() => svc.onApplicationShutdown()).not.toThrow()
  })

  // runCycle when auth has no revalidate — revalidate?.() returns undefined → ?? true caches.
  it('caches connection as valid when auth has no revalidate (runCycle called directly)', async () => {
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const auth = mkAuth() // no revalidate
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    // Calling runCycle directly bypasses the onModuleInit guard.
    await svc.runCycle()
    // No disconnect or event should be emitted — ?? true treats missing revalidate as success.
    expect(realtime.disconnect).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
  })
})
