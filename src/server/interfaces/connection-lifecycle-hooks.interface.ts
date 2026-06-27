/**
 * @fileoverview Optional connection lifecycle hooks the consumer can provide.
 * @layer contracts
 */

/** Metadata describing a connection at a lifecycle transition. */
export interface ConnectionEventMeta {
  readonly connectionId: string
  readonly userId: string
  readonly tenantId: string | undefined
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
