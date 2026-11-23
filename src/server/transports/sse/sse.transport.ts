/**
 * @fileoverview SSE transport: local delivery + single cross-instance publish.
 * @layer transport
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Subject } from 'rxjs'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_HOOK_TIMEOUT_MS,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PUBSUB_TOKEN,
} from '../../constants/injection-tokens.constants'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../../interfaces/offline-queue-storage.interface'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
} from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../../interfaces/realtime-pubsub.interface'
import type { ITransport } from '../../interfaces/transport.interface'
import { RealtimeMetricsTally } from '../../observability/realtime-metrics-tally'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import { callHostMethod } from '../../utils/read-host-key'
import { composeRoomId } from '../../utils/compose-room-id'
import { AuthenticationGate } from '../../services/authentication-gate.service'
import { ConnectionAdmission, UNBOUNDED_TICKET } from '../../services/connection-admission.service'
import type { AdmissionTicket } from '../../services/connection-admission.service'
import { assertBuiltinsIntact } from '../../utils/builtin-baseline'
import { logEvent } from '../../utils/log-event'
import { runHook } from '../../utils/run-hook'
import { reportDeliveryFailure } from '../../utils/report-delivery-failure'
import { refuseReservedRoom, requireRoomName } from '../../utils/reserved-room'
import { unavailableError } from '../../utils/unavailable-error'
import { InMemoryPubSub } from '../../pubsub/in-memory-pubsub'
import { EventReplayBuffer } from './event-replay-buffer'
import { HeartbeatService } from './heartbeat.service'
import { frameBytes } from './frame-size'
import type { Frame } from './frame-size'
import { OutboundBacklog, StallWatch } from './outbound-backlog'
import type { OutboundProbe } from './outbound-backlog'

/** Parameters required to register a freshly authenticated SSE connection. */
export interface RegisterSseConnectionParams {
  connectionId: string
  auth: AuthenticationResult
  subject: Subject<MessageEvent>
  close$: Subject<void>
  ip: string
  userAgent: string | undefined
  /** What the response has taken and holds; without it the connection's backlog is not bounded. */
  outbound?: OutboundProbe | undefined
}

/** What is tracked for a connection whose client could be slow to read. */
interface Outbound {
  readonly probe: OutboundProbe
  readonly backlog: OutboundBacklog
  readonly stall: StallWatch
}

/** A caught failure, boxed so that a thrown `undefined` or `null` is still a failure. */
interface Failure {
  readonly error: unknown
}

/**
 * SSE transport implementation.
 *
 * Each public `emitTo*`/`broadcast` performs local delivery via the matching
 * `*Local` method and then publishes exactly once to `IRealtimePubSub`. Remote
 * messages received from the bus are dispatched by `RealtimePubSubSubscriber`
 * (not this class) to the `*Local` methods only (never re-published), and
 * self-originated messages are filtered there — so a single instance never
 * double-delivers and multiple instances never ping-pong.
 *
 * Teardown of an SSE stream is driven by the per-connection `close$` subject: `disconnectLocal`
 * removes the connection from the registries, then completes `close$` (which ends the `@Sse`
 * Observable via `takeUntil`), and only then runs the consumer's `onDisconnect`. See
 * `docs/technical_specification.md` §6.1.
 */
@Injectable()
export class SseTransport implements ITransport {
  readonly kind = 'sse' as const
  private readonly logger = new Logger(SseTransport.name)
  /** Set when shutdown begins; from then on a new stream is refused. */
  #shuttingDown = false
  private readonly outbound = new Map<string, Outbound>()

  constructor(
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
    @Inject(RoomRegistry) private readonly rooms: RoomRegistry,
    @Inject(EventReplayBuffer) private readonly replayBuffer: EventReplayBuffer,
    @Inject(EventIdGenerator) private readonly idGen: EventIdGenerator,
    @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
    @Inject(AuthenticationGate) private readonly gate: AuthenticationGate,
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
    @Optional()
    @Inject(REALTIME_OFFLINE_QUEUE_TOKEN)
    private readonly offlineQueue?: IOfflineQueueStorage,
    // Optional so a transport built by hand keeps working; the module always provides it.
    @Optional()
    @Inject(ConnectionAdmission)
    private readonly admission?: ConnectionAdmission,
    // Optional so a transport built by hand keeps working; the module always provides it.
    @Optional()
    @Inject(RealtimeMetricsTally)
    private readonly tally?: RealtimeMetricsTally,
  ) {}

