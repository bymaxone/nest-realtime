/**
 * @fileoverview A `revalidate` that does not answer `true` does not keep the connection.
 * @layer application
 */
import {
  mkRecord,
  mkConnections,
  mkRealtime,
  mkAuth,
  mkOptions,
  build,
  flush,
} from '../../../test/fixtures/reauthentication/harness'

const REVOKED = 'REALTIME_REAUTHENTICATION_FAILED'

/** Run one cycle over one connection whose `revalidate` resolves to `result`. */
async function cycleWith(result: unknown) {
  const realtime = mkRealtime()
  const svc = build(
    mkConnections([mkRecord()]),
    realtime,
    mkAuth(jest.fn().mockResolvedValue(result)),
    mkOptions({ intervalSeconds: 60 }),
  )
  await svc.runCycle()
  await flush()
  return realtime
}

describe('ReauthenticationService: only an explicit true keeps a connection', () => {
  // A `revalidate` that forgot to return resolves to undefined, which is not an allow.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
    ['1', 1],
    ['the string "true"', 'true'],
    ['an empty string', ''],
    ['a user-like object', { userId: 'u1' }],
  ])('disconnects the connection when revalidate resolves to %s', async (_label, result) => {
    const realtime = await cycleWith(result)

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
    expect(realtime.disconnect).toHaveBeenCalledWith('c1', REVOKED)
  })

  it('takes the same path for a non-boolean as for an explicit false', async () => {
    const denied = await cycleWith(false)
    const forgotten = await cycleWith(undefined)

    expect(forgotten.disconnect.mock.calls).toStrictEqual(denied.disconnect.mock.calls)
    expect(forgotten.emitToUser.mock.calls).toStrictEqual(denied.emitToUser.mock.calls)
  })

  it('keeps the connection when revalidate resolves to true', async () => {
    const realtime = await cycleWith(true)

    expect(realtime.disconnect).not.toHaveBeenCalled()
  })
})
