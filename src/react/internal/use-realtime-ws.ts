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
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

// CRITICAL: NO static `import … 'socket.io-client'` in this file.
// The dynamic import inside `openSocket` keeps the SSE-only bundle ≤ 4 KiB brotli.
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
   * Open the socket on the `websocket` transport alone, with no polling first. Set it when the server runs with
   * `websocket.websocketOnly` or `websocket.allowedOrigins`, which refuse a polling request; a default client then fails
   * its first request and reports a `connect_error`. Default false.
   */
  websocketOnly?: boolean
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
  removeAllListeners: () => void
  disconnect: () => void
}

const MAX_EVENTS = 100

/** The state setters a bound socket writes to. */
interface SocketSinks<TEvents extends Record<string, unknown>> {
  readonly setConnected: (connected: boolean) => void
  readonly setError: (error: Error | undefined) => void
  readonly setEvents: Dispatch<SetStateAction<Array<WsEventEntry<TEvents>>>>
  readonly setLastEvent: (entry: WsEventEntry<TEvents>) => void
}

/** Whatever was thrown, as an `Error`. */
function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/** Route a socket's connection signals and every event it receives into the hook's state. */
function bindSocket<TEvents extends Record<string, unknown>>(
  socket: SocketLike,
  sinks: SocketSinks<TEvents>,
): void {
  socket.on('connect', () => {
    sinks.setConnected(true)
    sinks.setError(undefined)
  })
  socket.on('disconnect', () => sinks.setConnected(false))
  socket.on('error', (e: unknown) => sinks.setError(asError(e)))
  // Socket.IO reports a failed or refused handshake as `connect_error`, not as `error`.
  socket.on('connect_error', (e: unknown) => sinks.setError(asError(e)))
  socket.onAny((eventName: string, payload: unknown) => {
    const entry: WsEventEntry<TEvents> = {
      type: eventName as keyof TEvents,
      data: payload as TEvents[keyof TEvents],
    }
    sinks.setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS))
    sinks.setLastEvent(entry)
  })
}

/** Load `socket.io-client` and open a socket, sending the credentials that were given. */
async function openSocket(
  url: string,
  path: string | undefined,
  ticket: string | undefined,
  token: string | undefined,
  websocketOnly: boolean,
): Promise<SocketLike> {
  // DYNAMIC IMPORT — the bundler keeps socket.io-client out of the static graph.
  const { io } = await import('socket.io-client')
  const auth: WsAuth = {
    ...(ticket !== undefined ? { ticket } : {}),
    ...(token !== undefined ? { token } : {}),
  }
  return io(url, {
    path: path ?? '/socket.io',
    ...(ticket !== undefined || token !== undefined ? { auth } : {}),
    ...(websocketOnly ? { transports: ['websocket'] } : {}),
    withCredentials: true,
  })
}

/** Close a socket whose attempt was superseded or torn down while its import was in flight. */
function discardSocket(socket: SocketLike): void {
  socket.removeAllListeners()
  socket.disconnect()
}

/**
 * The socket handle of one hook instance, with the calls that hooks make on it.
 *
 * `disposeSocket` and `emit` keep one identity for the life of the component.
 */
function useSocketHandle(): {
  socketRef: MutableRefObject<unknown>
  disposeSocket: () => void
  emit: (event: string, data: unknown) => void
  claimAttempt: () => () => boolean
} {
  // Typed as `unknown` and narrowed via inline casts — avoids a static type import.
  const socketRef = useRef<unknown>(null)
  // Counts the attempts to open a socket and the teardowns. An attempt whose import resolves after a newer attempt or a
  // teardown no longer holds the current number, and the socket it opened is closed instead of kept.
  const attempts = useRef(0)

  // Tear down the current socket (remove listeners + disconnect) and clear the ref.
  // Removing listeners first prevents the abandoned socket's `disconnect` handler from
  // mutating state after a new socket has taken its place.
  // Stryker disable ArrayDeclaration: equivalent — a `useCallback` whose dependency list is constant keeps one identity for the life of the component, whatever the list holds; measured by running the React specs with a one-element list
  const disposeSocket = useCallback(() => {
    attempts.current++
    const sock = socketRef.current as SocketLike | null
    if (sock) {
      sock.removeAllListeners()
      sock.disconnect()
    }
    socketRef.current = null
  }, [])

  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: equivalent — a `useCallback` whose dependency list is constant keeps one identity for the life of the component, whatever the list holds; measured by running the React specs with a one-element list
  const emit = useCallback((event: string, data: unknown): void => {
    const sock = socketRef.current as SocketLike | null
    sock?.emit(event, data)
  }, [])

  // Stryker restore ArrayDeclaration
  // Stryker disable ArrayDeclaration: equivalent — a `useCallback` whose dependency list is constant keeps one identity for the life of the component, whatever the list holds; measured by running the React specs with a one-element list
  const claimAttempt = useCallback((): (() => boolean) => {
    const mine = ++attempts.current
    return () => attempts.current === mine
  }, [])

  // Stryker restore ArrayDeclaration

  return { socketRef, disposeSocket, emit, claimAttempt }
}

/**
 * Run `connect` when it changes and tear the socket down on cleanup; returns the call that connects again on demand.
 *
 * Cleanup disconnects at most once: `disposeSocket` is idempotent and clears the ref, so a later cleanup never
 * double-disconnects a live socket.
 */
function useConnectionLifecycle(
  connect: () => Promise<void>,
  enabled: boolean | undefined,
  disposeSocket: () => void,
): () => void {
  useEffect(() => {
    void connect()
    return () => disposeSocket()
  }, [connect, enabled, disposeSocket])

  return useCallback(() => {
    void connect()
  }, [connect])
}

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
  const { socketRef, disposeSocket, emit, claimAttempt } = useSocketHandle()

  // Depend on the credential VALUES, never on the `auth` object identity. A consumer
  // that writes `auth={{ token }}` inline builds a new object on every render; keying
  // `connect` on that object rebuilt it every render, and the effect below then tore
  // the socket down and reopened it — a reconnect loop that never settles, hammering
  // the server with hundreds of handshakes a second. Primitives make it stable no
  // matter how the caller spells the option.
  const { ticket: authTicket, token: authToken } = opts.auth ?? {}
  const websocketOnly = opts.websocketOnly === true
  const { url, path, enabled } = opts

  const connect = useCallback(async () => {
    if (enabled === false) return
    // Dispose any existing socket BEFORE opening a new one so reconnect() never leaks
    // the previous connection or leaves stale listeners mutating state.
    disposeSocket()
    setConnected(false)
    const wanted = claimAttempt()
    try {
      const socket = await openSocket(url, path, authTicket, authToken, websocketOnly)
      if (!wanted()) return discardSocket(socket)
      socketRef.current = socket
      bindSocket(socket, { setConnected, setError, setEvents, setLastEvent })
    } catch (e) {
      if (wanted()) setError(asError(e))
    }
  }, [
    enabled,
    url,
    authTicket,
    authToken,
    path,
    websocketOnly,
    disposeSocket,
    socketRef,
    claimAttempt,
  ])

  const reconnect = useConnectionLifecycle(connect, enabled, disposeSocket)

  return { connected, events, lastEvent, error, emit, reconnect }
}
