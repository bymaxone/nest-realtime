/**
 * @fileoverview SSE transport: local delivery + single cross-instance publish.
 * @layer transport
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Subject } from 'rxjs'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PUBSUB_TOKEN,
} from '../../constants/injection-tokens.constants'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionAuthenticator,
} from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../../interfaces/realtime-pubsub.interface'
import type { ITransport } from '../../interfaces/transport.interface'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import { composeRoomId } from '../../utils/compose-room-id'
import { EventReplayBuffer } from './event-replay-buffer'
import { HeartbeatService } from './heartbeat.service'

/** Default heartbeat interval when `sse.heartbeatMs` is unset. */
const DEFAULT_HEARTBEAT_MS = 30_000

interface EmitUserArgs {
  userId: string
  event: string
  data: unknown
  id: string
}
interface EmitTenantArgs {
  tenantId: string
  event: string
  data: unknown
  id: string
}
interface EmitRoomArgs {
  roomId: string
  event: string
  data: unknown
  id: string
}
interface BroadcastArgs {
  event: string
  data: unknown
  id: string
}
interface DisconnectArgs {
  connectionId: string
  reason: string | undefined
}

/** Parameters required to register a freshly authenticated SSE connection. */
export interface RegisterSseConnectionParams {
  connectionId: string
  auth: AuthenticationResult
  subject: Subject<MessageEvent>
  close$: Subject<void>
  ip: string
  userAgent: string | undefined
}

/**
 * SSE transport implementation.
 *
 * Each public `emitTo*`/`broadcast` performs local delivery via the matching
 * `*Local` method and then publishes exactly once to `IRealtimePubSub`. Remote
 * messages received from the bus are dispatched to the `*Local` methods only
 * (never re-published), and self-originated messages are filtered out — so a
 * single instance never double-delivers and multiple instances never ping-pong.
 *
 * Teardown of an SSE stream is driven by the per-connection `close$` subject:
 * `disconnectLocal` completes it (which ends the `@Sse` Observable via
 * `takeUntil`) before unregistering. See `docs/technical_specification.md` §6.1.
 */
@Injectable()
export class SseTransport implements ITransport {
  readonly kind = 'sse' as const
  private readonly logger = new Logger(SseTransport.name)
  private unsubscribe: (() => Promise<void>) | undefined

  constructor(
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
    @Inject(RoomRegistry) private readonly rooms: RoomRegistry,
    @Inject(EventReplayBuffer) private readonly replayBuffer: EventReplayBuffer,
    @Inject(EventIdGenerator) private readonly idGen: EventIdGenerator,
    @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
  ) {}

