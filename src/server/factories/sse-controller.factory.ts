/**
 * @fileoverview Factory building a dynamic SSE controller bound to a configured path.
 * @layer transport
 */
import { randomUUID } from 'node:crypto'
import { Controller, Inject, Req, Res, Sse, UnauthorizedException } from '@nestjs/common'
import type { MessageEvent, Type } from '@nestjs/common'
import type { Request, Response } from 'express'
import { EMPTY, merge, of, Subject } from 'rxjs'
import type { Observable } from 'rxjs'
import { finalize, takeUntil } from 'rxjs/operators'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { RESERVED_EVENT_NAMES } from '../constants/reserved-events.constants'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
} from '../interfaces/connection-authenticator.interface'
import { SseTransport } from '../transports/sse/sse.transport'
import { HeartbeatService } from '../transports/sse/heartbeat.service'
import { parseCookieHeader } from '../utils/parse-cookie-header'

/** Coerce a possibly-multi-valued header to a single string. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Resolve the best-effort client IP, preferring `X-Forwarded-For`.
 *
 * NOTE: `X-Forwarded-For` is trusted verbatim and is therefore spoofable unless a
 * trusted reverse proxy sets it. Do not use the resolved IP for security decisions
 * (rate-limiting, block-lists) without validating the proxy chain.
 */
function resolveIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const candidate = (typeof forwarded === 'string' ? forwarded.split(',')[0] : undefined) ?? ''
  return candidate.trim() || req.ip || 'unknown'
}

/** Normalize header names to lowercase and flatten array values. */
function normalizeHeaders(headers: Request['headers']): Record<string, string | undefined> {
  const out = Object.create(null) as Record<string, string | undefined>
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : value
  }
  return out
}

/** Coerce Express's `ParsedQs` to flat string values (arrays/objects become undefined). */
function sanitizeQuery(query: Request['query']): Record<string, string | undefined> {
  const out = Object.create(null) as Record<string, string | undefined>
  for (const [key, value] of Object.entries(query)) {
    out[key] = typeof value === 'string' ? value : undefined
  }
  return out
}

/** Build the transport-agnostic auth context from the HTTP request. */
function buildAuthContext(req: Request): ConnectionAuthContext {
  const headers = normalizeHeaders(req.headers)
  // EventSource cannot send custom headers, so `authorization` is never a valid SSE
  // auth channel — strip it so a non-browser client cannot smuggle a bearer token.
  delete headers['authorization']
  return {
    cookies: parseCookieHeader(singleHeader(req.headers['cookie']) ?? ''),
    headers,
    query: sanitizeQuery(req.query),
    ip: resolveIp(req),
    userAgent: singleHeader(req.headers['user-agent']),
    transport: 'sse',
  }
}

/** Build the client-safe `connection:established` event (trait subset only). */
function buildEstablishedEvent(connectionId: string, auth: AuthenticationResult): MessageEvent {
  return {
    type: RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED,
    data: {
      connectionId,
      traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
    },
  }
}

/**
 * Build a dynamic NestJS controller bound to `endpoint`.
 *
 * NestJS evaluates `@Sse(path)` at class-decoration time, so a fresh class is
 * generated per module instantiation to keep the path configurable without global
 * mutable state. The stream is `merge(established, replay, subject)` torn down via
 * `takeUntil(close$)` + `finalize`; the heartbeat writes raw keepalive comments
 * directly to the response (`@Res({ passthrough: true })`). Compression-buster
 * headers are set so proxies do not buffer or transform `text/event-stream`.
 */
export function createSseController(endpoint: string): Type<unknown> {
  const ssePath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

  @Controller()
  class DynamicSseController {
    constructor(
      @Inject(SseTransport) private readonly transport: SseTransport,
      @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
    ) {}

    @Sse(ssePath)
    async subscribe(
      @Req() req: Request,
      @Res({ passthrough: true }) res: Response,
    ): Promise<Observable<MessageEvent>> {
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')

      const context = buildAuthContext(req)
      const auth = await this.transport.authenticate(context)
      if (!auth) throw new UnauthorizedException(REALTIME_ERROR_CODES.AUTH_FAILED)

      const connectionId = randomUUID()
      const subject = new Subject<MessageEvent>()
      const close$ = new Subject<void>()
      await this.transport.registerConnection({
        connectionId,
        auth,
        subject,
        close$,
        ip: context.ip,
        userAgent: context.userAgent,
      })

      this.heartbeat.start(connectionId, res, this.transport.heartbeatMs)

      const lastEventId = singleHeader(req.headers['last-event-id'])
      const replayEvents = lastEventId
        ? this.transport.getReplayEvents(auth.userId, lastEventId)
        : []
      const replay$ = replayEvents.length > 0 ? of(...replayEvents) : EMPTY
      const established$ = this.transport.emitConnectionEvent
        ? of(buildEstablishedEvent(connectionId, auth))
        : EMPTY

      return merge(established$, replay$, subject.asObservable()).pipe(
        takeUntil(close$),
        finalize(() => {
          void this.transport.unregisterConnection(connectionId)
        }),
      )
    }
  }

  return DynamicSseController
}