  /**
   * Mark shutdown as begun at the first hook Nest runs on close. A slow `onModuleDestroy` in a module
   * nearer the root than the realtime module still runs first, and until it returns a stream is
   * accepted; nothing the library owns runs earlier. A slow `beforeApplicationShutdown` in such a
   * module runs before this transport's own, which is why the flag is set here.
   */
  onModuleDestroy(): void {
    this.#shuttingDown = true
  }

  /**
   * Tear down every SSE connection and stop heartbeat before the HTTP server closes.
   *
   * Nest awaits the HTTP server's close before it runs `onApplicationShutdown`, and the server
   * does not finish closing while a response is open, so the streams have to be ended here, before
   * the close, for the later shutdown hooks to run.
   */
  async beforeApplicationShutdown(): Promise<void> {
    // Before anything is awaited, so that a handshake that finishes from here on is refused and
    // does not open a stream the teardown below would not see.
    this.#shuttingDown = true
    this.heartbeat.stopAll()
    // Every connection is cut at once and each hook is bounded by `hookTimeoutMs`, so the whole
    // teardown takes about one timeout however many connections there are and however many of their
    // hooks hang. Awaited so that the hooks that do settle finish within the shutdown window (RxJS
    // finalize cannot await an async callback). disconnectLocal removes the record first, so the
    // stream's own finalize cleanup is then a harmless no-op.
    await Promise.all(
      this.connections.allByTransport('sse').map((conn) => this.disconnectLocal(conn.connectionId)),
    )
  }

  /** The same teardown, for a caller that runs only this hook; it finds nothing left to close. */
  async onApplicationShutdown(): Promise<void> {
    await this.beforeApplicationShutdown()
  }

  /** Whether shutdown has begun, after which a new stream is refused because nothing would end it. */
  get shuttingDown(): boolean {
    return this.#shuttingDown
  }

  /** The resolved heartbeat interval for this transport. */
  get heartbeatMs(): number {
    return this.options.sse?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  }

  /** Whether the `connection:established` event should be emitted on connect. */
  get emitConnectionEvent(): boolean {
    return this.options.sse?.emitConnectionEvent !== false
  }

  /**
   * Take a place for a connection before it is authenticated.
   *
   * @throws ConnectionLimitError when the instance already holds `maxConnections`.
   */
  admit(): AdmissionTicket {
    return this.admission?.admit() ?? UNBOUNDED_TICKET
  }

