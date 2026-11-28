/**
 * @fileoverview Injectable handler owning the full SSE subscribe flow.
 * @layer transport
 */
import { randomUUID } from 'node:crypto'
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { EMPTY, merge, Observable, of, Subject } from 'rxjs'
import type { Subscriber, Subscription } from 'rxjs'
import { catchError, finalize, takeUntil } from 'rxjs/operators'
import { RealtimeMetricsTally } from '../../observability/realtime-metrics-tally'
import { RealtimeTracing } from '../../observability/realtime-tracing'
import {
  OfflineQueueDeliveryService,
  OfflineQueueTimeoutError,
} from '../../offline-queue/offline-queue-delivery.service'
import type { OfflineQueueRead } from '../../offline-queue/offline-queue-delivery.service'
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
import type { SseRequest, SseResponse } from '../../interfaces/sse-http.interface'
import { callHostMethod } from '../../utils/read-host-key'
import { admitRooms } from '../../utils/admit-rooms'
import { assertIdentityIsNotBlank, resolveAuthTenant } from '../../utils/assert-identity'
import { logEvent } from '../../utils/log-event'
import { parseCookieHeader } from '../../utils/parse-cookie-header'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { resolveClientAddress } from '../../utils/client-address'
import { AuthenticationUnavailableError } from '../../services/authentication-gate.service'
import { ConnectionLimitError } from '../../services/connection-admission.service'
import type { AdmissionTicket } from '../../services/connection-admission.service'
import { assertBuiltinsIntact, isBuiltinsRefusal, returnable } from '../../utils/builtin-baseline'
import { absorbed, shielded } from '../../utils/within-deadline'
import { runHook } from '../../utils/run-hook'
import { SseTransport } from './sse.transport'
import { probeOf } from './outbound-backlog'
import { onResponseClose } from './response-close'
import { HeartbeatService } from './heartbeat.service'

/** Coerce a possibly-multi-valued header to a single string. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Longest last event id that is believed. A URL carries the id into access logs and caches, and the
 * header has no bound of its own beyond the server's header limit; the ids this library generates
 * are 20 characters.
 */
const MAX_LAST_EVENT_ID_LENGTH = 256

/** An id that is one non-empty string within the bound, or `undefined`, as if it were absent. */
function believedId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value.length <= MAX_LAST_EVENT_ID_LENGTH
    ? value
    : undefined
}

/**
 * The id a reconnect resumes after: the `Last-Event-ID` header, else the `lastEventId` query
 * parameter. A new `EventSource` cannot send the header, so a client that opens one after its
 * stream was refused resumes through the query. The header wins when both are believed.
 */
function lastEventIdOf(req: SseRequest): string | undefined {
  return believedId(req.headers['last-event-id']) ?? believedId(req.query['lastEventId'])
}

/** Normalize header names to lowercase and flatten array values. */
function normalizeHeaders(headers: SseRequest['headers']): Record<string, string | undefined> {
  const out = Object.create(null) as Record<string, string | undefined>
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : value
  }
  return out
}

/** Coerce parsed query values to flat strings (arrays/objects become undefined). */
function sanitizeQuery(query: SseRequest['query']): Record<string, string | undefined> {
  const out = Object.create(null) as Record<string, string | undefined>
  for (const [key, value] of Object.entries(query)) {
    out[key] = typeof value === 'string' ? value : undefined
  }
  return out
}

