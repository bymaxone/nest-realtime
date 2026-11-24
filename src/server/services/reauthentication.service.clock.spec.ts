/**
 * @fileoverview Which connections a cycle revalidates is decided from the clock; a replaced `Date.now` must not suppress
 * the revalidation of a connection whose credential may have been revoked.
 * @layer services
 */
import { Logger } from '@nestjs/common'
import {
  build,
  mkAuth,
  mkConnections,
  mkOptions,
  mkRealtime,
  mkRecord,
} from '../../../test/fixtures/reauthentication/harness'

const realNow = Date.now

afterEach(() => {
  Date.now = realNow
})

describe('ReauthenticationService reads the clock it started with', () => {
  // Scenario: a connection last revalidated an hour ago, a cache window of a minute, and `Date.now` replaced by a function
  // that always answers the moment of the last revalidation. Expected: the cycle refuses to run, so a stale connection is
  // not silently treated as fresh; nothing is revalidated and nothing is revoked on the strength of the forged clock.
  it('refuses a cycle when Date.now was replaced, instead of skipping every revalidation', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const record = mkRecord('c1', 'u1')
    record.revalidatedAt = realNow() - 3_600_000
    const revalidate = jest.fn().mockResolvedValue(false)
    const service = build(
      mkConnections([record]),
      mkRealtime(),
      mkAuth(revalidate),
      mkOptions({ onFailure: 'disconnect', cacheTtlMs: 60_000 }),
    )
    Date.now = () => record.revalidatedAt as number

    await expect(service.runCycle()).rejects.toMatchObject({
      code: 'REALTIME_TRANSPORT_UNAVAILABLE',
    })
  })

  // Scenario: the same stale connection and the real clock. Expected: it is revalidated, and the failed answer revokes it.
  it('revalidates a stale connection under the real clock', async () => {
    const record = mkRecord('c1', 'u1')
    record.revalidatedAt = realNow() - 3_600_000
    const revalidate = jest.fn().mockResolvedValue(false)
    const realtime = mkRealtime()
    const service = build(
      mkConnections([record]),
      realtime,
      mkAuth(revalidate),
      mkOptions({ onFailure: 'disconnect', cacheTtlMs: 60_000 }),
    )

    await service.runCycle()

    expect(revalidate).toHaveBeenCalledTimes(1)
    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
  })
})
