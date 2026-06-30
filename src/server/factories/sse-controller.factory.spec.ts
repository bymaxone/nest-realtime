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

  // The @Sse path metadata is stored WITHOUT the leading slash — NestJS resolves '/events'
  // and 'events' identically via the decorator, so the strip logic is an intentional
  // normalization. Verifying the metadata kills mutations to the startsWith branch or slice.
  it('registers the @Sse route with the leading slash removed', () => {
    const cls = createSseController('/events')
    const path = Reflect.getMetadata('path', cls.prototype.subscribe) as string
    expect(path).toBe('events')
  })

  it('registers the @Sse route verbatim when endpoint has no leading slash', () => {
    const cls = createSseController('realtime/sse')
    const path = Reflect.getMetadata('path', cls.prototype.subscribe) as string
    expect(path).toBe('realtime/sse')
  })

  it('registers a different path for each factory call (no shared state)', () => {
    const cls1 = createSseController('/stream-a')
    const cls2 = createSseController('/stream-b')
    const path1 = Reflect.getMetadata('path', cls1.prototype.subscribe) as string
    const path2 = Reflect.getMetadata('path', cls2.prototype.subscribe) as string
    expect(path1).toBe('stream-a')
    expect(path2).toBe('stream-b')
  })
})
