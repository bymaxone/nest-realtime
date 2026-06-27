/**
 * @fileoverview Public-facing metadata about a single realtime connection.
 * @layer shared
 */

/**
 * Public-facing metadata about a single realtime connection.
 *
 * The full internal record (which, for SSE, also holds the per-connection RxJS
 * `Subject` and `close$` teardown signal) is kept private to the server runtime —
 * see `src/server/services/connection-registry.service.ts`. This type exposes only
 * the fields that are safe to share with diagnostics and the client.
 */
export interface PublicConnectionMeta {
  readonly connectionId: string
  readonly userId: string
  readonly tenantId?: string
  readonly transport: 'sse' | 'websocket'
  readonly connectedAt: Date
}
