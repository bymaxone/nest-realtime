/**
 * @fileoverview SseSubscriptionHandler holds a place for a connection from before it is
 * authenticated, and gives it back however the handshake ends.
 * @layer transport
 */
import { EventEmitter } from 'node:events'
import {
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'
import {
  ConnectionAdmission,
  ConnectionLimitError,
} from '../../services/connection-admission.service'
import { AuthenticationGate } from '../../services/authentication-gate.service'
import { ConnectionRegistry } from '../../services/connection-registry.service'

/** A response that lets the test end it, as a client leaving would. */
function mkClosableRes() {
  let onClose: (() => void) | undefined
  const res = {
    setHeader: jest.fn(),
    write: jest.fn(),
    once: jest.fn((_event: string, listener: () => void) => {
      onClose = listener
    }),
  }
  return { res: res as unknown as Response, close: () => onClose?.() }
}

function setup(
  maxConnections: number,
  authenticate = jest.fn().mockResolvedValue({ userId: 'u1' }),
) {
  const admission = new ConnectionAdmission(
    { transport: 'sse', authenticator: { authenticate: async () => null }, maxConnections },
    new ConnectionRegistry(),
  )
  const registerConnection = jest.fn().mockResolvedValue(undefined)
  const transport = mkTransport({
    authenticate,
    registerConnection,
    admit: () => admission.admit(),
  })
  return {
    admission,
    authenticate,
    registerConnection,
    handler: build(transport, mkHeartbeat(), mkOptions()),
  }
}

describe('SseSubscriptionHandler: the place held for a connection', () => {
  // A request that passes the guard and then dies never reaches registration: its place must not
  // stay taken, or enough of them lock every real client out.
  it('gives the place back when the response closes between the guard and registration', async () => {
    const { admission, handler } = setup(1)
    const { res, close } = mkClosableRes()
    await handler.authenticateBeforeCommit(mkReq(), res)
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    close()

    expect(() => admission.admit()).not.toThrow()
  })

  it('refuses with a 503 and does not ask the authenticator when the instance is full', async () => {
    const { admission, authenticate, handler } = setup(1)
    admission.admit()

    await expect(
      handler.authenticateBeforeCommit(mkReq(), mkClosableRes().res),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('gives the place back when the authenticator refuses the credentials', async () => {
    const { admission, handler } = setup(1, jest.fn().mockResolvedValue(null))

    await expect(
      handler.authenticateBeforeCommit(mkReq(), mkClosableRes().res),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    expect(() => admission.admit()).not.toThrow()
  })

  it('gives the place back when the authenticator throws', async () => {
    const { admission, handler } = setup(1, jest.fn().mockRejectedValue(new Error('down')))

    await expect(
      handler.authenticateBeforeCommit(mkReq(), mkClosableRes().res),
    ).rejects.toBeDefined()

    expect(() => admission.admit()).not.toThrow()
  })

  // Fastify hands the handler a reply, which has no `once`; the Node response is its `raw`.
  it('gives the place back when the Node response behind a Fastify-style reply closes', async () => {
    const { admission, handler } = setup(1)
    const raw = new EventEmitter()
    const reply = { setHeader: jest.fn(), write: jest.fn(), raw } as unknown as Response
    await handler.authenticateBeforeCommit(mkReq(), reply)
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    raw.emit('close')

    expect(() => admission.admit()).not.toThrow()
  })

  describe('a response that offers no close signal at all', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    // Nothing reports the request dying, so only the time bound can give its place back.
    it('has its place given back after authenticateTimeoutMs and a margin', async () => {
      const { admission, handler } = setup(1)
      const bare = { setHeader: jest.fn(), write: jest.fn() } as unknown as Response
      await handler.authenticateBeforeCommit(mkReq(), bare)

      jest.advanceTimersByTime(14_999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      jest.advanceTimersByTime(1)

      expect(() => admission.admit()).not.toThrow()
    })
  })

  describe('registration, once the handshake has been admitted', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    // The offline-queue read before registration has no bound: a handshake can outlive its place,
    // which another request then takes. It must not register past the limit.
    it('ends the stream with a 503, and registers nothing, when its place was given back and taken', async () => {
      const { admission, handler, registerConnection } = setup(1)
      const { res } = mkClosableRes()
      const req = mkReq()
      await handler.authenticateBeforeCommit(req, res)
      jest.advanceTimersByTime(15_000)
      admission.admit()
      const stream = await handler.handle(req, res)

      const error = await new Promise<unknown>((resolve) =>
        stream.subscribe({ error: resolve, complete: () => resolve(undefined) }),
      )

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(registerConnection).not.toHaveBeenCalled()
    })

    // The registry holds a connection from the moment registration is called, so a place held for
    // the rest of it would count the connection twice, and a burst would be refused at half capacity.
    it('gives the place back as registration begins, not when it ends', async () => {
      const { admission, handler, registerConnection } = setup(1)
      registerConnection.mockReturnValue(new Promise<void>(() => undefined))
      const { res } = mkClosableRes()
      const req = mkReq()
      await handler.authenticateBeforeCommit(req, res)
      const stream = await handler.handle(req, res)

      stream.subscribe({ error: () => undefined })

      expect(registerConnection).toHaveBeenCalledTimes(1)
      expect(() => admission.admit()).not.toThrow()
    })
  })

  // Only a ConnectionLimitError is expected from taking the place again; anything else is a fault of
  // ours and is a generic 500 with the detail in the log, as every other fault is.
  it('answers a generic 500, and logs the cause, when taking the place again fails for another reason', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const transport = mkTransport({
      admit: () => ({
        release: jest.fn(),
        renew: () => {
          throw new Error('broken')
        },
      }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const { res } = mkClosableRes()
    const req = mkReq()
    await handler.authenticateBeforeCommit(req, res)
    const stream = await handler.handle(req, res)

    const failure = await new Promise<unknown>((resolve) =>
      stream.subscribe({ error: resolve, complete: () => resolve(undefined) }),
    )

    expect(failure).toBeInstanceOf(InternalServerErrorException)
    expect(error).toHaveBeenCalledWith('SSE registration refused — responding 500: broken')
    error.mockRestore()
  })

  // The authenticator is the one wait before registration that the library bounds: the gate gives up
  // on it at authenticateTimeoutMs, which is less than the time a place is held for, so a place can
  // never be reclaimed under a handshake that is still waiting for it.
  describe('an authenticator that never answers', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('keeps the place until the gate gives up, and gives it back then', async () => {
      const admission = new ConnectionAdmission(
        {
          transport: 'sse',
          authenticator: { authenticate: async () => null },
          maxConnections: 1,
          authenticateTimeoutMs: 1_000,
        },
        new ConnectionRegistry(),
      )
      const gate = new AuthenticationGate(
        {
          transport: 'sse',
          authenticateTimeoutMs: 1_000,
          authenticator: { authenticate: async () => null },
        },
        { authenticate: () => new Promise(() => undefined) },
      )
      const handler = build(
        mkTransport({
          admit: () => admission.admit(),
          authenticate: (ctx: never) => gate.authenticate(ctx),
        }),
        mkHeartbeat(),
        mkOptions(),
      )
      const refused = handler
        .authenticateBeforeCommit(mkReq(), mkClosableRes().res)
        .catch((e: unknown) => e)

      jest.advanceTimersByTime(999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      jest.advanceTimersByTime(1)

      expect(await refused).toBeInstanceOf(ServiceUnavailableException)
      expect(() => admission.admit()).not.toThrow()
    })
  })
})
