/**
 * @fileoverview The re-authentication service warns, when it starts, that the positive cache outlives the interval.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import {
  build,
  mkAuth,
  mkConnections,
  mkOptions,
  mkRealtime,
} from '../../../test/fixtures/reauthentication/harness'

describe('ReauthenticationService: the cache that outlives the interval', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const start = (policy?: { intervalSeconds?: number; cacheTtlMs?: number }) => {
    const svc = build(mkConnections([]), mkRealtime(), mkAuth(jest.fn()), mkOptions(policy))
    svc.onModuleInit()
    svc.onApplicationShutdown()
  }

  // Scenario: the cache is kept longer than the interval, so ticks inside the window skip revalidation. Expected:
  // one warning with its own code and the two figures, written through the service's logger.
  it('warns once when cacheTtlMs exceeds the interval', () => {
    start({ intervalSeconds: 60, cacheTtlMs: 120_000 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'REALTIME_REAUTH_CACHE_WEAKENS_POLICY',
        cacheTtlMs: 120_000,
        intervalMs: 60_000,
        message: expect.stringContaining('60000 ms'),
      }),
    )
  })

  // Scenario: the boundaries. Expected: equal is not greater, one millisecond over is, and a figure well below is not.
  it.each([
    ['equals the interval', { intervalSeconds: 60, cacheTtlMs: 60_000 }, 0],
    ['is 1 ms over the interval', { intervalSeconds: 1, cacheTtlMs: 1001 }, 1],
    ['equals one second', { intervalSeconds: 1, cacheTtlMs: 1000 }, 0],
    ['is far below the interval', { intervalSeconds: 60, cacheTtlMs: 1 }, 0],
    ['is set without an interval', { cacheTtlMs: 120_000 }, 0],
    ['is not set', { intervalSeconds: 60 }, 0],
    ['has no policy at all', undefined, 0],
  ])('warns %s as expected', (_name, policy, times) => {
    start(policy)
    expect(warn).toHaveBeenCalledTimes(times)
  })
})