/** Build the transport-agnostic auth context from the HTTP request. */
function buildAuthContext(req: SseRequest): ConnectionAuthContext {
  const headers = normalizeHeaders(req.headers)
  // EventSource cannot send custom headers — `authorization` is never a valid SSE
  // auth channel. Strip it so a non-browser client cannot smuggle a bearer token.
  delete headers['authorization']
  return {
    cookies: parseCookieHeader(singleHeader(req.headers['cookie']) ?? ''),
    headers,
    query: sanitizeQuery(req.query),
    ip: resolveClientAddress(req),
    remoteAddress: req.socket?.remoteAddress,
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

/** Map a durable offline-queue event to the SSE `MessageEvent` wire shape. */
function toMessageEvent(event: OfflineQueuedEvent): MessageEvent {
  return { id: event.id, type: event.event, data: event.data as object }
}

/** Build `ConnectionEventMeta` from a registered connection record. */
function buildMeta(record: ConnectionRecord) {
  return {
    connectionId: record.connectionId,
    userId: record.userId,
    tenantId: record.tenantId,
    roles: record.originalAuth.roles,
    metadata: record.originalAuth.metadata,
    transport: 'sse' as const,
    ip: record.ip,
    userAgent: record.userAgent,
    connectedAt: record.connectedAt,
  }
}

interface AuthenticatedRequest {
  context: ConnectionAuthContext
  auth: AuthenticationResult
  /** The place held for this connection until it is registered or its response closes. */
  ticket: AdmissionTicket
  /** The offline queue's gap for a reconnect, read before the response is committed. */
  queueRead: OfflineQueueRead
}

/** Parameters forwarded from `handle()` into `buildStream()`. */
interface StreamParams {
  connectionId: string
  resolvedAuth: AuthenticationResult
  ticket: AdmissionTicket
  ip: string
  userAgent: string | undefined
  res: SseResponse
  subject: Subject<MessageEvent>
  close$: Subject<void>
  established$: Observable<MessageEvent>
  replay$: Observable<MessageEvent>
  /** Raw offline-queue gap events: mapped into the stream and acknowledged after emission. */
  queueEvents: OfflineQueuedEvent[]
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

  private readonly authenticated = new WeakMap<object, AuthenticatedRequest>()

  constructor(
    @Inject(SseTransport) private readonly transport: SseTransport,
    @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
    // Optional so the handler can be unit-constructed in isolation; the module always registers it.
    @Optional()
    @Inject(OfflineQueueDeliveryService)
    private readonly offlineDelivery?: OfflineQueueDeliveryService,
    // Optional so the handler can be unit-constructed in isolation; the module always provides it.
    @Optional()
    @Inject(RealtimeMetricsTally)
    private readonly tally?: RealtimeMetricsTally,
    // Optional so the handler can be unit-constructed in isolation; the module always provides it.
    @Optional()
    @Inject(RealtimeTracing)
    private readonly tracing?: RealtimeTracing,
  ) {}

  /**
   * Resolve the tenant this connection routes on, and refuse a blank identity.
   *
   * Both transports resolve the routing tenant through this one function, so a
   * connection carries the same tenant whichever one opened it. The check runs on
   * the resolved value rather than the raw one — validating what the server does not
   * use would validate nothing.
   *
   * A blank identity is the consumer's configuration rather than the client's
   * credentials, so it is deliberately not a 401: a 401 would tell a client its
   * credentials were rejected when they were accepted, inviting a retry that cannot
   * succeed. Wrapped rather than rethrown raw so the 500 is a decision Nest logs
   * once, not an unhandled crash logging a stack on every reconnect.
   *
   * The reason names the operator's fix, so it goes to the server log and the client
   * receives Nest's generic 500 body, as the WebSocket gateway does by disconnecting
   * without a message.
   *
   * @param auth - The result the consumer's authenticator returned.
   * @returns The result with the routing tenant resolved and `rooms` replaced by the validated, frozen copy.
   * @throws InternalServerErrorException with the generic body when a trait is present
   *   but blank.
   */
  private resolveAndValidateIdentity(auth: AuthenticationResult): AuthenticationResult {
    let resolvedAuth = resolveAuthTenant(this.options, auth)
    try {
      assertIdentityIsNotBlank(resolvedAuth)
      resolvedAuth = admitRooms(resolvedAuth)
    } catch (err) {
      this.tally?.refused('error')
      logEvent(
        this.logger,
        'error',
        'REALTIME_HANDSHAKE_FAILED',
        `SSE connection refused — responding 500`,
        {},
        err,
      )
      throw new InternalServerErrorException()
    }
    return resolvedAuth
  }

  /**
   * Handle an incoming SSE connection request end-to-end.
   *
   * Sets anti-buffering headers, authenticates the request, captures the offline-gap
   * before exposing the connection, then returns an Observable whose subscriber callback
   * wires the downstream listener BEFORE calling `registerConnection` — so a plain
   * `Subject` suffices and the replay buffer cannot grow unboundedly.
   *
   * @param req - The incoming request (SSE GET).
   * @param res - The response (passthrough for header mutations and heartbeat writes).
   * @returns An Observable of `MessageEvent` values for NestJS `@Sse` to stream.
   * @throws UnauthorizedException when authentication returns null — the client's
   *   credentials were rejected, which is a 401.
   * @throws InternalServerErrorException when the authenticator, or the configured
   *   `tenantResolver`, yields a blank `userId` or `tenantId`. This is deliberately not
   *   a 401: the credentials were accepted and the fault is the consumer's
   *   configuration, so it surfaces as a 500 rather than telling a client to retry
   *   something that cannot succeed. The exception carries no message, so the client
   *   gets Nest's generic body, and the `REALTIME_AUTH_FAILED` reason naming the fix is
   *   written to the server log.
   */
  async handle(req: SseRequest, res: SseResponse): Promise<Observable<MessageEvent>> {
    // Anti-buffering headers must be sent before the first byte.
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')

    // A stream opened once shutdown has begun would keep the HTTP server from closing.
    this.refuseDuringShutdown()

    // The route guard normally authenticated already.
    const done = this.authenticated.get(req)
    this.authenticated.delete(req)
    let authenticated: AuthenticatedRequest
    try {
      authenticated = done ?? (await shielded(this.authenticateRequest(req, res)))
    } catch (err) {
      throw this.toClientError(err, 'SSE authentication failed')
    }
    let queueEvents: OfflineQueuedEvent[]
    try {
      queueEvents = await shielded(this.readAppended(req, authenticated))
      // The replay ring and the queue reconciliation are read by key and by id next: a built-in they rely on that was replaced
      // while this request waited would hand this connection another user's events, so nothing is read before this check.
      assertBuiltinsIntact()
    } catch (err) {
      authenticated.ticket.release()
      throw err
    }
    const stream = this.openStream(req, res, authenticated, queueEvents)
    // Authentication is asynchronous, so shutdown may have begun while this request waited.
    try {
      this.refuseDuringShutdown()
    } catch (err) {
      authenticated.ticket.release()
      throw err
    }
    // The last statement before the return: an async function resolves its promise with the stream, which asks it, and
    // what it inherits from, for a `then`; one a host planted while the stream was built, or before, answers for it.
    try {
      return returnable(stream)
    } catch (err) {
      authenticated.ticket.release()
      throw err
    }
  }

  /** Refuse a new stream with a 503 once shutdown has begun. */
  private refuseDuringShutdown(): void {
    if (this.transport.shuttingDown) {
      this.tally?.refused('unavailable')
      throw new ServiceUnavailableException(REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE)
    }
  }

  private openStream(
    req: SseRequest,
    res: SseResponse,
    authenticated: AuthenticatedRequest,
    gapEvents: OfflineQueuedEvent[],
  ): Observable<MessageEvent> {
    const { context, auth: resolvedAuth, ticket } = authenticated

    const connectionId = randomUUID()
    const subject = new Subject<MessageEvent>()
    const close$ = new Subject<void>()

    // The ring buffer is read here, as late as the route allows, rather than in the guard: whatever
    // the application runs between the two (an interceptor that awaits, say) would otherwise leave
    // events that were emitted meanwhile out of the replay, and the connection is not registered to
    // receive them live. The queue events were read in the guard and are reconciled with the ring now,
    // so an event that is in both is delivered once. Reading both before registering means no
    // concurrent emitter can reach subject.next() first, and offline events precede live ones.
    const lastEventId = lastEventIdOf(req)
    const replayEvents = lastEventId
      ? this.transport.getReplayEvents(resolvedAuth.userId, lastEventId)
      : []
    const queueEvents = gapEvents.filter(
      (queued) => !replayEvents.some((replayed) => replayed.id === queued.id),
    )
    const replay$ = of(...replayEvents)

    // Emit `connection:established` first unless disabled in options.
    const established$ = this.transport.emitConnectionEvent
      ? of(buildEstablishedEvent(connectionId, resolvedAuth))
      : EMPTY

    return this.buildStream({
      connectionId,
      resolvedAuth,
      ticket,
      ip: context.ip,
      userAgent: context.userAgent,
      res,
      subject,
      close$,
      established$,
      replay$,
      queueEvents,
    })
  }

  /**
   * Authenticate ahead of the route, from a guard: with an interceptor registered Nest commits
   * `200` on the next macrotask, so a refusal that needs I/O is a status only if it comes first.
   */
  async authenticateBeforeCommit(req: SseRequest, res?: SseResponse): Promise<void> {
    try {
      this.authenticated.set(req, await shielded(this.authenticateRequest(req, res)))
    } catch (err) {
      throw this.toClientError(err, 'SSE authentication failed')
    }
  }

  // Nest 11.2.3 streams `err.message`: only an authenticator's HTTP exception may pass as it is.
  private toClientError(err: unknown, what: string): HttpException {
    // A handshake the authenticator could not be asked about, or did not answer in time, is the
    // system being unavailable: a 503 with the generic body, counted and logged by the gate once for
    // each window rather than once for each request.
    if (err instanceof ConnectionLimitError) {
      this.tally?.refused('limit')
      return new ServiceUnavailableException()
    }
    if (err instanceof AuthenticationUnavailableError) {
      this.tally?.refused('unavailable')
      return new ServiceUnavailableException()
    }
    if (err instanceof HttpException && err.getStatus() === HttpStatus.UNAUTHORIZED) {
      this.tally?.refused('unauthorized')
    }
    return err instanceof HttpException ? err : this.serverError(err, what)
  }

  private serverError(err: unknown, what: string): HttpException {
    this.tally?.refused('error')
    logEvent(this.logger, 'error', 'REALTIME_HANDSHAKE_FAILED', `${what} — responding 500`, {}, err)
    return new InternalServerErrorException()
  }

  /** Admit and authenticate a handshake, inside the `realtime.handshake` span when tracing is wired. */
  private authenticateRequest(req: SseRequest, res?: SseResponse): Promise<AuthenticatedRequest> {
    const run = (): Promise<AuthenticatedRequest> => shielded(this.admitAndAuthenticate(req, res))
    return this.tracing
      ? this.tracing.span('realtime.handshake', { 'bymax.realtime.transport': 'sse' }, run)
      : run()
  }

  private async admitAndAuthenticate(
    req: SseRequest,
    res?: SseResponse,
  ): Promise<AuthenticatedRequest> {
    // Room for the connection is taken before the authenticator is asked, and given back when the
    // connection is registered or when the response closes, whichever comes first.
    const held = this.transport.admit()
    const detach = onResponseClose(res, () => ticket.release())
    const ticket: AdmissionTicket = {
      release: () => {
        detach()
        held.release()
      },
      renew: () => held.renew(),
    }
    try {
      // The authorization header is stripped (not valid for SSE).
      const context = buildAuthContext(req)
      const auth = await this.transport.authenticate(context)
      if (!auth) throw new UnauthorizedException(REALTIME_ERROR_CODES.AUTH_FAILED)
      const resolved = this.resolveAndValidateIdentity(auth)
      const queueRead = await shielded(this.readQueue(req, resolved.userId))
      // The last statement before the return, which resolves the function's promise with an object and so reads its `then`.
      return returnable({ context, auth: resolved, ticket, queueRead })
    } catch (err) {
      ticket.release()
      throw err
    }
  }

  /**
   * Read the offline queue's gap for a reconnect, WITHOUT acknowledging (acknowledgment is deferred
   * until the events have been emitted to an open subscriber, so delivery is at-least-once).
   *
   * This runs with the authentication, in the guard, because a refusal that needs I/O is a status
   * only if it is decided before Nest commits the response: with an interceptor registered it
   * commits `200` from a timer once the route returns, and a refusal after that can only end the
   * stream. A queue that did not answer in time is a `503` with the generic body; a queue that fails
   * is reported by the service and gives an empty gap marked as degraded, and anything else it throws
   * is a generic `500`, whatever its error says.
   */
  private async readQueue(req: SseRequest, userId: string): Promise<OfflineQueueRead> {
    const lastEventId = lastEventIdOf(req)
    if (!lastEventId || !this.offlineDelivery) {
      // The last statement before an object return, as below: the function's promise is resolved with it.
      return returnable({ events: [], degraded: false })
    }
    try {
      const gap = await shielded(this.offlineDelivery.retrieveGap(userId, lastEventId))
      return returnable(gap)
    } catch (err) {
      if (err instanceof OfflineQueueTimeoutError) throw new ServiceUnavailableException()
      throw this.serverError(err, 'SSE handshake failed')
    }
  }

  /**
   * Add what was appended to the offline queue since the guard read it, so that an event emitted to
   * this user while the application's interceptors ran, which is in the queue and in no replay ring,
   * is delivered with the rest of the gap. The earlier read ended at the last event it returned, and
   * this one starts after it, so the two lists are disjoint and keep queue order.
   *
   * When the first read failed, the store is down and the reconnect is served without a gap and
   * there is no second read. When the first read succeeded, a second one that did not
   * answer in time, was refused because the reads waiting are all taken, or failed ends the attempt
   * here, before any event is delivered: a stream that skipped these events moves the client's cursor
   * past them with the next event it receives, where an attempt that delivered nothing leaves it where
   * it was.
   */
  private async readAppended(
    req: SseRequest,
    authenticated: AuthenticatedRequest,
  ): Promise<OfflineQueuedEvent[]> {
    const lastEventId = lastEventIdOf(req)
    const { queueRead } = authenticated
    if (!lastEventId || !this.offlineDelivery) {
      // The last statement before an array return: the function's promise is resolved with it, which reads a `then`
      // that a host planted on `Array.prototype` before this call would answer for.
      return returnable(queueRead.events)
    }
    try {
      const appended = await shielded(
        this.offlineDelivery.retrieveAppended(authenticated.auth.userId, lastEventId, queueRead),
      )
      const gap = [...queueRead.events, ...appended]
      return returnable(gap)
    } catch (err) {
      // The baseline's refusal is the answer as it is: wrapping it as a 500 would hide the count-only code.
      if (isBuiltinsRefusal(err)) throw err
      if (err instanceof OfflineQueueTimeoutError) throw new ServiceUnavailableException()
      throw this.serverError(err, 'SSE handshake failed')
    }
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
    return new Observable<MessageEvent>((subscriber) => {
      // The connection is registered only now, after the handshake returned this stream. Shutdown
      // may have begun in between: its snapshot of the connections was taken without this one, so
      // nothing would end it. Nothing has been read from the pipeline or registered yet.
      if (this.transport.shuttingDown) {
        p.ticket.release()
        subscriber.complete()
        return undefined
      }
      // Subscribe the pipeline first: subject has a listener before registration can emit.
      const inner = this.subscribePipeline(p, subscriber)
      // The offline-queue events were pushed synchronously during the subscribe above.
      // Acknowledge them (prune durable storage) only when the subscriber is still open;
      // a client that disconnected first keeps them durable for redelivery (at-least-once).
      if (!subscriber.closed && p.queueEvents.length > 0) {
        void this.offlineDelivery?.acknowledge(p.resolvedAuth.userId, p.queueEvents)
      }
      this.activateConnection(p, subscriber)
      return inner
    })
  }

  /**
   * Wire the merged pipeline to the downstream subscriber with teardown.
   *
   * Subscribing first guarantees `subject` has a listener before registration can emit,
   * so a plain `Subject` suffices and ordering (established → replay → queue → live) holds.
   */
  private subscribePipeline(p: StreamParams, subscriber: Subscriber<MessageEvent>): Subscription {
    const { connectionId, subject, close$, established$, replay$, queueEvents } = p
    const queueReplay$ = of(...queueEvents.map(toMessageEvent))
    return merge(established$, replay$, queueReplay$, subject)
      .pipe(
        takeUntil(close$),
        catchError((error: unknown) => {
          this.fireHook(() =>
            callHostMethod(this.hooks, 'onError', [
              { connectionId, error: error as Error, transport: 'sse' },
            ]),
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
  }

  /**
   * Register the connection (after the subscriber is wired) and activate it on resolution.
   *
   * A registration failure routes to `onError` and errors the stream; a failure that
   * arrives after teardown is a no-op since `subscriber.error` is ignored once closed.
   */
  private activateConnection(p: StreamParams, subscriber: Subscriber<MessageEvent>): void {
    const { connectionId, resolvedAuth, ip, userAgent, subject, close$ } = p
    // The waits before this (authentication, the offline-queue read, whatever the application runs
    // on the request) add up, and a place is given back by time: it may have been taken by another
    // request while this one was alive. It is taken again, or the stream ends, rather than
    // registering a connection the instance has no room for.
    try {
      p.ticket.renew()
    } catch (err) {
      subscriber.error(this.toClientError(err, 'SSE registration refused'))
      return
    }
    const registering = shielded(
      this.transport.registerConnection({
        connectionId,
        auth: resolvedAuth,
        subject,
        close$,
        ip,
        userAgent,
        outbound: probeOf(p.res),
      }),
    )
    // The registry holds the connection from the call on, so the place would be counted twice for as
    // long as the rest of the registration takes.
    p.ticket.release()
    // A refusal below leaves `registering` unread; its rejection is absorbed here, whatever happens to the wait.
    void absorbed(registering)
    void (async () => {
      try {
        // Immediately before the await whose end decides whether the connection is completed.
        assertBuiltinsIntact()
        await registering
        this.onRegistered(p, subscriber)
      } catch (err: unknown) {
        this.fireHook(() =>
          callHostMethod(this.hooks, 'onError', [
            { connectionId, error: err as Error, transport: 'sse' },
          ]),
        )
        subscriber.error(this.serverError(err, 'SSE registration failed'))
      }
    })()
  }

  /**
   * Complete the connection handshake once registration resolves.
   *
   * Registration is async and can resolve AFTER the downstream subscriber has already
   * torn down (client disconnected mid-handshake). When that happens `finalize` has
   * already stopped the heartbeat and unregistered, so re-firing onConnect or starting
   * a fresh heartbeat would leak the connection and write after close. Guard on
   * `subscriber.closed`: if closed, undo the late registration idempotently and return.
   */
  private onRegistered(p: StreamParams, subscriber: Subscriber<MessageEvent>): void {
    const { connectionId, res } = p
    if (subscriber.closed) {
      this.heartbeat.stop(connectionId)
      void this.transport.unregisterConnection(connectionId)
      return
    }
    const record = this.transport.getConnection(connectionId)
    if (record) {
      this.fireHook(
        () => callHostMethod(this.hooks, 'onConnect', [buildMeta(record)]),
        this.options.onConnectFailure === 'close' ? () => subscriber.complete() : undefined,
      )
    }
    const heartbeatMs = this.options.sse?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.heartbeat.start(connectionId, res, heartbeatMs, () =>
      this.transport.checkStall(connectionId),
    )
  }

  /**
   * Invoke a lifecycle hook best-effort — a throwing hook is logged and swallowed
   * so it never disrupts the connection lifecycle or live event delivery.
   *
   * @param invoke - A zero-arg function that calls the hook (handles optionality).
   * @param onFailure - What to do, once the failure is logged, when the hook failed.
   */
  private fireHook(invoke: () => void | Promise<void>, onFailure?: () => void): void {
    void runHook(invoke).then((failed) => {
      if (!failed) return
      logEvent(
        this.logger,
        'warn',
        'REALTIME_HOOK_FAILED',
        `Lifecycle hook failed`,
        {},
        failed.error,
      )
      onFailure?.()
    })
  }
}