  /** Authenticate a connection through the consumer-provided authenticator. */
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    return this.gate.authenticate(context)
  }

  /**
   * Register an authenticated SSE connection and auto-join its user/tenant rooms.
   *
   * Fires FIFO eviction if the user exceeds `maxConnectionsPerUser`. The `onConnect`
   * lifecycle hook is fired by the subscription handler after this returns, so that the
   * handler can carry a consistent connection record reference.
   */
  async registerConnection(params: RegisterSseConnectionParams): Promise<void> {
    assertBuiltinsIntact()
    const record: ConnectionRecord = {
      connectionId: params.connectionId,
      userId: params.auth.userId,
      tenantId: params.auth.tenantId,
      transport: 'sse',
      ip: params.ip,
      userAgent: params.userAgent,
      connectedAt: new Date(),
      subject: params.subject,
      close$: params.close$,
      originalAuth: {
        userId: params.auth.userId,
        tenantId: params.auth.tenantId,
        roles: params.auth.roles,
        rooms: params.auth.rooms,
        metadata: params.auth.metadata,
      },
    }
    this.connections.register(record)
    this.replayBuffer.open(params.auth.userId)
    this.track(params)
    this.recordJoin(params.connectionId, composeRoomId('USER', params.auth.userId))
    if (params.auth.tenantId !== undefined) {
      this.recordJoin(params.connectionId, composeRoomId('TENANT', params.auth.tenantId))
    }
    // The admitted copy, walked by index: the handler awaited between admission and here, and the check runs before each join.
    const named = params.auth.rooms ?? []
    for (let i = 0; i < named.length; i += 1)
      this.recordJoin(params.connectionId, named[i] as string)
    await this.evictBeyondLimit(params.auth.userId)
  }

  /** Join one room in the registry, after checking that the built-ins the library calls are what they were. */
  private recordJoin(connectionId: string, room: string): void {
    assertBuiltinsIntact()
    this.rooms.join(connectionId, room)
  }

  /** Deliver a message to each of a snapshot of connections, walked by index so no iterator is asked for. */
  private deliverToAll(connections: readonly ConnectionRecord[], message: Frame): void {
    for (let i = 0; i < connections.length; i += 1)
      this.deliver(connections[i] as ConnectionRecord, message)
  }

  /**
   * Idempotent cleanup for a connection that has already gone — runs the disconnect hook exactly
   * once, which the library waits for no longer than `hookTimeoutMs`.
   */
  async unregisterConnection(connectionId: string, reason?: string): Promise<void> {
    const record = this.release(connectionId)
    if (record) await this.notifyDisconnect(record, reason)
  }

  /**
   * Forget a connection: its record, its rooms, its heartbeat and its backlog. Synchronous, so that
   * nothing a consumer's code does can come between a connection and its removal.
   */
  private release(connectionId: string): ConnectionRecord | undefined {
    const record = this.connections.unregister(connectionId)
    if (record) this.replayBuffer.close(record.userId)
    // Idempotent for a connection that is already gone, so there is nothing to branch on.
    this.rooms.leaveAll(connectionId)
    this.heartbeat.stop(connectionId)
    this.outbound.delete(connectionId)
    return record
  }

  /** Run `onDisconnect` for a released connection, giving up on it after `hookTimeoutMs`. */
  private async notifyDisconnect(
    record: ConnectionRecord,
    reason: string | undefined,
  ): Promise<void> {
    const failed = await runHook(
      () =>
        callHostMethod(this.hooks, 'onDisconnect', [
          {
            connectionId: record.connectionId,
            userId: record.userId,
            tenantId: record.tenantId,
            roles: record.originalAuth.roles,
            metadata: record.originalAuth.metadata,
            transport: 'sse',
            ip: record.ip,
            userAgent: record.userAgent,
            connectedAt: record.connectedAt,
            durationMs: Date.now() - record.connectedAt.getTime(),
            ...(reason !== undefined ? { reason } : {}),
          },
        ]),
      this.options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    )
    if (failed) {
      logEvent(
        this.logger,
        'error',
        'REALTIME_HOOK_FAILED',
        `onDisconnect hook failed`,
        {
          hook: 'onDisconnect',
        },
        failed.error,
      )
    }
  }

  /** Replay the events a user missed after `lastEventId`. */
  getReplayEvents(userId: string, lastEventId: string): MessageEvent[] {
    return this.replayBuffer.since(userId, lastEventId)
  }

  /**
   * All SSE connections for a user — public accessor so external callers can
   * inspect or iterate without reaching into a private registry field.
   *
   * @param userId - The user whose active connections are returned.
   * @returns A snapshot of the user's current SSE `ConnectionRecord` list.
   */
  connectionsForUser(userId: string): ConnectionRecord[] {
    return this.connections.byUser(userId, 'sse')
  }

  /**
   * Look up a single connection by id.
   *
   * @param connectionId - The unique connection identifier.
   * @returns The `ConnectionRecord`, or `undefined` when not found.
   */
  getConnection(connectionId: string): ConnectionRecord | undefined {
    return this.connections.get(connectionId)
  }

  /**
   * Emit to a user: live here, to the other instances over the bus, and into the offline queue
   * when the user has no live connection on this instance.
   *
   * A failed publish or a failed append is reported (log and `onDeliveryFailure`) and the call
   * still resolves, since delivery to the other instances is at-most-once. It rejects only when
   * the event has no delivery path left: the user is offline here, the queue could not keep it,
   * and the bus either failed or cannot reach another instance (the in-memory bus). A rejection
   * carries the queue failure as its cause and is not also reported to the hook.
   */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    const id = this.idGen.next()
    this.emitToUserLocal(userId, event, data, id)
    const queue = this.offlineQueue
    const offline = queue !== undefined && this.connections.byUser(userId, 'sse').length === 0
    const [queueFailure, publishFailure] = await Promise.all([
      offline
        ? this.tryAppend(queue, userId, { id, event, data, emittedAt: new Date() })
        : undefined,
      this.tryPublish({ op: 'emitToUser', args: { userId, event, data, id } }),
    ])
    if (
      queueFailure !== undefined &&
      (publishFailure !== undefined || !this.busReachesOtherInstances())
    ) {
      // A rejection tells the caller; the hook hears only about failures behind a resolved call.
      throw unavailableError(
        REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
        SseTransport.name,
        `${event} for ${userId} has no delivery path: the user is offline here and the offline queue failed`,
        queueFailure.error,
      )
    }
    if (publishFailure !== undefined) this.reportPublishFailure('emitToUser', publishFailure)
    if (queueFailure !== undefined) {
      reportDeliveryFailure(
        this.logger,
        this.hooks,
        {
          code: REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
          op: 'offlineAppend',
          error: queueFailure.error,
        },
        'Offline queue append failed',
      )
    }
  }

  /** Append to the offline queue; resolves with the failure, or `undefined` once it is kept. */
  private async tryAppend(
    queue: IOfflineQueueStorage,
    userId: string,
    event: OfflineQueuedEvent,
  ): Promise<Failure | undefined> {
    try {
      await queue.append(userId, event)
      return undefined
    } catch (error) {
      return { error }
    }
  }

  /** Whether the bus can carry an event to another instance (the in-memory bus cannot). */
  private busReachesOtherInstances(): boolean {
    return !(this.pubsub instanceof InMemoryPubSub)
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    const id = this.idGen.next()
    this.emitToTenantLocal(tenantId, event, data, id)
    await this.publish({ op: 'emitToTenant', args: { tenantId, event, data, id } })
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    requireRoomName('emitToRoom', roomId)
    const id = this.idGen.next()
    this.emitToRoomLocal(roomId, event, data, id)
    await this.publish({ op: 'emitToRoom', args: { roomId, event, data, id } })
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    const id = this.idGen.next()
    this.broadcastLocal(event, data, id)
    await this.publish({ op: 'broadcast', args: { event, data, id } })
  }

  /** Join a connection this instance holds to a room; any other id is left alone. */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    assertBuiltinsIntact()
    refuseReservedRoom('joinRoom', roomId)
    if (this.connections.get(connectionId)?.transport === 'sse')
      this.recordJoin(connectionId, roomId)
  }

  /** Remove a connection this instance holds from a room; any other id is left alone. */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    assertBuiltinsIntact()
    refuseReservedRoom('leaveRoom', roomId)
    if (this.connections.get(connectionId)?.transport === 'sse')
      this.rooms.leave(connectionId, roomId)
  }

  /**
   * Disconnect a connection locally if owned here, otherwise revoke cross-instance.
   *
   * Resolves once the connection is closed here or the revocation has been handed to the bus. A
   * connection held here as a WebSocket is left to the WebSocket transport and nothing is
   * published. It rejects with `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses it: nothing has reached
   * the connection, so the caller must not read the resolution as a revocation.
   */
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    assertBuiltinsIntact()
    const record = this.connections.get(connectionId)
    if (record) {
      // A connection held here as a WebSocket is the WebSocket transport's to close:
      // `disconnectLocal` leaves it alone.
      await this.disconnectLocal(connectionId, reason)
      return
    }
    try {
      await this.pubsub.publish({
        op: 'disconnect',
        args: { connectionId, reason },
        origin: this.instanceId,
      })
    } catch (error) {
      throw unavailableError(
        REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
        SseTransport.name,
        `the revocation of ${connectionId} could not be published`,
        error,
      )
    }
  }

  /**
   * Deliver an event to a user's local SSE connections and update the replay buffer.
   *
   * @internal Invoked only by RealtimePubSubSubscriber for remote re-emit; application code
   * must call the public emitToUser/emitToTenant/emitToRoom/broadcast/disconnect to preserve cross-instance delivery.
   */
  emitToUserLocal(userId: string, event: string, data: unknown, id: string): void {
    assertBuiltinsIntact()
    const message = this.buildMessage(id, event, data)
    this.tally?.emitted('sse')
    this.replayBuffer.append(userId, message)
    this.deliverToAll(this.connections.byUser(userId, 'sse'), message)
  }

  /**
   * Deliver an event to all local SSE connections for a tenant.
   *
   * @internal Invoked only by RealtimePubSubSubscriber for remote re-emit; application code
   * must call the public emitToUser/emitToTenant/emitToRoom/broadcast/disconnect to preserve cross-instance delivery.
   * @remarks Events sent via tenant/room/broadcast are NOT written to the per-user replay
   * buffer or offline queue — only emitToUser populates per-user replay/offline state.
   */
  emitToTenantLocal(tenantId: string, event: string, data: unknown, id: string): void {
    assertBuiltinsIntact()
    const message = this.buildMessage(id, event, data)
    this.tally?.emitted('sse')
    this.deliverToAll(this.connections.byTenant(tenantId, 'sse'), message)
  }

  /**
   * Deliver an event to all local SSE connections that joined the given room.
   *
   * @internal Invoked only by RealtimePubSubSubscriber for remote re-emit; application code
   * must call the public emitToUser/emitToTenant/emitToRoom/broadcast/disconnect to preserve cross-instance delivery.
   * @remarks Events sent via tenant/room/broadcast are NOT written to the per-user replay
   * buffer or offline queue — only emitToUser populates per-user replay/offline state.
   */
  emitToRoomLocal(roomId: string, event: string, data: unknown, id: string): void {
    assertBuiltinsIntact()
    const message = this.buildMessage(id, event, data)
    this.tally?.emitted('sse')
    const members = this.rooms.members(roomId)
    // Stryker disable next-line EqualityOperator: equivalent — past the last member the element is `undefined`, which no connection is registered under, so the lookup finds none and nothing is delivered
    for (let i = 0; i < members.length; i += 1) {
      const conn = this.connections.get(members[i] as string)
      if (conn && conn.transport === 'sse') this.deliver(conn, message)
    }
  }

  /**
   * Deliver an event to all local SSE connections.
   *
   * @internal Invoked only by RealtimePubSubSubscriber for remote re-emit; application code
   * must call the public emitToUser/emitToTenant/emitToRoom/broadcast/disconnect to preserve cross-instance delivery.
   * @remarks Events sent via tenant/room/broadcast are NOT written to the per-user replay
   * buffer or offline queue — only emitToUser populates per-user replay/offline state.
   */
  broadcastLocal(event: string, data: unknown, id: string): void {
    assertBuiltinsIntact()
    const message = this.buildMessage(id, event, data)
    this.tally?.emitted('sse')
    this.deliverToAll(this.connections.allByTransport('sse'), message)
  }

  /**
   * Tear down a locally-owned SSE stream, then clean up (no re-publish).
   *
   * @internal Invoked only by RealtimePubSubSubscriber for remote re-emit; application code
   * must call the public emitToUser/emitToTenant/emitToRoom/broadcast/disconnect to preserve cross-instance delivery.
   */
  async disconnectLocal(connectionId: string, reason?: string): Promise<void> {
    assertBuiltinsIntact()
    const record = this.connections.get(connectionId)
    if (!record || record.transport !== 'sse') return
    // The record goes first, so that the stream's own finalize, which calls unregisterConnection,
    // finds nothing to do and the reason reaches onDisconnect. The client is then cut, and only after
    // that does any consumer code run: a hook that is slow or never settles cannot keep it connected.
    const released = this.release(connectionId)
    record.close$?.next()
    record.close$?.complete()
    if (released) await this.notifyDisconnect(released, reason)
  }

  private buildMessage(id: string, event: string, data: unknown): Frame {
    return { id, type: event, data: data as object }
  }

  /** Deliver to one connection, isolating failures so others still receive the event. */
  private deliver(conn: ConnectionRecord, message: Frame): void {
    try {
      const tracked = this.outbound.get(conn.connectionId)
      if (tracked && !tracked.backlog.admit(frameBytes(message))) {
        this.cutSlowConsumer(conn.connectionId, 'its client has not read what was sent', tracked)
        return
      }
      conn.subject?.next(message)
    } catch (error) {
      logEvent(
        this.logger,
        'warn',
        'REALTIME_DELIVERY_FAILED',
        `SSE delivery failed`,
        {
          connectionId: conn.connectionId,
        },
        error,
      )
    }
  }

  /** Start bounding a connection's backlog, when its response can be measured. */
  private track(params: RegisterSseConnectionParams): void {
    const { outbound: probe } = params
    const sse = this.options.sse
    if (!probe) return
    this.outbound.set(params.connectionId, {
      probe,
      backlog: new OutboundBacklog(
        { maxBytes: sse?.maxQueuedBytes ?? 0, maxEvents: sse?.maxQueuedEvents ?? 0 },
        probe,
      ),
      stall: new StallWatch(sse?.stallHeartbeats ?? 0),
    })
  }

  /** Called on each heartbeat: closes a connection whose client has stopped reading altogether. */
  checkStall(connectionId: string): void {
    const tracked = this.outbound.get(connectionId)
    if (tracked?.stall.stalled(tracked.probe)) {
      this.cutSlowConsumer(
        connectionId,
        'its socket has taken nothing for several heartbeats',
        tracked,
      )
    }
  }

  private cutSlowConsumer(connectionId: string, why: string, tracked: Outbound): void {
    this.tally?.evicted('slow_consumer')
    this.tally?.slowConsumerDropped()
    logEvent(this.logger, 'warn', 'REALTIME_SLOW_CONSUMER', `closing an SSE connection, ${why}`, {
      connectionId,
      queuedEvents: tracked.backlog.queuedEvents,
      queuedBytes: tracked.backlog.queuedBytes,
      heldBytes: tracked.probe.buffered(),
    })
    this.disconnectLocal(connectionId, REALTIME_ERROR_CODES.SLOW_CONSUMER).catch(
      (error: unknown) => {
        logEvent(
          this.logger,
          'warn',
          'REALTIME_DISCONNECT_FAILED',
          `Closing a slow SSE connection failed`,
          { connectionId },
          error,
        )
      },
    )
  }

  /** Publish once to the bus; resolves with the failure, or `undefined` once the bus accepted it. */
  private async tryPublish(
    message: Omit<RealtimePubSubMessage, 'origin'>,
  ): Promise<Failure | undefined> {
    try {
      await this.pubsub.publish({ ...message, origin: this.instanceId })
      return undefined
    } catch (error) {
      return { error }
    }
  }

  /** Publish once to the bus. A failure is reported and never fails the live emit path. */
  private async publish(message: Omit<RealtimePubSubMessage, 'origin'>): Promise<void> {
    const failure = await this.tryPublish(message)
    if (failure !== undefined) this.reportPublishFailure(message.op, failure)
  }

  private reportPublishFailure(op: string, { error }: Failure): void {
    reportDeliveryFailure(
      this.logger,
      this.hooks,
      { code: REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE, op, error },
      'pubsub.publish failed',
    )
  }

  /** Evict a user's oldest connections (FIFO) when over `maxConnectionsPerUser`. */
  private async evictBeyondLimit(userId: string): Promise<void> {
    const max = this.options.sse?.maxConnectionsPerUser
    if (max === undefined || max <= 0) return
    let userConnections = this.connections.byUser(userId, 'sse')
    while (userConnections.length > max) {
      const oldest = userConnections.reduce((a, b) => (a.connectedAt <= b.connectedAt ? a : b))
      this.tally?.evicted('per_user_cap')
      await this.disconnectLocal(oldest.connectionId, REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS)
      userConnections = this.connections.byUser(userId, 'sse')
    }
  }
}
