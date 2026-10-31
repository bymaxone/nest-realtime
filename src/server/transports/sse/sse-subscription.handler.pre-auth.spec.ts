/**
 * @fileoverview Unit tests for SseSubscriptionHandler — authenticating ahead of the route.
 * @layer transport
 *
 * Nest commits `200 text/event-stream` from a timer once an `@Sse()` route returns, so a
 * refusal that needs I/O must be decided before the route runs. The route guard calls
 * `authenticateBeforeCommit`; `handle` then reuses that outcome instead of authenticating twice.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common'
import {
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'

describe('SseSubscriptionHandler — authenticateBeforeCommit', () => {
  // An authenticator that does real I/O before refusing still produces a 401, because the
  // refusal now happens in the guard, ahead of the response.
  it('refuses with a 401 after the authenticator awaited I/O', async () => {
    const authenticate = jest.fn(async () => {
      await sleep(5)
      return null
    })
    const handler = build(mkTransport({ authenticate }), mkHeartbeat(), mkOptions())

    await expect(handler.authenticateBeforeCommit(mkReq())).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  // An infrastructure failure inside the authenticator is not turned into a refusal or hidden:
  // the guard rejects with it, and Nest answers with a 5xx.
  it('rejects with the error an authenticator throws after I/O', async () => {
    const failure = new Error('session store unreachable')
    const authenticate = jest.fn(async () => {
      await sleep(5)
      throw failure
    })
    const handler = build(mkTransport({ authenticate }), mkHeartbeat(), mkOptions())

    await expect(handler.authenticateBeforeCommit(mkReq())).rejects.toBe(failure)
  })

  // A blank identity stays a 500 with the reason in the log, now before the response starts.
  it('refuses a blank identity with a generic 500', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const transport = mkTransport({ authenticate: jest.fn().mockResolvedValue({ userId: '' }) })
      const handler = build(transport, mkHeartbeat(), mkOptions())

      await expect(handler.authenticateBeforeCommit(mkReq())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      )
      expect(transport.registerConnection).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  // The authenticator runs once per connection: `handle` takes the guard's outcome.
  it('lets handle reuse the outcome, so authenticate runs once', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const req = mkReq()

    await handler.authenticateBeforeCommit(req)
    await handler.handle(req, mkRes())

    expect(transport.authenticate).toHaveBeenCalledTimes(1)
  })

  // Called without the guard (a direct use of the handler), `handle` still authenticates.
  it('authenticates inside handle when the guard did not run', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())

    await handler.handle(mkReq(), mkRes())

    expect(transport.authenticate).toHaveBeenCalledTimes(1)
  })

  // The outcome is for one `handle` call: a later call on the same request object authenticates
  // again, so a stale identity is never reused.
  it('uses the guard outcome for one handle call only', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const req = mkReq()

    await handler.authenticateBeforeCommit(req)
    await handler.handle(req, mkRes())
    await handler.handle(req, mkRes())

    expect(transport.authenticate).toHaveBeenCalledTimes(2)
  })

  // Another request's outcome is never picked up.
  it('does not hand one request the outcome of another', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())

    await handler.authenticateBeforeCommit(mkReq())
    await handler.handle(mkReq(), mkRes())

    expect(transport.authenticate).toHaveBeenCalledTimes(2)
  })
})
