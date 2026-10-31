/**
 * @fileoverview Unit tests for SseSubscriptionHandler — authenticating ahead of the route.
 * @layer transport
 *
 * Nest commits `200 text/event-stream` from a timer once an `@Sse()` route returns, so a
 * refusal that needs I/O must be decided before the route runs. The route guard calls
 * `authenticateBeforeCommit`; `handle` then reuses that outcome instead of authenticating twice.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import {
  HttpException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import {
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'
import type { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import { SseSubscriptionHandler } from './sse-subscription.handler'

describe('SseSubscriptionHandler — authenticateBeforeCommit', () => {
  // An authenticator that does real I/O before refusing still produces a 401, because the
  // refusal happens in the guard, ahead of the response.
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

  // An infrastructure failure inside the authenticator is not turned into a refusal: the guard
  // rejects with a generic 500, and the detail goes to the server log, not to the client.
  it('rejects with a generic 500 when an authenticator throws after I/O, and logs the detail', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const authenticate = jest.fn(async () => {
        await sleep(5)
        throw new Error('connect ECONNREFUSED 10.20.30.40:6379')
      })
      const handler = build(mkTransport({ authenticate }), mkHeartbeat(), mkOptions())

      const thrown = await handler.authenticateBeforeCommit(mkReq()).catch((err: unknown) => err)

      expect(thrown).toBeInstanceOf(InternalServerErrorException)
      expect(JSON.stringify((thrown as InternalServerErrorException).getResponse())).not.toContain(
        '10.20.30.40',
      )
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('10.20.30.40'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  // An HTTP exception the authenticator throws on purpose (a rate limit, say) is the consumer's
  // answer and reaches the client unchanged.
  it('lets an HttpException from the authenticator through unchanged', async () => {
    const limit = new HttpException('slow down', 429)
    const handler = build(
      mkTransport({ authenticate: jest.fn().mockRejectedValue(limit) }),
      mkHeartbeat(),
      mkOptions(),
    )

    await expect(handler.authenticateBeforeCommit(mkReq())).rejects.toBe(limit)
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBe(limit)
  })

  // Past authentication nothing is the consumer's deliberate answer any more: even an
  // HttpException from the offline-queue storage, with an internal message, becomes a generic 500.
  it('turns an HttpException from the offline-queue read into a generic 500', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const offlineDelivery = {
        retrieve: jest
          .fn()
          .mockRejectedValue(new HttpException('cache 10.20.30.40:6379 down', 503)),
        acknowledge: jest.fn(),
      } as unknown as OfflineQueueDeliveryService
      const handler = new SseSubscriptionHandler(
        mkTransport(),
        mkHeartbeat(),
        mkOptions(),
        undefined,
        offlineDelivery,
      )

      const thrown = await handler
        .handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
        .catch((err: unknown) => err)

      expect(thrown).toBeInstanceOf(InternalServerErrorException)
      expect(JSON.stringify((thrown as InternalServerErrorException).getResponse())).not.toContain(
        '10.20.30.40',
      )
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('10.20.30.40'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  // A rejection that is not an Error (a bare null, say) must not make the logging throw.
  it('answers a generic 500 for a rejection that is not an Error', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const handler = build(
        mkTransport({ authenticate: jest.fn().mockRejectedValue(null) }),
        mkHeartbeat(),
        mkOptions(),
      )

      await expect(handler.authenticateBeforeCommit(mkReq())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      )
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('null'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  // Past authentication, a failure of another dependency (the offline queue read) after I/O
  // must not carry its message either: it answers a generic 500 and is logged.
  it('answers a generic 500 when the offline-queue read fails after the guard', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const offlineDelivery = {
        retrieve: jest.fn(async () => {
          await sleep(5)
          throw new Error('connect ECONNREFUSED 10.20.30.40:6379')
        }),
        acknowledge: jest.fn(),
      } as unknown as OfflineQueueDeliveryService
      const handler = new SseSubscriptionHandler(
        mkTransport(),
        mkHeartbeat(),
        mkOptions(),
        undefined,
        offlineDelivery,
      )

      const thrown = await handler
        .handle(mkReq({ headers: { 'last-event-id': '0' } }), mkRes())
        .catch((err: unknown) => err)

      expect(thrown).toBeInstanceOf(InternalServerErrorException)
      expect(JSON.stringify((thrown as InternalServerErrorException).getResponse())).not.toContain(
        '10.20.30.40',
      )
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('10.20.30.40'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  // A blank identity is a 500 with the reason in the log, decided before the response starts.
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
