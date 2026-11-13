/**
 * @fileoverview A re-authentication failure hook that fails must not keep a connection connected.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import {
  flush,
  mkRecord,
  mkConnections,
  mkRealtime,
  mkAuth,
  mkOptions,
  build,
} from '../../../test/fixtures/reauthentication/harness'

describe('ReauthenticationService: a failing onReauthenticationFailed hook', () => {
  // The hook is a notification: one that throws before it returns must not keep the connection
  // whose credentials were refused from being disconnected.
  it('still disconnects the connection when onReauthenticationFailed throws before it returns', async () => {
    const revalidate = jest.fn().mockResolvedValue(false)
    const connections = mkConnections([mkRecord()])
    const realtime = mkRealtime()
    const hooks = {
      onReauthenticationFailed: jest.fn(() => {
        throw new Error('hook down')
      }),
    }
    const svc = build(
      connections,
      realtime,
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60 }),
      hooks,
    )

    await svc.runCycle()
    await flush()

    expect(realtime.disconnect).toHaveBeenCalledWith('c1', 'REALTIME_REAUTHENTICATION_FAILED')
  })

  it('logs a rejection of onReauthenticationFailed and still disconnects', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const revalidate = jest.fn().mockResolvedValue(false)
    const realtime = mkRealtime()
    const hooks = { onReauthenticationFailed: jest.fn().mockRejectedValue(new Error('hook down')) }
    const svc = build(
      mkConnections([mkRecord()]),
      realtime,
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60 }),
      hooks,
    )

    await svc.runCycle()
    await flush()

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('onReauthenticationFailed hook failed: hook down')
    warn.mockRestore()
  })
})
