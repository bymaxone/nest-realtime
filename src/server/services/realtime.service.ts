/**
 * @fileoverview Transport-agnostic public realtime API.
 * @layer application
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import {
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from '../constants/injection-tokens.constants'
import type { IRealtimePubSub } from '../interfaces/realtime-pubsub.interface'
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeMetricsTally } from '../observability/realtime-metrics-tally'
import { assertBuiltinsIntact } from '../utils/builtin-baseline'
import { callHostMethod } from '../utils/read-host-key'
import { refuseReservedRoom, requireRoomName } from '../utils/reserved-room'

/**
 * Transport-agnostic realtime API.
 *
 * Every method delegates to the active transport, so switching transport (for
 * example `'sse'` → `'websocket'`) requires no change in the application services
 * that call this API.
 */
@Injectable()
export class RealtimeService {
  constructor(
    @Inject(REALTIME_TRANSPORT_TOKEN) private readonly transport: ITransport,
    @Optional() @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub?: IRealtimePubSub,
    // Optional so the service can be unit-constructed in isolation; the module always provides it.
    @Optional() @Inject(RealtimeMetricsTally) private readonly tally?: RealtimeMetricsTally,
  ) {}

  /**
   * Whether this instance hears the events and revocations other instances publish. False while
   * the bus is unreachable or its subscriber connection is down, so a readiness probe can take a
   * deaf instance out of rotation. True for a bus that does not report a state, and with
   * `transport: 'websocket'`, which does not subscribe to the bus.
   *
   * @example
   * ```ts
   * // In a health indicator: `isHealthy` is false while the instance cannot hear the others.
   * return indicator.check('realtime', realtime.isPubSubReady())
   * ```
   */
  isPubSubReady(): boolean {
    // Only the SSE wiring subscribes to the bus; WebSocket-only scaling goes through the adapter.
    if (this.transport.kind === 'websocket') return true
    return callHostMethod<boolean>(this.pubsub, 'isSubscribed', []) ?? true
  }

  /**
   * Send to all of a user's connections (across devices/tabs).
   *
   * @example
   * ```ts
   * await realtime.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
   * ```
   */
  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    return this.transport.emitToUser(userId, event, data)
  }

  /** Send to every connection in a tenant. */
  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    return this.transport.emitToTenant(tenantId, event, data)
  }

  /**
   * Send to a logical room. Use the prefix convention (`user:{id}`,
   * `tenant:{id}`, `resource:{type}:{id}`) or a custom non-colliding id.
   *
   * @throws {Error} `REALTIME_AUTH_FAILED` when `roomId` is not a non-empty string: socket.io
   *   reads an array as several rooms.
   */
  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    requireRoomName('emitToRoom', roomId)
    return this.transport.emitToRoom(roomId, event, data)
  }

  /** Send to every connected client. Use sparingly. */
  async broadcast(event: string, data: unknown): Promise<void> {
    assertBuiltinsIntact()
    return this.transport.broadcast(event, data)
  }

  /**
   * Add a specific connection to a room.
   *
   * Rooms of the application's own are free-form, but a name that starts with `user:`,
   * `tenant:` or `connection:` is refused, the rule that `AuthenticationResult.rooms` is
   * held to: joining `tenant:<other>` would receive that tenant's events. A `roomId` that is
   * not a non-empty string is refused too, whatever it holds: socket.io reads an array as
   * several room names.
   *
   * Acts on a connection this instance holds; for any other id it resolves and changes
   * nothing. A failure of the transport that holds the connection rejects the call.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    assertBuiltinsIntact()
    refuseReservedRoom('joinRoom', roomId)
    return this.transport.joinRoom(connectionId, roomId)
  }

  /**
   * Remove a specific connection from a room. A name that starts with `user:`, `tenant:` or
   * `connection:` is refused, as in `joinRoom`, and so is a `roomId` that is not a non-empty string.
   *
   * Acts on a connection this instance holds; for any other id it resolves and changes
   * nothing. A failure of the transport that holds the connection rejects the call.
   */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    assertBuiltinsIntact()
    refuseReservedRoom('leaveRoom', roomId)
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
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    assertBuiltinsIntact()
    await this.transport.disconnect(connectionId, reason)
    // Counted here, once, because under `'both'` the composite asks each transport to close the id.
    this.tally?.evicted('revoked')
  }
}
