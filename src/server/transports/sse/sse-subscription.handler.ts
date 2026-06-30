/**
 * @fileoverview Injectable handler owning the full SSE subscribe flow.
 * @layer transport
 */
import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request, Response } from 'express'
import { EMPTY, merge, Observable, of, Subject } from 'rxjs'
import { catchError, finalize, takeUntil } from 'rxjs/operators'
import { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import type { OfflineQueuedEvent } from '../../interfaces/offline-queue-storage.interface'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import {
  DEFAULT_HEARTBEAT_MS,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../../constants/injection-tokens.constants'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
} from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { parseCookieHeader } from '../../utils/parse-cookie-header'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { SseTransport } from './sse.transport'
import { HeartbeatService } from './heartbeat.service'

/** Coerce a possibly-multi-valued header to a single string. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Resolve the best-effort client IP, preferring `X-Forwarded-For`.
 *
 * `X-Forwarded-For` is trusted verbatim and is spoofable unless a trusted reverse
 * proxy sets it. Do not use the resolved IP for security decisions without validating
 * the proxy chain.
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
  // EventSource cannot send custom headers — `authorization` is never a valid SSE
  // auth channel. Strip it so a non-browser client cannot smuggle a bearer token.
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

/** Build `ConnectionEventMeta` from a registered connection record. */
function buildMeta(record: ConnectionRecord) {
  return {
    connectionId: record.connectionId,
    userId: record.userId,
    tenantId: record.tenantId,
    transport: 'sse' as const,
    ip: record.ip,
    userAgent: record.userAgent,
    connectedAt: record.connectedAt,
  }
}

/** Parameters forwarded from `handle()` into `buildStream()`. */
interface StreamParams {
  connectionId: string
  resolvedAuth: AuthenticationResult
  ip: string
  userAgent: string | undefined
  res: Response
  subject: Subject<MessageEvent>
  close$: Subject<void>
  established$: Observable<MessageEvent>
  replay$: Observable<MessageEvent>
  queueReplay$: Observable<MessageEvent>
}

/**
 * Owns the complete SSE subscribe flow: auth context → authenticate →
 * register (transport handles FIFO eviction) → onConnect → heartbeat → replay → merged stream with teardown.
 *
 * The factory produces a thin `@Controller` shell that delegates every request here,
 * keeping the controller itself free of business logic and independently testable.
 * Lifecycle hooks are invoked best-effort so a throwing hook never disrupts delivery.
 */
@Injectable()
export class SseSubscriptionHandler {
  private readonly logger = new Logger(SseSubscriptionHandler.name)

  constructor(
    @Inject(SseTransport) private readonly transport: SseTransport,
    @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
    // Optional so the handler can be unit-constructed in isolation; the module always registers it.
    @Optional()
    @Inject(OfflineQueueDeliveryService)
    private readonly offlineDelivery?: OfflineQueueDeliveryService,
  ) {}

  /**
   * Handle an incoming SSE connection request end-to-end.
   *
   * Sets anti-buffering headers, authenticates the request, captures the offline-gap
   * before exposing the connection, then returns an Observable whose subscriber callback
   * wires the downstream listener BEFORE calling `registerConnection` — so a plain
   * `Subject` suffices and the replay buffer cannot grow unboundedly.
   *
   * @param req - The Express request (SSE GET).
   * @param res - The Express response (passthrough for header mutations and heartbeat writes).
   * @returns An Observable of `MessageEvent` values for NestJS `@Sse` to stream.
   * @throws UnauthorizedException when authentication returns null.
   */
  async handle(req: Request, res: Response): Promise<Observable<MessageEvent>> {
    // Anti-buffering headers must be sent before the first byte.
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')

    // Build the auth context; the authorization header is stripped (not valid for SSE).
    const context = buildAuthContext(req)

    const auth = await this.transport.authenticate(context)
    if (!auth) throw new UnauthorizedException(REALTIME_ERROR_CODES.AUTH_FAILED)

    // Apply an optional per-request tenant resolver, falling back to the auth result.
    const resolvedTenantId = this.options.tenantResolver?.(auth) ?? auth.tenantId
    const resolvedAuth: AuthenticationResult =
      resolvedTenantId !== undefined ? { ...auth, tenantId: resolvedTenantId } : auth

    const connectionId = randomUUID()
    const subject = new Subject<MessageEvent>()
    const close$ = new Subject<void>()

    // Resolve the ring-buffer and offline-queue gaps BEFORE registering the connection.
    // This captures the offline window atomically: no concurrent emitter can reach
    // subject.next() before we know what "offline" means, so offline events always
    // precede live events in the merged stream.
    const lastEventId = singleHeader(req.headers['last-event-id'])
    const replayEvents = lastEventId
      ? this.transport.getReplayEvents(resolvedAuth.userId, lastEventId)
      : []
    const replay$ = replayEvents.length > 0 ? of(...replayEvents) : EMPTY

    const ringBufferIds = new Set(replayEvents.map((e) => e.id ?? ''))
    const queueEvents: OfflineQueuedEvent[] =
      lastEventId && this.offlineDelivery
        ? await this.offlineDelivery.deliver(resolvedAuth.userId, lastEventId, ringBufferIds)
        : []
    const queueReplay$: Observable<MessageEvent> =
      queueEvents.length > 0
        ? of(
            ...queueEvents.map(
              (e): MessageEvent => ({ id: e.id, type: e.event, data: e.data as object }),
            ),
          )
        : EMPTY

    // Emit `connection:established` first unless disabled in options.
    const established$ = this.transport.emitConnectionEvent
      ? of(buildEstablishedEvent(connectionId, resolvedAuth))
      : EMPTY

    return this.buildStream({
      connectionId,
      resolvedAuth,
      ip: context.ip,
      userAgent: context.userAgent,
      res,
      subject,
      close$,
      established$,
      replay$,
      queueReplay$,
    })
  }

  /**
   * Build the live Observable using a subscribe-before-register pattern.
   *
   * The downstream subscriber is wired to the merged pipeline FIRST, so `subject`
   * already has a listener when `registerConnection` runs. Any `subject.next()` that
   * occurs during or after registration goes directly to the subscriber — nothing is
   * buffered or retained, nothing is dropped, and ordering (established → replay →
   * queue → live) is preserved.
   */
  private buildStream(p: StreamParams): Observable<MessageEvent> {
    const {
      connectionId,
      resolvedAuth,
      ip,
      userAgent,
      res,
      subject,
      close$,
      established$,
      replay$,
      queueReplay$,
    } = p
    return new Observable<MessageEvent>((subscriber) => {
      // Subscribe the pipeline first: subject has a listener before registration can emit.
      const inner = merge(established$, replay$, queueReplay$, subject)
        .pipe(
          takeUntil(close$),
          catchError((error: unknown) => {
            this.fireHook(() =>
              this.hooks?.onError?.({ connectionId, error: error as Error, transport: 'sse' }),
            )
            return EMPTY
          }),
          finalize(() => {
            // Stop keepalive synchronously to avoid a write-after-close race.
            this.heartbeat.stop(connectionId)
            void this.transport.unregisterConnection(connectionId)
          }),
        )
        .subscribe(subscriber)

      // Register only after the subscriber is wired; fire onConnect + heartbeat on resolution.
      this.transport
        .registerConnection({ connectionId, auth: resolvedAuth, subject, close$, ip, userAgent })
        .then(() => {
          const record = this.transport.getConnection(connectionId)
          if (record) {
            this.fireHook(() => this.hooks?.onConnect?.(buildMeta(record)))
          }
          const heartbeatMs = this.options.sse?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
          this.heartbeat.start(connectionId, res, heartbeatMs)
        })
        .catch((err: unknown) => {
          this.fireHook(() =>
            this.hooks?.onError?.({ connectionId, error: err as Error, transport: 'sse' }),
          )
          subscriber.error(err)
        })

      return () => inner.unsubscribe()
    })
  }

  /**
   * Invoke a lifecycle hook best-effort — a throwing hook is logged and swallowed
   * so it never disrupts the connection lifecycle or live event delivery.
   *
   * @param invoke - A zero-arg function that calls the hook (handles optionality).
   */
  private fireHook(invoke: () => void | Promise<void>): void {
    void Promise.resolve(invoke()).catch((err: unknown) => {
      this.logger.warn(`Lifecycle hook failed: ${(err as Error).message}`)
    })
  }
}
