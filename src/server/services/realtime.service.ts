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
import { refuseReservedRoom, requireRoomName, requireUserId } from '../utils/reserved-room'
import { awaitable, shielded } from '../utils/within-deadline'

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
  emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      await awaitable(this.transport.emitToUser(userId, event, data))
    })
  }

  /** Send to every connection in a tenant. */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      await awaitable(this.transport.emitToTenant(tenantId, event, data))
    })
  }

  /**
   * Send to a logical room. Use the prefix convention (`user:{id}`,
   * `tenant:{id}`, `resource:{type}:{id}`) or a custom non-colliding id.
   *
   * @throws {Error} `REALTIME_AUTH_FAILED` when `roomId` is not a non-empty string: socket.io
   *   reads an array as several rooms.
   */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      requireRoomName('emitToRoom', roomId)
      await awaitable(this.transport.emitToRoom(roomId, event, data))
    })
  }

  /** Send to every connected client. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      await awaitable(this.transport.broadcast(event, data))
    })
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
  joinRoom(connectionId: string, roomId: string): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      refuseReservedRoom('joinRoom', roomId)
      await awaitable(this.transport.joinRoom(connectionId, roomId))
    })
  }

  /**
   * Remove a specific connection from a room. A name that starts with `user:`, `tenant:` or
   * `connection:` is refused, as in `joinRoom`, and so is a `roomId` that is not a non-empty string.
   *
   * Acts on a connection this instance holds; for any other id it resolves and changes
   * nothing. A failure of the transport that holds the connection rejects the call.
   */
  leaveRoom(connectionId: string, roomId: string): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      refuseReservedRoom('leaveRoom', roomId)
      await awaitable(this.transport.leaveRoom(connectionId, roomId))
    })
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
    return this.pinned(async () => {
      assertBuiltinsIntact()
      await awaitable(this.transport.disconnect(connectionId, reason))
      // Counted here, once, because under `'both'` the composite asks each transport to close the id.
      this.tally?.evicted('revoked')
    })
  }

  /**
   * Force-disconnect every connection of a user, on every instance (e.g. on logout).
   *
   * Resolves once the user's connections here are closed and the revocation has been handed to
   * the bus, or to the Socket.IO adapter, for the other instances. A connection still being
   * authenticated when the call is made is not covered, so revoke the credential first.
   * `@socket.io/redis-adapter` does not wait for its own publish, so a publish that fails there
   * is not reported.
   *
   * @throws {Error} `REALTIME_AUTH_FAILED` when `userId` is not a non-empty string,
   *   `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses the revocation, or
   *   `REALTIME_TRANSPORT_UNAVAILABLE` when the transport fails. A connection may still be
   *   open: retry.
   *
   * @example
   * ```ts
   * await sessions.revokeAll(userId)
   * await realtime.disconnectUser(userId, 'logout')
   * ```
   */
  disconnectUser(userId: string, reason?: string): Promise<void> {
    return this.pinned(async () => {
      assertBuiltinsIntact()
      requireUserId('disconnectUser', userId)
      await awaitable(this.transport.disconnectUser(userId, reason))
      // One for each call, as in `disconnect`: the connections other instances close are not known here.
      this.tally?.evicted('revoked')
    })
  }

  /**
   * The promise a public method hands its caller, given its own `constructor` before anything else can read it: the
   * caller's `await` then reads neither the shared slot nor a `then`, and a revocation or a room change cannot be reported
   * as done by a host that replaced either while the transport ran.
   */
  private pinned(work: () => Promise<void>): Promise<void> {
    return shielded(work())
  }
}
