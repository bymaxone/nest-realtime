/**
 * @fileoverview A reconnect whose offline-queue read does not answer is refused with a 503 at the
 * bound, and registers nothing.
 * @layer transport
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
} from '../../../../test/fixtures/sse/subscription-harness'
import { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import { SseSubscriptionHandler } from './sse-subscription.handler'

/** A handler over a real delivery service whose queue never answers a read. */
function setup(authenticateTimeoutMs = 1_000) {
  const release = jest.fn()
  const registerConnection = jest.fn().mockResolvedValue(undefined)
  const transport = mkTransport({
    registerConnection,
    admit: () => ({ release, renew: jest.fn() }),
  })
  const retrieveSince = jest.fn(() => new Promise<never[]>(() => undefined))
  const options = mkOptions({ authenticateTimeoutMs })
  const delivery = new OfflineQueueDeliveryService(
    { retrieveSince, acknowledge: jest.fn(), append: jest.fn() },
    undefined,
    options,
  )
  const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), options, undefined, delivery)
  return { handler, registerConnection, release, retrieveSince }
}

describe('SseSubscriptionHandler: a reconnect whose offline queue does not answer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('is refused with a 503 at the bound, registers nothing, and gives its place back', async () => {
    const { handler, registerConnection, release, retrieveSince } = setup(1_000)
    const outcome = handler.handle(mkReq({ headers: { 'last-event-id': 'e-1' } }), mkRes()).then(
      () => 'opened',
      (error: unknown) => error,
    )

    await jest.advanceTimersByTimeAsync(999)
    expect(retrieveSince).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)

    expect(await outcome).toBeInstanceOf(ServiceUnavailableException)
    expect(registerConnection).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('answers the generic 503 body, with nothing about the queue in it', async () => {
    const { handler } = setup(1_000)
    const outcome = handler
      .handle(mkReq({ headers: { 'last-event-id': 'e-1' } }), mkRes())
      .catch((error: ServiceUnavailableException) => error)
    await jest.advanceTimersByTimeAsync(1_000)

    const error = (await outcome) as ServiceUnavailableException

    expect(JSON.stringify(error.getResponse())).not.toMatch(/queue|offline|ms/i)
  })

  it('does not wait on a queue for a request that carries no Last-Event-ID', async () => {
    const { handler, retrieveSince } = setup(1_000)

    const stream = await handler.handle(mkReq(), mkRes())

    expect(stream).toBeDefined()
    expect(retrieveSince).not.toHaveBeenCalled()
  })
})
