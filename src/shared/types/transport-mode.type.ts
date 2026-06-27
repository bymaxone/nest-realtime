/**
 * @fileoverview Config-level transport mode selection.
 * @layer shared
 */

/**
 * Transport mode chosen by the consumer at module configuration time.
 *
 * - `sse`        — Server-Sent Events only. HTTP-based, server → client push.
 * - `websocket`  — Socket.IO only. Full duplex.
 * - `both`       — Compose SSE and WebSocket. Useful during migrations or when
 *                  different product surfaces need different transports.
 *
 * Distinct from `ITransport.kind` (`'sse' | 'websocket'`), which identifies a
 * single concrete transport implementation. See
 * `docs/technical_specification.md` §1.3 for selection criteria.
 *
 * @example
 * ```ts
 * const mode: TransportMode = 'sse'
 * ```
 */
export type TransportMode = 'sse' | 'websocket' | 'both'
