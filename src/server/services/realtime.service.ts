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

  /** Add a specific connection to a room. */
  joinRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.joinRoom(connectionId, roomId)
  }

  /** Remove a specific connection from a room. */
  leaveRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.leaveRoom(connectionId, roomId)
  }

  /** Force-disconnect a specific connection (e.g. on auth revocation). */
  disconnect(connectionId: string, reason?: string): Promise<void> {
    return this.transport.disconnect(connectionId, reason)
  }
}
