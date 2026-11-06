/**
 * @fileoverview Unit tests for SseSubscriptionHandler — refusing a stream once shutdown has begun.
 * @layer transport
 *
 * The HTTP server does not finish closing while a response is open, so a stream opened after the
 * transport tore its streams down would keep the application from closing. The handshake answers
 * 503 instead, before it authenticates and again once authentication has finished, since that
 * can take long enough for shutdown to begin in between.
 */
import { ServiceUnavailableException } from '@nestjs/common'
import {
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'

describe('SseSubscriptionHandler — shutdown', () => {
  // Shutdown has begun before the request arrives: refused before any work is done for it.
  it('refuses with a 503 before authenticating when shutdown has already begun', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const handler = build(
      mkTransport({ authenticate, shuttingDown: true }),
      mkHeartbeat(),
      mkOptions(),
    )

    const thrown = await handler.handle(mkReq(), mkRes()).catch((err: unknown) => err)

    expect(thrown).toBeInstanceOf(ServiceUnavailableException)
    expect((thrown as ServiceUnavailableException).message).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect((thrown as ServiceUnavailableException).getStatus()).toBe(503)
    expect(authenticate).not.toHaveBeenCalled()
  })

  // Shutdown begins while the request waits on the authenticator: refused once that has finished.
  it('refuses with a 503 when shutdown begins while the request authenticates', async () => {
    const transport = mkTransport({ shuttingDown: false })
    const authenticate = jest.fn(async () => {
      Object.defineProperty(transport, 'shuttingDown', { value: true })
      return { userId: 'u1' }
    })
    Object.defineProperty(transport, 'authenticate', { value: authenticate })
    const handler = build(transport, mkHeartbeat(), mkOptions())

    const thrown = await handler.handle(mkReq(), mkRes()).catch((err: unknown) => err)

    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(thrown).toBeInstanceOf(ServiceUnavailableException)
    expect((thrown as ServiceUnavailableException).message).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })

  // The refusal is not a handshake failure: it is not turned into the generic 500.
  it('does not answer a 500 for the refusal', async () => {
    const handler = build(mkTransport({ shuttingDown: true }), mkHeartbeat(), mkOptions())

    const thrown = await handler.handle(mkReq(), mkRes()).catch((err: unknown) => err)

    expect((thrown as ServiceUnavailableException).getStatus()).not.toBe(500)
  })

  // The stream is only registered when it is subscribed, after the handshake returned it. If shutdown
  // began in between, the teardown's snapshot of the connections was taken without it, so nothing
  // would end it: it completes at once, before it registers or emits anything.
  it('completes a stream at once when shutdown began after the handshake returned it', async () => {
    const transport = mkTransport({ shuttingDown: false })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    Object.defineProperty(transport, 'shuttingDown', { value: true })
    const events: unknown[] = []
    let completed = false

    stream.subscribe({ next: (event) => events.push(event), complete: () => (completed = true) })
    await Promise.resolve()

    expect(completed).toBe(true)
    expect(events).toEqual([])
    expect(transport.registerConnection).not.toHaveBeenCalled()
  })

  // Outside shutdown the handshake is unchanged.
  it('opens the stream when shutdown has not begun', async () => {
    const handler = build(mkTransport({ shuttingDown: false }), mkHeartbeat(), mkOptions())

    await expect(handler.handle(mkReq(), mkRes())).resolves.toBeDefined()
  })
})
