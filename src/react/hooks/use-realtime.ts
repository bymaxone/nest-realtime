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
  /**
   * SSE-only: extra named SSE events to subscribe to.
   *
   * `EventSource` never routes a named event to `onmessage`, so an
   * application-level name such as `order.created` is invisible unless it is
   * listed here. Names the hook already handles (`message`, `open`, `error`, and
   * the reserved catalog) are ignored. Ignored entirely on the WebSocket branch,
   * where `onAny` already receives every event name.
   */
  eventNames?: readonly string[]
  /** SSE-only: initial reconnect backoff in ms. Default 1000. */
  reconnectInitialMs?: number
  /** SSE-only: maximum reconnect backoff in ms. Default 30000. */
  reconnectMaxMs?: number
  /**
   * SSE-only: give up and close the stream after this many consecutive failed
   * connection attempts (the initial connection counts, so `1` means "never
   * retry"). Unset retries indefinitely. Ignored on WebSocket, where Socket.IO
   * owns the policy.
   */
  maxAttempts?: number
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
 * The returned shape is identical across transports, but two fields are
 * transport-specific: `emit` works only on WebSocket, and `reconnectAttempts` is
 * always `0` on WebSocket because Socket.IO owns its own retry policy and does not
 * report the count.
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
    ...(opts.eventNames !== undefined ? { eventNames: opts.eventNames } : {}),
    ...(opts.reconnectInitialMs !== undefined
      ? { reconnectInitialMs: opts.reconnectInitialMs }
      : {}),
    ...(opts.reconnectMaxMs !== undefined ? { reconnectMaxMs: opts.reconnectMaxMs } : {}),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    enabled: !isWs,
  })
  const wsResult = useRealtimeWs<TEvents>({
    url: opts.url,
    ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
    ...(opts.path !== undefined ? { path: opts.path } : {}),
    enabled: isWs,
  })

  if (isWs) {
    // Socket.IO owns its own retry policy, so the counter is not meaningful here;
    // it is reported as zero to keep the return shape identical across branches.
    return { transport: 'websocket' as const, reconnectAttempts: 0, ...wsResult }
  }
  return {
    transport: 'sse' as const,
    ...sseResult,
    // `emit` is WebSocket-exclusive; typed as `never` to prevent accidental use on SSE.
    emit: undefined as never,
  }
}
