/**
 * @fileoverview Optional connection lifecycle hooks the consumer can provide.
 * @layer contracts
 */

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

  /** Called on a transport error. */
  onError?(meta: {
    connectionId?: string
    error: Error
    transport: 'sse' | 'websocket'
  }): void | Promise<void>

  /** Called on re-authentication failure, before disconnect. */
  onReauthenticationFailed?(meta: ConnectionEventMeta): void | Promise<void>
}
