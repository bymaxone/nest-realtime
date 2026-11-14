/**
 * @fileoverview SseSubscriptionHandler holds a place for a connection from before it is
 * authenticated, and gives it back however the handshake ends.
 * @layer transport
 */
import { EventEmitter } from 'node:events'
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
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
  const transport = mkTransport({ authenticate, admit: () => admission.admit() })
  return { admission, authenticate, handler: build(transport, mkHeartbeat(), mkOptions()) }
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
})
