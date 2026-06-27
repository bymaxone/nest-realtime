/**
 * @fileoverview Unified transport abstraction implemented by every transport.
 * @layer contracts
 */

/**
 * Unified transport abstraction.
 *
 * The library ships concrete implementations (`SseTransport`, the WebSocket
 * transport, and a composite that fans out to both). Consumers normally interact
 * with `RealtimeService`, which delegates to the active transport; implementing a
 * custom `ITransport` is an advanced use case (e.g. bridging an external bus).
 *
 * @example
 * ```ts
 * class NoopTransport implements ITransport {
 *   readonly kind = 'sse' as const
 *   async emitToUser() {}
 *   async emitToTenant() {}
 *   async emitToRoom() {}
 *   async broadcast() {}
 *   async joinRoom() {}
 *   async leaveRoom() {}
 *   async disconnect() {}
 * }
 * ```
 */
export interface ITransport {
  /** Transport identifier. A composite reports its dominant kind (`'sse'`). */
  readonly kind: 'sse' | 'websocket'

  /** Send to every connection of a single user. */
  emitToUser(userId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection of every user in a tenant. */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection in a logical room. */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void>

  /** Send to all connected clients. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void>

  /** Join a connection to a room (idempotent). */
  joinRoom(connectionId: string, roomId: string): Promise<void>

  /** Leave a connection from a room (idempotent). */
  leaveRoom(connectionId: string, roomId: string): Promise<void>

  /** Disconnect a specific connection (e.g. on auth revocation). */
  disconnect(connectionId: string, reason?: string): Promise<void>

  /** Lifecycle hook — called on NestJS bootstrap. */
  onModuleInit?(): Promise<void>

  /** Lifecycle hook — called on NestJS shutdown. */
  onApplicationShutdown?(): Promise<void>
}
