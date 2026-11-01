/**
 * @fileoverview Transport-agnostic public realtime API.
 * @layer application
 */
import { Inject, Injectable } from '@nestjs/common'
import { REALTIME_TRANSPORT_TOKEN } from '../constants/injection-tokens.constants'
import type { ITransport } from '../interfaces/transport.interface'

/**
 * Transport-agnostic realtime API.
 *
 * Every method delegates to the active transport, so switching transport (for
 * example `'sse'` → `'websocket'`) requires no change in the application services
 * that call this API.
 */
@Injectable()
export class RealtimeService {
  constructor(@Inject(REALTIME_TRANSPORT_TOKEN) private readonly transport: ITransport) {}

  /**
   * Send to all of a user's connections (across devices/tabs).
   *
   * @example
   * ```ts
   * await realtime.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
   * ```
   */
  emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToUser(userId, event, data)
  }

  /** Send to every connection in a tenant. */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToTenant(tenantId, event, data)
  }

  /**
   * Send to a logical room. Use the prefix convention (`user:{id}`,
   * `tenant:{id}`, `resource:{type}:{id}`) or a custom non-colliding id.
   */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToRoom(roomId, event, data)
  }

  /** Send to every connected client. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void> {
    return this.transport.broadcast(event, data)
  }

  /**
   * Add a specific connection to a room.
   *
   * The room id is not checked. Never pass client-supplied input that could start
   * with the reserved `user:` or `tenant:` prefixes: joining `tenant:<other>`
   * receives that tenant's events.
   *
   * Acts on a connection this instance holds; for any other id it resolves and changes
   * nothing. A failure of the transport that holds the connection rejects the call.
   */
  joinRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.joinRoom(connectionId, roomId)
  }

  /**
   * Remove a specific connection from a room.
   *
   * Acts on a connection this instance holds; for any other id it resolves and changes
   * nothing. A failure of the transport that holds the connection rejects the call.
   */
  leaveRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.leaveRoom(connectionId, roomId)
  }

  /**
   * Force-disconnect a specific connection (e.g. on auth revocation).
   *
   * Resolves once the connection is closed on this instance or the revocation has been handed
   * to the bus for the instance that holds it.
   *
   * @throws {Error} `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses the revocation, or
   *   `REALTIME_TRANSPORT_UNAVAILABLE` when the transport that holds the connection fails.
   *   The connection may still be connected: retry.
   */
  disconnect(connectionId: string, reason?: string): Promise<void> {
    return this.transport.disconnect(connectionId, reason)
  }
}
