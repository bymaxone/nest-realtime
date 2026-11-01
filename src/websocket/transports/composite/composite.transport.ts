/**
 * @fileoverview Composite transport fanning out to both SSE and WebSocket for `transport: 'both'`.
 * @layer transport
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  describeError,
  REALTIME_ERROR_CODES,
  SseTransport,
  unavailableError,
} from '@bymax-one/nest-realtime/internal'
import type { ITransport } from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from '../websocket/websocket.transport'

/**
 * Fan-out transport activated when `transport: 'both'`.
 *
 * Every `emitTo*` and `broadcast` invokes both SSE and WebSocket transports in
 * parallel via `Promise.allSettled` so a failure in one never aborts the other.
 * Failures are logged as warnings without rethrowing.
 *
 * `joinRoom`, `leaveRoom`, and `disconnect` ask both transports and settle both: each
 * transport acts only on a connection it holds, and a connection neither holds is handed
 * to the bus (SSE) and the adapter (WebSocket) for the instance that does. A failure of
 * either one rejects the call, because a revocation or a room change that did not happen
 * must not be reported as done. There is no double-delivery because each connection lives
 * on exactly one transport.
 *
 * `kind` reports `'sse'` (the dominant transport); `ITransport.kind` is
 * `'sse' | 'websocket'` — `'both'` is a module-level `TransportMode`, not a
 * valid per-transport kind (spec §6.3).
 */
@Injectable()
export class CompositeTransport implements ITransport {
  readonly kind = 'sse' as const
  private readonly logger = new Logger(CompositeTransport.name)

  constructor(
    @Inject(SseTransport) private readonly sse: SseTransport,
    @Inject(WebSocketTransport) private readonly ws: WebSocketTransport,
  ) {}

  /**
   * Emit to all connections of a user across both transports.
   *
   * @param userId - Target user identifier.
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all matching connections.
   */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToUser',
      () => this.sse.emitToUser(userId, event, data),
      () => this.ws.emitToUser(userId, event, data),
    )
  }

  /**
   * Emit to all connections within a tenant across both transports.
   *
   * @param tenantId - Target tenant identifier.
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all matching connections.
   */
  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToTenant',
      () => this.sse.emitToTenant(tenantId, event, data),
      () => this.ws.emitToTenant(tenantId, event, data),
    )
  }

  /**
   * Emit to all connections in a room across both transports.
   *
   * @param roomId - The fully-qualified room identifier.
   * @param event - Event name to emit.
   * @param data - Payload forwarded to all connections in the room.
   */
  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToRoom',
      () => this.sse.emitToRoom(roomId, event, data),
      () => this.ws.emitToRoom(roomId, event, data),
    )
  }

  /**
   * Broadcast to all connected clients across both transports.
   *
   * @param event - Event name to emit.
   * @param data - Payload forwarded to every connected client.
   */
  async broadcast(event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'broadcast',
      () => this.sse.broadcast(event, data),
      () => this.ws.broadcast(event, data),
    )
  }

  /**
   * Join a connection to a room.
   *
   * Both transports are asked; the one that holds the connection acts. Rejects with the
   * failure of whichever transport failed.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    await this.settleBoth('joinRoom', connectionId, [
      () => this.sse.joinRoom(connectionId, roomId),
      () => this.ws.joinRoom(connectionId, roomId),
    ])
  }

  /**
   * Remove a connection from a room.
   *
   * Both transports are asked; the one that holds the connection acts. Rejects with the
   * failure of whichever transport failed: a client left in a room it was removed from keeps
   * receiving that room's events.
   */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    await this.settleBoth('leaveRoom', connectionId, [
      () => this.sse.leaveRoom(connectionId, roomId),
      () => this.ws.leaveRoom(connectionId, roomId),
    ])
  }

  /**
   * Disconnect a specific connection.
   *
   * Both transports are asked; the one that holds the connection disconnects it. Rejects when
   * either one could not: the revocation has not reached the connection.
   */
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    await this.settleBoth('disconnect', connectionId, [
      () => this.sse.disconnect(connectionId, reason),
      () => this.ws.disconnect(connectionId, reason),
    ])
  }

  /**
   * Run a per-connection operation on both transports and reject if either failed.
   *
   * One failure is rethrown as it is; both are reported together under
   * `REALTIME_TRANSPORT_UNAVAILABLE`, with every reason in `cause`.
   */
  private async settleBoth(
    op: string,
    connectionId: string,
    tasks: Array<() => Promise<void>>,
  ): Promise<void> {
    const results = await Promise.allSettled(tasks.map((t) => t()))
    const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []))
    if (reasons.length === 0) return
    if (reasons.length === 1) throw reasons[0]
    throw unavailableError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      CompositeTransport.name,
      `${op} of ${connectionId} failed on both transports`,
      new AggregateError(reasons),
    )
  }

  /**
   * Run two transport tasks in parallel via `Promise.allSettled`.
   *
   * A rejection in either task is logged as a warning and does not propagate,
   * ensuring one failing transport never blocks delivery on the other.
   */
  private async fanOut(op: string, ...tasks: Array<() => Promise<void>>): Promise<void> {
    const results = await Promise.allSettled(tasks.map((t) => t()))
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`Composite ${op} partially failed: ${describeError(result.reason)}`)
      }
    }
  }
}
