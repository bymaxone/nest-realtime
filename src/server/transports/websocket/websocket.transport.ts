/**
 * @fileoverview ITransport implementation over Socket.IO (opt-in WebSocket transport).
 * @layer transport
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Server, Socket } from 'socket.io'
import type { ITransport } from '../../interfaces/transport.interface'
import type {
  IConnectionAuthenticator,
  AuthenticationResult,
} from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RoomRegistry } from '../../services/room-registry.service'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
} from '../../constants/injection-tokens.constants'
import { ROOM_PREFIXES } from '../../constants/room-prefixes.constants'

/**
 * WebSocket transport implementing `ITransport` over a Socket.IO `Server`.
 *
 * Emit methods call `server.to(room).emit(event, data)`. Cross-instance fan-out
 * is handled exclusively by `@socket.io/redis-adapter` (spec §11.4) — this class
 * never calls `IRealtimePubSub.publish` for WS messages.
 *
 * The Socket.IO `Server` instance is injected lazily via `setServer` (called by
 * `RealtimeGateway.afterInit`) because the server only exists after NestJS boots
 * the gateway. All emit methods are safe no-ops while the server is unset.
 */
@Injectable()
export class WebSocketTransport implements ITransport {
  readonly kind = 'websocket' as const
  private readonly logger = new Logger(WebSocketTransport.name)
  /** Nullable until the gateway's afterInit wires the instance. */
  private server: Server | null = null

  constructor(
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
    @Inject(RoomRegistry) private readonly rooms: RoomRegistry,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
  ) {}

  /**
   * Wire the Socket.IO server. Called by `RealtimeGateway.afterInit`.
   *
   * All emit methods silently no-op until this is called, so the transport is
   * safe to construct before the HTTP server is ready.
   */
  setServer(server: Server): void {
    this.server = server
    this.logger.log('Socket.IO server wired to WebSocketTransport')
  }

  /**
   * Expose the configured authenticator to the gateway.
   *
   * The gateway uses this to avoid a circular injection: `RealtimeGateway` →
   * `WebSocketTransport` → authenticator, rather than injecting the token
   * directly in the gateway.
   */
  authenticator(): IConnectionAuthenticator {
    return this.auth
  }

  /**
   * Register a freshly-authenticated WebSocket connection.
   *
   * Stores the connection record in `ConnectionRegistry` (with `subject: null` —
   * WS connections have no RxJS stream), auto-joins the canonical rooms, mirrors
   * membership into `RoomRegistry`, and fires the `onConnect` lifecycle hook.
   *
   * Cross-instance fan-out is handled by `@socket.io/redis-adapter`; this method
   * does not publish to `IRealtimePubSub`.
   */
  async registerSocket(socket: Socket, auth: AuthenticationResult): Promise<void> {
    const connectedAt = new Date()
    this.connections.register({
      connectionId: socket.id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      transport: 'websocket',
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      connectedAt,
      subject: null,
      close$: null,
      originalAuth: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
    })

    await socket.join(`${ROOM_PREFIXES.USER}:${auth.userId}`)
    if (auth.tenantId) await socket.join(`${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)

    this.rooms.join(socket.id, `${ROOM_PREFIXES.USER}:${auth.userId}`)
    if (auth.tenantId) this.rooms.join(socket.id, `${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)

    await this.hooks.onConnect?.({
      connectionId: socket.id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      transport: 'websocket',
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      connectedAt,
    })
  }

  /**
   * Unregister a disconnected WebSocket connection.
   *
   * Removes the record from `ConnectionRegistry`, clears all room membership
   * from `RoomRegistry`, and fires the `onDisconnect` lifecycle hook with the
   * computed `durationMs`.
   */
  async unregisterSocket(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.unregister(connectionId)
    if (!record) return
    this.rooms.leaveAll(connectionId)
    const disconnectMeta = {
      connectionId,
      userId: record.userId,
      tenantId: record.tenantId,
      transport: 'websocket' as const,
      ip: record.ip,
      userAgent: record.userAgent,
      connectedAt: record.connectedAt,
      durationMs: Date.now() - record.connectedAt.getTime(),
      ...(reason !== undefined ? { reason } : {}),
    }
    await this.hooks.onDisconnect?.(disconnectMeta)
  }

  /** Send an event to every connection of a user (uses `user:{userId}` room). */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.USER}:${userId}`).emit(event, data)
  }

  /** Send an event to every connection within a tenant (uses `tenant:{tenantId}` room). */
  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.TENANT}:${tenantId}`).emit(event, data)
  }

  /** Send an event to every connection in an arbitrary room. */
  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(roomId).emit(event, data)
  }

  /** Broadcast an event to all connected clients. */
  async broadcast(event: string, data: unknown): Promise<void> {
    this.server?.emit(event, data)
  }

  /** Join a connection to an additional room (updates both Socket.IO and `RoomRegistry`). */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) {
      await socket.join(roomId)
      this.rooms.join(connectionId, roomId)
    }
  }

  /** Remove a connection from a room (updates both Socket.IO and `RoomRegistry`). */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) {
      await socket.leave(roomId)
      this.rooms.leave(connectionId, roomId)
    }
  }

  /** Force-disconnect a specific connection via the Socket.IO API. */
  async disconnect(connectionId: string, _reason?: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) socket.disconnect(true)
  }
}
