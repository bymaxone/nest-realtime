/**
 * @fileoverview The adapter's publish-failure report writes what is waiting when it is disposed.
 * @layer transport
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { RealtimeIoAdapter } from './realtime-io-adapter'

describe('RealtimeIoAdapter publish-failure report', () => {
  // Scenario: three publishes rejected inside one window, then the application closes.
  // Expected: the two folded ones are written when the adapter is disposed.
  it('writes the tail of a burst at dispose', async () => {
    jest.useFakeTimers()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const adapter = new RealtimeIoAdapter({ get: () => undefined } as never)
    for (let i = 0; i < 3; i++) adapter['publishFailed'](new Error('refused'))

    await adapter.dispose()

    expect(warn.mock.calls.map((call) => (call[0] as { count: number }).count)).toEqual([1, 2])
    jest.useRealTimers()
    warn.mockRestore()
  })
})
