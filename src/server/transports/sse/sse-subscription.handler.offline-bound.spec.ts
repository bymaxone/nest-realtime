/**
 * @fileoverview A reconnect whose offline-queue read does not answer is refused with a 503 at the
 * bound, and registers nothing.
 * @layer transport
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  collect,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
} from '../../../../test/fixtures/sse/subscription-harness'
import { AuthenticationGate } from '../../services/authentication-gate.service'
import { ConnectionAdmission } from '../../services/connection-admission.service'
import { ConnectionRegistry } from '../../services/connection-registry.service'
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

  // Each wait is within its own bound, and together they outlast the time a place is held for
  // (authenticateTimeoutMs + 5,000 ms = 15,000 ms by default): the place is taken again at registration.
  describe('a slow authentication and a slow offline-queue read that together outlast the hold', () => {
    /** A handler whose authenticator and offline queue each answer after 9,000 ms. */
    function slowBoth() {
      const registry = new ConnectionRegistry()
      const options = mkOptions()
      const admission = new ConnectionAdmission({ ...options, maxConnections: 1 }, registry)
      const gate = new AuthenticationGate(options, {
        authenticate: () =>
          new Promise((resolve) => setTimeout(() => resolve({ userId: 'u1' }), 9_000)),
      })
      const registerConnection = jest.fn().mockResolvedValue(undefined)
      const transport = mkTransport({
        registerConnection,
        admit: () => admission.admit(),
        authenticate: (ctx: never) => gate.authenticate(ctx),
      })
      const delivery = new OfflineQueueDeliveryService(
        {
          // The first read, in the guard, is the slow one; the read when the stream is built is not.
          retrieveSince: jest
            .fn()
            .mockImplementationOnce(
              () => new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 9_000)),
            )
            .mockResolvedValue([]),
          acknowledge: jest.fn(),
          append: jest.fn(),
        },
        undefined,
        options,
      )
      const handler = new SseSubscriptionHandler(
        transport,
        mkHeartbeat(),
        options,
        undefined,
        delivery,
      )
      return { admission, handler, registerConnection }
    }

    async function guardThrough(handler: SseSubscriptionHandler, between: () => void) {
      const req = mkReq({ headers: { 'last-event-id': 'e-1' } })
      const res = mkRes()
      const guarded = handler.authenticateBeforeCommit(req, res)
      await jest.advanceTimersByTimeAsync(16_000)
      between()
      await jest.advanceTimersByTimeAsync(2_000)
      await guarded
      return handler.handle(req, res)
    }

    it('is refused, and registers nothing, when another request took the place meanwhile', async () => {
      const { admission, handler, registerConnection } = slowBoth()
      const stream = await guardThrough(handler, () => void admission.admit())

      const error = await new Promise<unknown>((resolve) =>
        stream.subscribe({ error: resolve, complete: () => resolve(undefined) }),
      )

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(registerConnection).not.toHaveBeenCalled()
    })

    it('registers once, and holds no place after the registry has it, when nobody took the place', async () => {
      const { admission, handler, registerConnection } = slowBoth()
      const stream = await guardThrough(handler, () => undefined)

      stream.subscribe({ error: () => undefined })

      expect(registerConnection).toHaveBeenCalledTimes(1)
      expect(() => admission.admit()).not.toThrow()
    })
  })

  // The read when the stream is built adds what was appended since the guard read, and a failure of
  // it ends the attempt before anything is delivered.
  describe('the read of what was appended since', () => {
    function withTwoReads(second: () => Promise<never[]>) {
      const release = jest.fn()
      const registerConnection = jest.fn().mockResolvedValue(undefined)
      const transport = mkTransport({
        registerConnection,
        emitConnectionEvent: false,
        admit: () => ({ release, renew: jest.fn() }),
      })
      const at = (id: string) => ({ id, event: 'evt', data: {}, emittedAt: new Date() })
      const retrieveSince = jest
        .fn()
        .mockResolvedValueOnce([at('q-1')])
        .mockImplementation(second)
      const delivery = new OfflineQueueDeliveryService(
        { retrieveSince, acknowledge: jest.fn(), append: jest.fn() },
        undefined,
        mkOptions({ authenticateTimeoutMs: 1_000 }),
      )
      const handler = new SseSubscriptionHandler(
        transport,
        mkHeartbeat(),
        mkOptions(),
        undefined,
        delivery,
      )
      return { handler, release, registerConnection, retrieveSince }
    }
    const reconnect = () => mkReq({ headers: { 'last-event-id': 'q-0' } })

    it('delivers the first read, then what was appended, in queue order', async () => {
      const appended = [{ id: 'q-2', event: 'evt', data: {}, emittedAt: new Date() }]
      const { handler, retrieveSince } = withTwoReads(async () => appended as never[])

      const stream = await handler.handle(reconnect(), mkRes())

      expect(collect(stream).map((e) => e.id)).toEqual(['q-1', 'q-2'])
      expect(retrieveSince).toHaveBeenNthCalledWith(1, 'u1', 'q-0', 200)
      expect(retrieveSince).toHaveBeenNthCalledWith(2, 'u1', 'q-1', 199)
    })

    it('ends the attempt with a 503, delivering and registering nothing, when it does not answer', async () => {
      const { handler, release, registerConnection } = withTwoReads(
        () => new Promise(() => undefined),
      )
      const outcome = handler.handle(reconnect(), mkRes()).catch((error: unknown) => error)

      await jest.advanceTimersByTimeAsync(1_000)

      expect(await outcome).toBeInstanceOf(ServiceUnavailableException)
      expect(registerConnection).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalledTimes(1)
    })

    // An outage of the store is not a reason to refuse every reconnect: the first read has already
    // answered an empty gap for it, and the second answers no extra events.
    it('delivers the first read, and ends no attempt, when the store fails the second read', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const { handler, registerConnection } = withTwoReads(() =>
        Promise.reject(new Error('redis down')),
      )

      const stream = await handler.handle(reconnect(), mkRes())

      expect(collect(stream).map((e) => e.id)).toEqual(['q-1'])
      expect(registerConnection).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'))
      warn.mockRestore()
    })
  })
})
