/**
 * @fileoverview Universal realtime hook — auto-detects SSE vs WebSocket from the URL.
 * @layer react/hooks
 *
 * `useRealtime` selects the transport based on the URL scheme (or an explicit
 * `transport` override) and delegates to the appropriate internal hook. Both
 * internal hooks are always called (Rules of Hooks compliance); the inactive
 * one receives `enabled: false` and remains a no-op.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { useRealtimeSse } from '../internal/use-realtime-sse'
import { useRealtimeWs } from '../internal/use-realtime-ws'

/** Transport mode for the universal hook. */
export type UseRealtimeTransport = 'auto' | 'sse' | 'websocket'

/** Options for {@link useRealtime}. */
export interface UseRealtimeOptions {
  /**
   * Realtime endpoint URL.
   *
   * - `ws://` / `wss://` prefix   → WebSocket transport is selected automatically.
   * - Any other value              → SSE transport is selected automatically.
   *
   * Use the `transport` field to override the auto-detection.
   */
  url: string
  /**
   * Override automatic transport detection.
   * - `'auto'` (default) — detect from the URL scheme.
   * - `'sse'`            — always use EventSource, regardless of the URL.
   * - `'websocket'`      — always use socket.io-client, regardless of the URL.
   */
  transport?: UseRealtimeTransport
  /** Forward cookies for cross-origin SSE. */
  withCredentials?: boolean
  /** Auth credentials for the WebSocket handshake. */
  auth?: { ticket?: string; token?: string }
  /** socket.io path (WebSocket only). Default `/socket.io`. */
  path?: string
}

/**
 * Returns `'sse'` for `http://`, `https://`, or relative paths;
 * `'websocket'` for `ws://` or `wss://` URLs.
 */
function detectTransport(url: string): 'sse' | 'websocket' {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'websocket'
  return 'sse'
}

/**
 * Universal realtime hook — auto-detects SSE vs WebSocket from the URL scheme.
 *
 * - `http(s)://` or a relative path  → SSE via native `EventSource`
 * - `ws(s)://`                        → WebSocket via socket.io-client (dynamic import)
 *
 * Override with `transport: 'sse' | 'websocket'` when needed.
 *
 * Both internal hooks are always invoked (Rules of Hooks compliance); only the
 * one matching the detected transport is active.
 *
 * @example
 * function MyComponent() {
 *   const { connected, events } = useRealtime<{ 'invoice.paid': { id: string } }>({
 *     url: '/realtime/sse',
 *   })
 *   return <div>{connected ? 'live' : 'disconnected'}</div>
 * }
 */
export function useRealtime<TEvents extends Record<string, unknown> = Record<string, unknown>>(
  opts: UseRealtimeOptions,
) {
  const detected =
    opts.transport !== undefined && opts.transport !== 'auto'
      ? opts.transport
      : detectTransport(opts.url)

  const isWs = detected === 'websocket'

  // Both hooks are always called to satisfy Rules of Hooks. The inactive
  // hook receives enabled: false and returns a stable no-op state.
  const sseResult = useRealtimeSse<TEvents>({
    url: opts.url,
    ...(opts.withCredentials !== undefined ? { withCredentials: opts.withCredentials } : {}),
    enabled: !isWs,
  })
  const wsResult = useRealtimeWs<TEvents>({
    url: opts.url,
    ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    enabled: isWs,
  })

  if (isWs) {
    return { transport: 'websocket' as const, ...wsResult }
  }
  return {
    transport: 'sse' as const,
    ...sseResult,
    // `emit` is WebSocket-exclusive; typed as `never` to prevent accidental use on SSE.
    emit: undefined as never,
  }
}