  /** Subscribe to the cross-instance bus and route remote messages to `*Local`. */
  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.pubsub.subscribe((message) => this.dispatchRemote(message))
  }

  /** Unsubscribe from the bus and tear down every SSE connection. */
  async onApplicationShutdown(): Promise<void> {
    if (this.unsubscribe) {
      await this.unsubscribe()
      this.unsubscribe = undefined
    }
    this.heartbeat.stopAll()
    // Await each teardown so onDisconnect hooks complete within the shutdown window
    // (RxJS finalize cannot await an async callback). disconnectLocal removes the
    // record first, so the stream's own finalize cleanup is then a harmless no-op.
    for (const conn of this.connections.allByTransport('sse')) {
      await this.disconnectLocal(conn.connectionId)
    }
  }

  /** The resolved heartbeat interval for this transport. */
  get heartbeatMs(): number {
    return this.options.sse?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  }

  /** Whether the `connection:established` event should be emitted on connect. */
  get emitConnectionEvent(): boolean {
    return this.options.sse?.emitConnectionEvent !== false
  }

  /** Authenticate a connection through the consumer-provided authenticator. */
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    return this.auth.authenticate(context)
  }

  /** Register an authenticated SSE connection and auto-join its user/tenant rooms. */
  async registerConnection(params: RegisterSseConnectionParams): Promise<void> {
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
      },
    }
    this.connections.register(record)
    this.rooms.join(params.connectionId, composeRoomId('USER', params.auth.userId))
    if (params.auth.tenantId !== undefined) {
      this.rooms.join(params.connectionId, composeRoomId('TENANT', params.auth.tenantId))
    }
    await this.evictBeyondLimit(params.auth.userId)
    try {
      await this.hooks.onConnect?.({
        connectionId: record.connectionId,
        userId: record.userId,
        tenantId: record.tenantId,
        transport: 'sse',
        ip: record.ip,
        userAgent: record.userAgent,
        connectedAt: record.connectedAt,
      })
    } catch (error) {
      this.logger.error(`onConnect hook failed: ${(error as Error).message}`)
    }
  }

  /** Idempotent cleanup for a connection — runs the disconnect hook exactly once. */
  async unregisterConnection(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.unregister(connectionId)
    if (!record) return
    this.rooms.leaveAll(connectionId)
    this.heartbeat.stop(connectionId)
    try {
      await this.hooks.onDisconnect?.({
        connectionId: record.connectionId,
        userId: record.userId,
        tenantId: record.tenantId,
        transport: 'sse',
        ip: record.ip,
        userAgent: record.userAgent,
        connectedAt: record.connectedAt,
        durationMs: Date.now() - record.connectedAt.getTime(),
        ...(reason !== undefined ? { reason } : {}),
      })
    } catch (error) {
      this.logger.error(`onDisconnect hook failed: ${(error as Error).message}`)
    }
  }

  /** Replay the events a user missed after `lastEventId`. */
  getReplayEvents(userId: string, lastEventId: string): MessageEvent[] {
    return this.replayBuffer.since(userId, lastEventId)
  }

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    const id = this.idGen.next()
    this.emitToUserLocal(userId, event, data, id)
    await this.publish({ op: 'emitToUser', args: { userId, event, data, id } })
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    const id = this.idGen.next()
    this.emitToTenantLocal(tenantId, event, data, id)
    await this.publish({ op: 'emitToTenant', args: { tenantId, event, data, id } })
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    const id = this.idGen.next()
    this.emitToRoomLocal(roomId, event, data, id)
    await this.publish({ op: 'emitToRoom', args: { roomId, event, data, id } })
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    const id = this.idGen.next()
    this.broadcastLocal(event, data, id)
    await this.publish({ op: 'broadcast', args: { event, data, id } })
  }

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.join(connectionId, roomId)
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.leave(connectionId, roomId)
  }

  /** Disconnect a connection locally if owned here, otherwise revoke cross-instance. */
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.get(connectionId)
    if (record && record.transport === 'sse') {
      await this.disconnectLocal(connectionId, reason)
      return
    }
    await this.publish({ op: 'disconnect', args: { connectionId, reason } })
  }

  emitToUserLocal(userId: string, event: string, data: unknown, id: string): void {
    const message = this.buildMessage(id, event, data)
    this.replayBuffer.append(userId, message)
    for (const conn of this.connections.byUser(userId, 'sse')) this.deliver(conn, message)
  }

  emitToTenantLocal(tenantId: string, event: string, data: unknown, id: string): void {
    const message = this.buildMessage(id, event, data)
    for (const conn of this.connections.byTenant(tenantId, 'sse')) this.deliver(conn, message)
  }

  emitToRoomLocal(roomId: string, event: string, data: unknown, id: string): void {
    const message = this.buildMessage(id, event, data)
    for (const connectionId of this.rooms.members(roomId)) {
      const conn = this.connections.get(connectionId)
      if (conn && conn.transport === 'sse') this.deliver(conn, message)
    }
  }

  broadcastLocal(event: string, data: unknown, id: string): void {
    const message = this.buildMessage(id, event, data)
    for (const conn of this.connections.allByTransport('sse')) this.deliver(conn, message)
  }

  /** Tear down a locally-owned SSE stream, then clean up (no re-publish). */
  async disconnectLocal(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.get(connectionId)
    if (!record || record.transport !== 'sse') return
    // Clean up with the reason BEFORE closing the stream. The stream's finalize
    // also calls unregisterConnection, but the record is already gone by then, so
    // that call is a no-op and the disconnect reason still reaches onDisconnect.
    await this.unregisterConnection(connectionId, reason)
    record.close$?.next()
    record.close$?.complete()
  }

  private buildMessage(id: string, event: string, data: unknown): MessageEvent {
    return { id, type: event, data: data as object }
  }

  /** Deliver to one connection, isolating failures so others still receive the event. */
  private deliver(conn: ConnectionRecord, message: MessageEvent): void {
    try {
      conn.subject?.next(message)
    } catch (error) {
      this.logger.warn(`SSE delivery failed for ${conn.connectionId}: ${(error as Error).message}`)
    }
  }

  /** Route a remote bus message to the matching `*Local` method (never re-publish). */
  private dispatchRemote(message: RealtimePubSubMessage): void {
    if (message.origin === this.instanceId) return
    switch (message.op) {
      case 'emitToUser': {
        const a = message.args as EmitUserArgs
        this.emitToUserLocal(a.userId, a.event, a.data, a.id)
        return
      }
      case 'emitToTenant': {
        const a = message.args as EmitTenantArgs
        this.emitToTenantLocal(a.tenantId, a.event, a.data, a.id)
        return
      }
      case 'emitToRoom': {
        const a = message.args as EmitRoomArgs
        this.emitToRoomLocal(a.roomId, a.event, a.data, a.id)
        return
      }
      case 'broadcast': {
        const a = message.args as BroadcastArgs
        this.broadcastLocal(a.event, a.data, a.id)
        return
      }
      case 'disconnect': {
        const a = message.args as DisconnectArgs
        void this.disconnectLocal(a.connectionId, a.reason)
        return
      }
    }
  }

  /** Publish once to the bus; pub/sub failures never affect the live emit path. */
  private async publish(message: Omit<RealtimePubSubMessage, 'origin'>): Promise<void> {
    try {
      await this.pubsub.publish({ ...message, origin: this.instanceId })
    } catch (error) {
      this.logger.warn(`pubsub.publish failed: ${(error as Error).message}`)
    }
  }

  /** Evict a user's oldest connections (FIFO) when over `maxConnectionsPerUser`. */
  private async evictBeyondLimit(userId: string): Promise<void> {
    const max = this.options.sse?.maxConnectionsPerUser
    if (max === undefined || max <= 0) return
    let userConnections = this.connections.byUser(userId, 'sse')
    while (userConnections.length > max) {
      const oldest = userConnections.reduce((a, b) => (a.connectedAt <= b.connectedAt ? a : b))
      await this.disconnectLocal(oldest.connectionId, REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS)
      userConnections = this.connections.byUser(userId, 'sse')
    }
  }
}
