/**
 * @fileoverview Composite transport fanning out to both SSE and WebSocket for `transport: 'both'`.
 * @layer transport
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  assertBuiltinsIntact,
  awaitable,
  describeError,
  logEvent,
  REALTIME_ERROR_CODES,
  SseTransport,
  shielded,
  started,
  unavailableError,
  refuseReservedRoom,
  requireRoomName,
  returnable,
} from '@bymax-one/nest-realtime/internal'
import type { ITransport } from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from '../websocket/websocket.transport'

/** The two operations a call is made of, one per transport. */
type Tasks = [() => Promise<void>, () => Promise<void>]

/** What each of the two settled with, in plain fields. */
interface Outcomes {
  firstFailed: boolean
  secondFailed: boolean
  firstReason: unknown
  secondReason: unknown
}

/**
 * Fan-out transport activated when `transport: 'both'`.
 *
 * Every `emitTo*` and `broadcast` invokes both SSE and WebSocket transports in
 * parallel via `Promise.allSettled` so a failure in one never aborts the other.
 * A failure of one is logged as a warning and the call resolves; a failure of both
 * rejects.
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
    await awaitable(
      this.fanOut(
        'emitToUser',
        () => this.sse.emitToUser(userId, event, data),
        () => this.ws.emitToUser(userId, event, data),
      ),
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
    await awaitable(
      this.fanOut(
        'emitToTenant',
        () => this.sse.emitToTenant(tenantId, event, data),
        () => this.ws.emitToTenant(tenantId, event, data),
      ),
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
    requireRoomName('emitToRoom', roomId)
    await awaitable(
      this.fanOut(
        'emitToRoom',
        () => this.sse.emitToRoom(roomId, event, data),
        () => this.ws.emitToRoom(roomId, event, data),
      ),
    )
  }

  /**
   * Broadcast to all connected clients across both transports.
   *
   * @param event - Event name to emit.
   * @param data - Payload forwarded to every connected client.
   */
  async broadcast(event: string, data: unknown): Promise<void> {
    await awaitable(
      this.fanOut(
        'broadcast',
        () => this.sse.broadcast(event, data),
        () => this.ws.broadcast(event, data),
      ),
    )
  }

  /**
   * Join a connection to a room.
   *
   * Both transports are asked; the one that holds the connection acts. Rejects with the
   * failure of whichever transport failed.
   */
  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    refuseReservedRoom('joinRoom', roomId)
    await awaitable(
      this.settleBoth('joinRoom', connectionId, [
        () => this.sse.joinRoom(connectionId, roomId),
        () => this.ws.joinRoom(connectionId, roomId),
      ]),
    )
  }

  /**
   * Remove a connection from a room.
   *
   * Both transports are asked; the one that holds the connection acts. Rejects with the
   * failure of whichever transport failed: a client left in a room it was removed from keeps
   * receiving that room's events.
   */
  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    refuseReservedRoom('leaveRoom', roomId)
    await awaitable(
      this.settleBoth('leaveRoom', connectionId, [
        () => this.sse.leaveRoom(connectionId, roomId),
        () => this.ws.leaveRoom(connectionId, roomId),
      ]),
    )
  }

  /**
   * Disconnect a specific connection.
   *
   * Both transports are asked; the one that holds the connection disconnects it. Rejects when
   * either one could not: the revocation has not reached the connection.
   */
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    await awaitable(
      this.settleBoth('disconnect', connectionId, [
        () => this.sse.disconnect(connectionId, reason),
        () => this.ws.disconnect(connectionId, reason),
      ]),
    )
  }

  /**
   * Run a per-connection operation on both transports and reject if either failed.
   *
   * One failure is rethrown as it is; both are reported together under
   * `REALTIME_TRANSPORT_UNAVAILABLE`, with every reason in `cause`.
   */
  private async settleBoth(op: string, connectionId: string, tasks: Tasks): Promise<void> {
    const outcome = await shielded(this.outcomes(tasks))
    if (!outcome.firstFailed && !outcome.secondFailed) return
    if (outcome.firstFailed !== outcome.secondFailed)
      throw outcome.firstFailed ? outcome.firstReason : outcome.secondReason
    throw this.allFailed(`${op} of ${connectionId}`, [outcome.firstReason, outcome.secondReason])
  }

  /**
   * Run two transport tasks, both started before either is awaited.
   *
   * One task failing is logged as a warning and the call resolves, so one failing transport
   * never blocks delivery on the other. Every task failing rejects.
   */
  private async fanOut(op: string, ...tasks: Tasks): Promise<void> {
    const outcome = await shielded(this.outcomes(tasks))
    if (outcome.firstFailed && outcome.secondFailed)
      throw this.allFailed(op, [outcome.firstReason, outcome.secondReason])
    if (outcome.firstFailed) this.warnPartial(op, outcome.firstReason)
    if (outcome.secondFailed) this.warnPartial(op, outcome.secondReason)
  }

  private warnPartial(op: string, reason: unknown): void {
    logEvent(
      this.logger,
      'warn',
      'REALTIME_COMPOSITE_PARTIAL_FAILURE',
      `Composite ${op} partially failed`,
      { op },
      reason,
    )
  }

  /**
   * What each of two tasks settled with, read into plain fields: no array is built, pushed to or iterated while a host
   * call can still have replaced `push` or the iterator, and the baseline is asserted last, after every host call, so a
   * replacement a task planted refuses the call instead of answering for it.
   */
  private async outcomes(tasks: Tasks): Promise<Outcomes> {
    const a = started(tasks[0])
    const b = started(tasks[1])
    let firstFailed = false
    let secondFailed = false
    let firstReason: unknown
    let secondReason: unknown
    try {
      await a
    } catch (error) {
      firstFailed = true
      firstReason = error
    }
    try {
      await b
    } catch (error) {
      secondFailed = true
      secondReason = error
    }
    assertBuiltinsIntact()
    // The last thing before the return: resolving with an object asks it, and what it inherits from, for a `then`.
    return returnable({ firstFailed, secondFailed, firstReason, secondReason })
  }

  /** The rejection for an operation that failed on every transport, with every reason in `cause`. */
  private allFailed(what: string, reasons: unknown[]): Error {
    return unavailableError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      CompositeTransport.name,
      `${what} failed on both transports`,
      new AggregateError(reasons, reasons.map(describeError).join('; ')),
    )
  }
}
