/**
 * @fileoverview Optional connection lifecycle hooks the consumer can provide.
 * @layer contracts
 */

import type { RealtimeErrorCode } from '../../shared/constants/error-codes.constants'

/**
 * A delivery path that failed without failing the call that depended on it, such as an emit
 * whose publish to the other instances was refused. The call still resolved; this is how the
 * failure becomes visible.
 */
export interface DeliveryFailure {
  /** The stable error code of the failure. */
  readonly code: RealtimeErrorCode
  /**
   * What was being delivered: an emit (`emitToUser`, `emitToTenant`, `emitToRoom`,
   * `broadcast`) or `offlineAppend` / `offlineRetrieve` for the offline queue.
   */
  readonly op: string
  /** The failure underneath. */
  readonly error: Error
}

/** Metadata describing a connection at a lifecycle transition. */
export interface ConnectionEventMeta {
  readonly connectionId: string
  readonly userId: string
  readonly tenantId: string | undefined
  /**
   * Roles the authenticator returned for this connection, as a snapshot taken at
   * connect time — `undefined` when the authenticator returned none.
   *
   * The library never interprets a role; it carries the consumer's own
   * authorization vocabulary through so `onConnect` can act on it (typically by
   * joining the connection to a role-scoped room). A later `revalidate` that
   * keeps the connection alive does not refresh this snapshot.
   */
  readonly roles: readonly string[] | undefined
  /**
   * The free-form `metadata` bag the authenticator returned, as a snapshot taken
   * at connect time — `undefined` when the authenticator returned none.
   *
   * This is the only channel that carries a value from the handshake into the
   * hooks that receive this type — `onConnect`, `onDisconnect` and
   * `onReauthenticationFailed`. `authenticate` sees the request headers but not
   * yet a `connectionId`, and those hooks see the `connectionId` but not the
   * headers, so anything read off the request — a `traceparent`, an
   * `x-request-id`, a plan tier — has to travel through here to be correlated
   * with a connection.
   *
   * `onError` does NOT receive this type and therefore carries no `metadata`:
   * it can fire before authentication has resolved, which is why even its
   * `connectionId` is optional.
   *
   * The library never inspects a key. Like `roles`, it is a snapshot: a later
   * `revalidate` that keeps the connection alive does not refresh it.
   */
  readonly metadata: Record<string, unknown> | undefined
  readonly transport: 'sse' | 'websocket'
  readonly ip: string
  readonly userAgent: string | undefined
  readonly connectedAt: Date
}

/**
 * Optional lifecycle hooks invoked by the active transport. Every hook may be
 * synchronous or asynchronous; rejected promises are isolated so one failing hook
 * never blocks delivery to other connections.
 */
export interface IConnectionLifecycleHooks {
  /** Called after authentication succeeds and the connection is registered. */
  onConnect?(meta: ConnectionEventMeta): void | Promise<void>

  /** Called when the connection closes for any reason. */
  onDisconnect?(
    meta: ConnectionEventMeta & { reason?: string; durationMs: number },
  ): void | Promise<void>

  /**
   * Called on a transport error.
   *
   * Deliberately NOT `ConnectionEventMeta`: this hook can fire before
   * authentication resolves, so there may be no connection to describe. It
   * carries no `roles` and no `metadata` — `connectionId` is optional for the
   * same reason. Pinned by a test, so widening this shape means updating the
   * documented guarantee with it.
   */
  onError?(meta: {
    connectionId?: string
    error: Error
    transport: 'sse' | 'websocket'
  }): void | Promise<void>

  /** Called on re-authentication failure, before disconnect. */
  onReauthenticationFailed?(meta: ConnectionEventMeta): void | Promise<void>

  /**
   * Called when a delivery path fails but the call that used it still resolves: the publish of an
   * emit to the other instances, or the offline queue. Count it to see cross-instance loss; it
   * is also logged with the same code. A throwing hook is logged and ignored.
   */
  onDeliveryFailure?(failure: DeliveryFailure): void | Promise<void>
}
