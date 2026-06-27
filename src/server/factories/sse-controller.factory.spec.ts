/**
 * @fileoverview Unit tests for the dynamic SSE controller factory.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { Subject } from 'rxjs'
import type { SseSubscriptionHandler } from '../transports/sse/sse-subscription.handler'
import { createSseController } from './sse-controller.factory'

interface SseControllerInstance {
  subscribe(req: Request, res: Response): Promise<Observable<MessageEvent>>
}

function mkHandler(
  result: Observable<MessageEvent> = new Subject<MessageEvent>().asObservable(),
): SseSubscriptionHandler {
  return { handle: jest.fn().mockResolvedValue(result) } as unknown as SseSubscriptionHandler
}

function mkReq(): Request {
  return { headers: {}, query: {} } as unknown as Request
}

function mkRes(): Response {
  return { setHeader: jest.fn() } as unknown as Response
}

function build(handler: SseSubscriptionHandler, endpoint: string): SseControllerInstance {
  const ControllerClass = createSseController(endpoint)
  return new ControllerClass(handler) as unknown as SseControllerInstance
}

describe('createSseController', () => {
  // The controller delegates every request to SseSubscriptionHandler.handle.
  it('delegates the request to the handler', async () => {
    const handler = mkHandler()
    const req = mkReq()
    const res = mkRes()
    await build(handler, '/events').subscribe(req, res)
    expect(handler.handle).toHaveBeenCalledWith(req, res)
  })

  // The factory itself must NOT set response headers — SseSubscriptionHandler owns that.
  it('does not set response headers directly (handler owns Cache-Control and X-Accel-Buffering)', async () => {
    const handler = mkHandler()
    const req = mkReq()
    const res = mkRes()
    await build(handler, '/events').subscribe(req, res)
    expect(res.setHeader).not.toHaveBeenCalled()
  })

  // The controller returns whatever the handler resolves to.
  it('returns the Observable returned by the handler', async () => {
    const subject = new Subject<MessageEvent>()
    const observable = subject.asObservable()
    const handler = mkHandler(observable)
    const result = await build(handler, '/events').subscribe(mkReq(), mkRes())
    expect(result).toBe(observable)
  })

  // A leading slash in the endpoint is stripped (NestJS @Sse() does not expect one).
  it('strips a leading slash from the endpoint', async () => {
    const handler = mkHandler()
    await expect(build(handler, '/realtime/sse').subscribe(mkReq(), mkRes())).resolves.toBeDefined()
  })

  // An endpoint without a leading slash is used verbatim.
  it('accepts an endpoint without a leading slash', async () => {
    const handler = mkHandler()
    await expect(build(handler, 'realtime/sse').subscribe(mkReq(), mkRes())).resolves.toBeDefined()
  })
})
