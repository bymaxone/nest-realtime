/**
 * @fileoverview Unit tests for `onConnectFailure` on the SSE stream.
 * @layer transport
 *
 * By default a failing `onConnect` is logged and the stream stays open. With `onConnectFailure:
 * 'close'` the stream ends, so a host whose `onConnect` does work the connection depends on never
 * serves a connection that work did not reach. Shared builders: `test/fixtures/sse/subscription-harness.ts`.
 */
import { Logger } from '@nestjs/common'
import {
  build,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  mkTransport,
} from '../../../../test/fixtures/sse/subscription-harness'

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('SseSubscriptionHandler — onConnectFailure', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => warn.mockRestore())

  async function open(
    onConnect: () => void | Promise<void>,
    onConnectFailure?: 'ignore' | 'close',
  ): Promise<{ closed: () => boolean; completed: () => boolean; stopped: jest.Mock }> {
    const heartbeat = mkHeartbeat()
    const handler = build(
      mkTransport(),
      heartbeat,
      mkOptions(onConnectFailure === undefined ? {} : { onConnectFailure }),
      { onConnect },
    )
    let completed = false
    const sub = (await handler.handle(mkReq(), mkRes())).subscribe({
      complete: () => void (completed = true),
    })
    await settle()
    return {
      closed: () => sub.closed,
      completed: () => completed,
      stopped: heartbeat.stop as jest.Mock,
    }
  }

  // The default is the documented best-effort behaviour: nothing changes unless the host opts in.
  it.each([
    ['unset', undefined],
    ["'ignore'", 'ignore' as const],
  ])('keeps the stream open when onConnect fails and the option is %s', async (_label, option) => {
    const run = await open(async () => Promise.reject(new Error('presence store down')), option)
    expect(run.closed()).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Lifecycle hook failed: presence store down' }),
    )
  })

  // A rejection and a synchronous throw are the same failure.
  it.each([
    ['rejects', async () => Promise.reject(new Error('presence store down'))],
    [
      'throws',
      () => {
        throw new Error('presence store down')
      },
    ],
  ])("ends the stream when onConnect %s and the option is 'close'", async (_label, onConnect) => {
    const run = await open(onConnect, 'close')
    expect(run.completed()).toBe(true)
    expect(run.closed()).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Lifecycle hook failed: presence store down' }),
    )
  })

  // The option says what a failure does; a hook that succeeds leaves the stream alone.
  it("keeps the stream open when onConnect succeeds and the option is 'close'", async () => {
    const run = await open(async () => undefined, 'close')
    expect(run.closed()).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})
