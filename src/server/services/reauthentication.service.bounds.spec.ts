/**
 * @fileoverview The re-authentication cycle is bounded: no call can stall it, none is made twice at
 * once for a connection, and nothing is kept for a connection that has gone.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import {
  mkRecord,
  mkConnections,
  mkRealtime,
  mkAuth,
  mkOptions,
  build,
} from '../../../test/fixtures/reauthentication/harness'

const REVOKED = 'REALTIME_REAUTHENTICATION_FAILED'

/** Every Map and Set the service holds: what it keeps per connection lives in one of them. */
function heldCollections(svc: object): Array<Map<unknown, unknown> | Set<unknown>> {
  return Object.values(svc).filter(
    (value): value is Map<unknown, unknown> | Set<unknown> =>
      value instanceof Map || value instanceof Set,
  )
}

describe('ReauthenticationService: the cycle is bounded', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // A call that never settles must not keep another connection from being revalidated or revoked.
  it('revokes a connection after a revalidate that never settles, and one revoked behind it', async () => {
    const revalidate = jest.fn((id: string) =>
      id === 'hung' ? new Promise<boolean>(() => undefined) : Promise.resolve(false),
    )
    const realtime = mkRealtime()
    const svc = build(
      mkConnections([mkRecord('hung'), mkRecord('revoked')]),
      realtime,
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 10_000 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(10_000)
    await cycle

    expect(realtime.disconnect).toHaveBeenCalledWith('revoked', REVOKED)
    expect(realtime.disconnect).toHaveBeenCalledWith('hung', REVOKED)
    expect(warn).toHaveBeenCalledWith(
      'Reauthentication errored for hung: revalidate did not settle within 10000 ms',
    )
  })

  // The revoke runs in the same slot, so a disconnect that never settles must not hold it for ever.
  it('releases the slot of a revoke that never settles, so the connections behind it are still revoked', async () => {
    const realtime = mkRealtime()
    realtime.disconnect.mockImplementation((id: string) =>
      id === 'stuck' ? new Promise<void>(() => undefined) : Promise.resolve(),
    )
    const svc = build(
      mkConnections([mkRecord('stuck'), mkRecord('next', 'u2')]),
      realtime,
      mkAuth(jest.fn().mockResolvedValue(false)),
      mkOptions({ intervalSeconds: 60, concurrency: 1, revalidateTimeoutMs: 1_000 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(2_000)
    await cycle

    expect(realtime.disconnect).toHaveBeenCalledWith('next', REVOKED)
    expect(warn).toHaveBeenCalledWith(
      'Revocation of stuck failed, retrying next cycle: revocation did not settle within 1000 ms',
    )
  })

  it('asks again about a connection whose revoke timed out on the next cycle', async () => {
    const realtime = mkRealtime()
    realtime.disconnect.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const svc = build(
      mkConnections([mkRecord('stuck')]),
      realtime,
      mkAuth(jest.fn().mockResolvedValue(false)),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 1_000 }),
    )

    const first = svc.runCycle()
    await jest.advanceTimersByTimeAsync(1_000)
    await first
    await svc.runCycle()

    expect(realtime.disconnect).toHaveBeenCalledTimes(2)
  })

  // The timeout wins even against a call that answers true from its own abort listener, which runs
  // when the signal is aborted: the answer of a call that timed out is never taken.
  it('does not keep a connection whose revalidate answers true when it is aborted', async () => {
    const revalidate = jest.fn(
      (_id: string, _auth: unknown, options: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          options.signal.addEventListener('abort', () => resolve(true))
        }),
    )
    const realtime = mkRealtime()
    const record = mkRecord('aborted')
    const svc = build(
      mkConnections([record]),
      realtime,
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 1_000 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(1_000)
    await cycle

    expect(realtime.disconnect).toHaveBeenCalledWith('aborted', REVOKED)
    expect(record.revalidatedAt).toBeUndefined()
  })

  // A call that did not answer in time is treated as one that threw: the connection is not kept.
  it('does not keep a connection whose revalidate answers true only after the timeout', async () => {
    let answer!: (ok: boolean) => void
    const revalidate = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const realtime = mkRealtime()
    const record = mkRecord('late')
    const svc = build(
      mkConnections([record]),
      realtime,
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 1_000 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(1_000)
    await cycle
    answer(true)
    await jest.advanceTimersByTimeAsync(0)

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
    expect(record.revalidatedAt).toBeUndefined()
  })

  it('hands revalidate a signal that is aborted when the timeout passes', async () => {
    const signals: AbortSignal[] = []
    const revalidate = jest.fn((_id: string, _auth: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal)
      return new Promise<boolean>(() => undefined)
    })
    const svc = build(
      mkConnections([mkRecord('c1')]),
      mkRealtime(),
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 1_000 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(0)
    expect(signals[0]?.aborted).toBe(false)
    await jest.advanceTimersByTimeAsync(1_000)
    await cycle

    expect(signals[0]?.aborted).toBe(true)
  })

  it('does not abort the signal of a call that settles in time', async () => {
    const signals: AbortSignal[] = []
    const revalidate = jest.fn(
      async (_id: string, _auth: unknown, options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        return true
      },
    )
    const record = mkRecord('c1')
    const svc = build(
      mkConnections([record]),
      mkRealtime(),
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, revalidateTimeoutMs: 1_000 }),
    )

    await svc.runCycle()
    await jest.advanceTimersByTimeAsync(5_000)

    expect(signals[0]?.aborted).toBe(false)
    expect(record.revalidatedAt).toBeDefined()
  })

  // A shared cap: a slow backend is never asked for more than this many answers at once.
  it('never has more calls in flight than the concurrency, and still revalidates every connection', async () => {
    let inFlight = 0
    let peak = 0
    const revalidate = jest.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 50))
      inFlight -= 1
      return true
    })
    const records = Array.from({ length: 20 }, (_v, i) => mkRecord(`c${i}`, `u${i}`))
    const svc = build(
      mkConnections(records),
      mkRealtime(),
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, concurrency: 4, cacheTtlMs: 0 }),
    )

    const cycle = svc.runCycle()
    await jest.advanceTimersByTimeAsync(1_000)
    await cycle

    expect(peak).toBe(4)
    expect(revalidate).toHaveBeenCalledTimes(20)
  })

  // Two cycles that overlap must not both be asking about one connection.
  it('makes one call at a time for a connection however many cycles overlap', async () => {
    let inFlight = 0
    let peak = 0
    const revalidate = jest.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 12_000))
      inFlight -= 1
      return true
    })
    const svc = build(
      mkConnections([mkRecord('a')]),
      mkRealtime(),
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 5, cacheTtlMs: 0, revalidateTimeoutMs: 60_000 }),
    )
    svc.onModuleInit()

    await jest.advanceTimersByTimeAsync(30_000)
    svc.onApplicationShutdown()

    expect(peak).toBe(1)
  })

  // The next tick must still reach the connections the slow one is not holding.
  it('lets a later cycle revalidate the other connections while one call is still in flight', async () => {
    const calls: string[] = []
    const revalidate = jest.fn((id: string) => {
      calls.push(id)
      return id === 'slow' ? new Promise<boolean>(() => undefined) : Promise.resolve(true)
    })
    const svc = build(
      mkConnections([mkRecord('slow'), mkRecord('fast')]),
      mkRealtime(),
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 1, cacheTtlMs: 0, revalidateTimeoutMs: 60_000 }),
    )
    svc.onModuleInit()

    await jest.advanceTimersByTimeAsync(3_500)
    svc.onApplicationShutdown()

    expect(calls.filter((id) => id === 'slow')).toHaveLength(1)
    expect(calls.filter((id) => id === 'fast').length).toBeGreaterThanOrEqual(3)
  })

  // The cache of a successful revalidation lives with the connection, so it cannot outlive it.
  it('holds nothing per connection after the connections are gone', async () => {
    const records = Array.from({ length: 1000 }, (_v, i) => mkRecord(`c${i}`, `u${i}`))
    const live = [...records]
    const connections = {
      allByTransport: jest.fn((transport: string) =>
        live.filter((record) => record.transport === transport),
      ),
    }
    const svc = build(
      connections as never,
      mkRealtime(),
      mkAuth(jest.fn().mockResolvedValue(true)),
      mkOptions({ intervalSeconds: 60, cacheTtlMs: 600_000 }),
    )

    await svc.runCycle()
    live.length = 0
    await svc.runCycle()

    expect(heldCollections(svc).map((collection) => collection.size)).toStrictEqual(
      heldCollections(svc).map(() => 0),
    )
    expect(records[0]?.revalidatedAt).toBeDefined()
  })

  it('skips a connection revalidated within the cache window, and revalidates it after', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const svc = build(
      mkConnections([mkRecord('a')]),
      mkRealtime(),
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60, cacheTtlMs: 60_000 }),
    )

    await svc.runCycle()
    await jest.advanceTimersByTimeAsync(59_999)
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(2)
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('forgets a successful revalidation when the connection is revoked, so a failed revoke is retried', async () => {
    let ok = true
    const revalidate = jest.fn(async () => ok)
    const realtime = mkRealtime()
    realtime.disconnect.mockRejectedValueOnce(new Error('cannot reach it'))
    const record = mkRecord('a')
    const svc = build(
      mkConnections([record]),
      realtime,
      mkAuth(revalidate as never),
      mkOptions({ intervalSeconds: 60, cacheTtlMs: 600_000 }),
    )
    await svc.runCycle()
    expect(record.revalidatedAt).toBeDefined()
    ok = false
    await jest.advanceTimersByTimeAsync(600_001)

    await svc.runCycle()

    expect(record.revalidatedAt).toBeUndefined()
    await svc.runCycle()
    expect(realtime.disconnect).toHaveBeenCalledTimes(2)
  })
})
