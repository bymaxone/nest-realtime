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
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RoomRegistry } from '../../services/room-registry.service'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../../constants/injection-tokens.constants'
import { ROOM_PREFIXES } from '../../constants/room-prefixes.constants'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'

/**
 * Prefix of the per-socket room each connection joins at registration. It makes
 * a single connection addressable as `connection:{connectionId}` so revocation
 * can target it via the adapter-aware `disconnectSockets`, reaching the socket on
 * whatever node currently holds it (cross-node revocation under
 * `@socket.io/redis-adapter`). This is an internal addressing room, not a
 * consumer-facing application room.
 */
const CONNECTION_ROOM_PREFIX = 'connection'

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
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
  ) {}

  /**
   * Wire the Socket.IO server. Called by `RealtimeGateway.afterInit`.
   *
   * All emit methods silently no-op until this is called, so the transport is
   * safe to construct before the HTTP server is ready.
   *
   * @param server - The live Socket.IO `Server` instance from the NestJS gateway.
   */
  setServer(server: Server): void {
    this.server = server
    this.logger.log('Socket.IO server wired to WebSocketTransport')
  }

  /**
   * Resolve the map of locally-connected sockets, tolerating both server shapes.
   *
   * A root Socket.IO `Server` exposes the socket map at `.sockets.sockets` (its
   * `.sockets` is the root `Namespace`). When `websocket.namespace` is configured,
   * `RealtimeIoAdapter` wires the gateway to a `Namespace` instead, whose own
   * `.sockets` IS the socket map. Per-socket lookups (join/leave/disconnect) use
   * this indirection so they work under either shape.
   */
  private localSockets(): Map<string, Socket> | undefined {
    const server = this.server
    if (!server) return undefined
    const sockets = (server as unknown as { sockets: unknown }).sockets
    return sockets instanceof Map
      ? (sockets as Map<string, Socket>)
      : (sockets as { sockets: Map<string, Socket> }).sockets
  }

  /**
   * Expose the configured authenticator to the gateway.
   *
   * The gateway uses this to avoid a circular injection: `RealtimeGateway` →
   * `WebSocketTransport` → authenticator, rather than injecting the token
   * directly in the gateway.
   *
   * @returns The consumer-provided `IConnectionAuthenticator` instance.
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
   *
   * @param socket - The authenticated Socket.IO socket instance.
   * @param auth - The resolved authentication result containing userId, tenantId, and roles.
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
    // Per-connection room — enables adapter-aware cross-node revocation in disconnect().
    await socket.join(`${CONNECTION_ROOM_PREFIX}:${socket.id}`)

    this.rooms.join(socket.id, `${ROOM_PREFIXES.USER}:${auth.userId}`)
    if (auth.tenantId) this.rooms.join(socket.id, `${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)

    await this.evictBeyondLimit(auth.userId)

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
   *
   * @param connectionId - The Socket.IO socket `id` of the disconnected connection.
   * @param reason - Optional reason string forwarded to the `onDisconnect` hook.
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

  /**
   * Send an event to every connection of a user (uses `user:{userId}` room).
   *
   * @param userId - Target user identifier.
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all matching connections.
   */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.USER}:${userId}`).emit(event, data)
  }

  /**
   * Send an event to every connection within a tenant (uses `tenant:{tenantId}` room).
   *
   * @param tenantId - Target tenant identifier.
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all matching connections.
   */
  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.TENANT}:${tenantId}`).emit(event, data)
  }

  /**
   * Send an event to every connection in an arbitrary room.
   *
   * @param roomId - The fully-qualified room identifier (e.g., `user:u-1`, `tenant:t-1`).
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all connections in the room.
   */
  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(roomId).emit(event, data)
  }

  /**
   * Broadcast an event to all connected clients.
   *
   * @param event - Event name to emit.
   * @param data - Payload forwarded to every connected socket.
   */
  async broadcast(event: string, data: unknown): Promise<void> {
    this.server?.emit(event, data)
  }

  /**
   * Join a connection to an additional room (updates both Socket.IO and `RoomRegistry`).
   *
   * @param connectionId - The socket `id` of the connection to join.
   * @param roomId - The room to join.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.localSockets()?.get(connectionId)
    if (socket) {
      await socket.join(roomId)
      this.rooms.join(connectionId, roomId)
    }
  }

  /**
   * Remove a connection from a room (updates both Socket.IO and `RoomRegistry`).
   *
   * @param connectionId - The socket `id` of the connection to remove.
   * @param roomId - The room to leave.
   */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.localSockets()?.get(connectionId)
    if (socket) {
      await socket.leave(roomId)
      this.rooms.leave(connectionId, roomId)
    }
  }

  /**
   * Force-disconnect a specific connection — adapter-aware, so revocation works
   * across nodes.
   *
   * A socket local to this node is closed directly as a fast path. Regardless,
   * `disconnectSockets` is broadcast to the connection's `connection:{id}` room:
   * under `@socket.io/redis-adapter` this fans out to remote nodes, so a
   * connection pinned to another instance is still force-closed. The local socket
   * has already left the room by then, so the broadcast does not double-close it.
   *
   * @param connectionId - The socket `id` of the connection to disconnect.
   * @param _reason - Optional reason string (unused at the Socket.IO level; passed to `unregisterSocket`).
   */
  async disconnect(connectionId: string, _reason?: string): Promise<void> {
    const server = this.server
    if (!server) return
    const local = this.localSockets()?.get(connectionId)
    if (local) local.disconnect(true)
    server.in(`${CONNECTION_ROOM_PREFIX}:${connectionId}`).disconnectSockets(true)
  }

  /**
   * Evict the user's oldest WebSocket connections (FIFO) when over
   * `websocket.maxConnectionsPerUser`. Emits `REALTIME_TOO_MANY_CONNECTIONS`
   * as the disconnect reason — never rejects the new connection with HTTP 429.
   */
  private async evictBeyondLimit(userId: string): Promise<void> {
    const max = this.options.websocket?.maxConnectionsPerUser
    if (max === undefined || max <= 0) return

    let userConnections = this.connections.byUser(userId, 'websocket')
    while (userConnections.length > max) {
      const oldest = userConnections.reduce((a, b) => (a.connectedAt <= b.connectedAt ? a : b))
      await this.disconnect(oldest.connectionId, REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS)
      await this.unregisterSocket(oldest.connectionId, REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS)
      userConnections = this.connections.byUser(userId, 'websocket')
    }
  }
}
