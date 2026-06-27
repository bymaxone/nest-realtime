/**
 * @fileoverview Factory building a dynamic SSE controller bound to a configured path.
 * @layer transport
 */
import { Controller, Req, Res, Sse } from '@nestjs/common'
import type { MessageEvent, Type } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import type { SseSubscriptionHandler } from '../transports/sse/sse-subscription.handler'

/**
 * Build a dynamic NestJS controller bound to `endpoint`.
 *
 * NestJS evaluates `@Sse(path)` at class-decoration time, so a fresh class is
 * generated per module instantiation to keep the path configurable without global
 * mutable state. The controller is a thin shell: every request is delegated to
 * `SseSubscriptionHandler.handle`, which owns the full subscribe lifecycle.
 */
export function createSseController(endpoint: string): Type<unknown> {
  const ssePath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

  @Controller()
  class DynamicSseController {
    constructor(private readonly handler: SseSubscriptionHandler) {}

    @Sse(ssePath)
    subscribe(
      @Req() req: Request,
      @Res({ passthrough: true }) res: Response,
    ): Promise<Observable<MessageEvent>> {
      return this.handler.handle(req, res)
    }
  }

  return DynamicSseController
}
