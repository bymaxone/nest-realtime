/**
 * @fileoverview Composite transport fanning out to both SSE and WebSocket for `transport: 'both'`.
 * @layer transport
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ITransport } from '../../interfaces/transport.interface'
import { SseTransport } from '../sse/sse.transport'
import { WebSocketTransport } from '../websocket/websocket.transport'

/**
 * Fan-out transport activated when `transport: 'both'`.
 *
 * Every `emitTo*` and `broadcast` invokes both SSE and WebSocket transports in
 * parallel via `Promise.allSettled` so a failure in one never aborts the other.
 * Failures are logged as warnings without rethrowing.
 *
 * `joinRoom`, `leaveRoom`, and `disconnect` attempt both transports tolerantly:
 * only the transport that owns the connection will succeed; the other's rejection
 * is swallowed. There is no double-delivery because each connection lives on
 * exactly one transport.
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

  /** Emit to all connections of a user across both transports. */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToUser',
      () => this.sse.emitToUser(userId, event, data),
      () => this.ws.emitToUser(userId, event, data),
    )
  }

  /** Emit to all connections within a tenant across both transports. */
  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToTenant',
      () => this.sse.emitToTenant(tenantId, event, data),
      () => this.ws.emitToTenant(tenantId, event, data),
    )
  }

  /** Emit to all connections in a room across both transports. */
  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut(
      'emitToRoom',
      () => this.sse.emitToRoom(roomId, event, data),
      () => this.ws.emitToRoom(roomId, event, data),
    )
  }

  /** Broadcast to all connected clients across both transports. */
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
   * Both transports are attempted; only the one that owns the connection
   * succeeds. The other's failure is expected and swallowed.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    await Promise.all([
      this.sse.joinRoom(connectionId, roomId).catch(() => undefined),
      this.ws.joinRoom(connectionId, roomId).catch(() => undefined),
    ])
  }

  /**
   * Remove a connection from a room.
   *
   * Both transports are attempted tolerantly — one will succeed, the other
   * may fail silently.
   */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    await Promise.all([
      this.sse.leaveRoom(connectionId, roomId).catch(() => undefined),
      this.ws.leaveRoom(connectionId, roomId).catch(() => undefined),
    ])
  }

  /**
   * Disconnect a specific connection.
   *
   * Both transports are attempted; the one owning the connection disconnects it.
   */
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    await Promise.all([
      this.sse.disconnect(connectionId, reason).catch(() => undefined),
      this.ws.disconnect(connectionId, reason).catch(() => undefined),
    ])
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
        this.logger.warn(
          `Composite ${op} partially failed: ${(result.reason as Error).message ?? result.reason}`,
        )
      }
    }
  }
}
