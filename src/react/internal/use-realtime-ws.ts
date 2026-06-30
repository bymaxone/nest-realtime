/**
 * @fileoverview WebSocket branch of the universal realtime hook.
 * @layer react/internal
 *
 * Loads `socket.io-client` via a dynamic `import()` so it NEVER enters the
 * SSE-only static bundle graph. Consumers that only use SSE pay zero bytes for
 * socket.io-client; the dynamic import resolves lazily on the client only.
 *
 * The socket handle is typed as `unknown` and narrowed via inline casts to avoid
 * a static type import of socket.io-client (which would pull it into the bundle).
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// CRITICAL: NO static `import … 'socket.io-client'` in this file.
// The dynamic import inside `connect` keeps the SSE-only bundle ≤ 4 KiB brotli.
// The bundle-integrity check validates this empirically via scripts/check-size.mjs.

/** Authentication credentials forwarded to socket.io-client. */
export interface WsAuth {
  /** Short-lived ticket from a `/realtime/ticket` endpoint. */
  ticket?: string
  /** Bearer token (WebSocket-only — browsers strip Authorization from EventSource). */
  token?: string
}

/** Options for the WebSocket internal hook. */
export interface UseRealtimeWsOptions {
  /** Socket.IO server URL, e.g. `'wss://api.example.com'` or `'/'` for same-origin. */
  url: string
  /** Auth credentials forwarded to the socket.io-client handshake. */
  auth?: WsAuth
  /** socket.io path. Default `/socket.io`. */
  path?: string
  /**
   * When false the hook does nothing — useful for conditional transport selection
   * without violating Rules of Hooks. Default true.
   */
  enabled?: boolean
}

/** Accumulated event shape returned by the hook. */
export type WsEventEntry<TEvents extends Record<string, unknown>> = {
  type: keyof TEvents
  data: TEvents[keyof TEvents]
}

/** Return value of {@link useRealtimeWs}. */
export interface UseRealtimeWsReturn<TEvents extends Record<string, unknown>> {
  /** Whether the socket is connected. */
  connected: boolean
  /** Accumulated events, capped at the last 100. */
  events: Array<WsEventEntry<TEvents>>
  /** The most recent event, or `undefined` if none has arrived. */
  lastEvent: WsEventEntry<TEvents> | undefined
  /** Last connection error. */
  error: Error | undefined
  /**
   * Full-duplex emit — WebSocket-exclusive. Absent on the SSE branch.
   *
   * @param event - Socket.IO event name.
   * @param data  - Payload forwarded to the server.
   */
  emit: (event: string, data: unknown) => void
  /**
   * Trigger a manual reconnect.
   *
   * @example
   * const { reconnect } = useRealtimeWs({ url: 'wss://api.example.com' })
   * <button onClick={reconnect}>Reconnect</button>
   */
  reconnect: () => void
}

/** Narrowing type for the socket handle returned by socket.io-client. */
type SocketLike = {
  on: (event: string, handler: (...args: unknown[]) => void) => void
  onAny: (handler: (eventName: string, payload: unknown) => void) => void
  emit: (event: string, data: unknown) => void
  disconnect: () => void
}

const MAX_EVENTS = 100

/**
 * Internal WebSocket hook — loads socket.io-client via dynamic import and
 * exposes connection state, accumulated events, and a full-duplex `emit`.
 *
 * This is the WebSocket branch of the universal hook and is NOT exported from
 * the public barrel. Consumers should use `useRealtime` or `useRealtimeConnection`.
 *
 * @example
 * const { connected, emit } = useRealtimeWs<{ chat: { text: string } }>({
 *   url: 'wss://api.example.com',
 *   auth: { ticket: myTicket },
 * })
 */
export function useRealtimeWs<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeWsOptions,
): UseRealtimeWsReturn<TEvents> {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<Array<WsEventEntry<TEvents>>>([])
  const [lastEvent, setLastEvent] = useState<WsEventEntry<TEvents> | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  // Typed as `unknown` and narrowed via inline casts — avoids a static type import.
  const socketRef = useRef<unknown>(null)

  const connect = useCallback(async () => {
    if (opts.enabled === false) return
    try {
      // DYNAMIC IMPORT — the bundler keeps socket.io-client out of the static graph.
      const { io } = await import('socket.io-client')
      const socket = io(opts.url, {
        path: opts.path ?? '/socket.io',
        ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
        withCredentials: true,
      })
      socketRef.current = socket

      socket.on('connect', () => {
        setConnected(true)
        setError(undefined)
      })
      socket.on('disconnect', () => setConnected(false))
      socket.on('error', (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      socket.onAny((eventName: string, payload: unknown) => {
        const entry: WsEventEntry<TEvents> = {
          type: eventName as keyof TEvents,
          data: payload as TEvents[keyof TEvents],
        }
        setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS))
        setLastEvent(entry)
      })
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [opts.enabled, opts.url, opts.auth, opts.path])

  useEffect(() => {
    if (opts.enabled === false) return
    void connect()
    return () => {
      const sock = socketRef.current as SocketLike | null
      sock?.disconnect()
      socketRef.current = null
    }
  }, [connect, opts.enabled])

  const emit = useCallback((event: string, data: unknown): void => {
    const sock = socketRef.current as SocketLike | null
    sock?.emit(event, data)
  }, [])

  const reconnect = useCallback(() => {
    void connect()
  }, [connect])

  return { connected, events, lastEvent, error, emit, reconnect }
}
