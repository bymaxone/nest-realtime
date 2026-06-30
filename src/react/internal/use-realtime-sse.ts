/**
 * @fileoverview SSE branch of the universal realtime hook.
 * @layer react/internal
 *
 * Opens a browser-native `EventSource`, tracks connection state, and accumulates
 * received events. Implements exponential backoff on error to avoid thundering-herd
 * reconnect storms. The native EventSource auto-sends `Last-Event-ID` from its
 * internal state — this hook does not duplicate that logic.
 *
 * Note: `'use client'` at the top is required for React Server Components
 * compatibility — this module accesses `EventSource` and React state.
 */
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
/** Options for the SSE internal hook. */
export interface UseRealtimeSseOptions {
  /** SSE endpoint URL, e.g. `'/realtime/sse'`. */
  url: string
  /** Forward cookies when the endpoint is on a different origin. Default false. */
  withCredentials?: boolean
  /** Initial backoff delay in ms. Default 1000. */
  reconnectInitialMs?: number
  /** Maximum backoff delay in ms. Default 30000. */
  reconnectMaxMs?: number
  /**
   * When false the hook does nothing — useful for conditional transport selection
   * without violating Rules of Hooks. Default true.
   */
  enabled?: boolean
}

/** Maximum number of events kept in memory per hook instance. */
const MAX_EVENTS = 100

/** Accumulated event shape returned by the hook. */
export type SseEventEntry<TEvents extends Record<string, unknown>> = {
  type: keyof TEvents
  data: TEvents[keyof TEvents]
  id: string
}

/** Return value of {@link useRealtimeSse}. */
export interface UseRealtimeSseReturn<TEvents extends Record<string, unknown>> {
  /** Whether the connection is open. */
  connected: boolean
  /** Accumulated events, capped at the last 100 entries. */
  events: Array<SseEventEntry<TEvents>>
  /** The most recent event, or `undefined` if none has arrived yet. */
  lastEvent: SseEventEntry<TEvents> | undefined
  /** Last connection error, or `undefined` when the connection is healthy. */
  error: Error | undefined
  /**
   * Force a new `EventSource` immediately, resetting the backoff counter.
   *
   * @example
   * const { reconnect } = useRealtimeSse({ url: '/realtime/sse' })
   * // call on a user "reconnect" button
   * <button onClick={reconnect}>Reconnect</button>
   */
  reconnect: () => void
}

/**
 * Internal SSE hook — wraps `EventSource` with connection-state tracking,
 * event accumulation (last 100), and exponential backoff.
 *
 * This is the SSE branch of the universal hook and is NOT exported from the
 * public barrel. Consumers should use `useRealtime` or `useRealtimeConnection`.
 *
 * @example
 * const { connected, events, error } = useRealtimeSse<{ 'invoice.paid': { id: string } }>({
 *   url: '/realtime/sse',
 *   withCredentials: true,
 * })
 */
export function useRealtimeSse<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeSseOptions,
): UseRealtimeSseReturn<TEvents> {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<Array<SseEventEntry<TEvents>>>([])
  const [lastEvent, setLastEvent] = useState<SseEventEntry<TEvents> | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectMsRef = useRef<number>(opts.reconnectInitialMs ?? 1_000)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (opts.enabled === false) return

    // Close any existing source before opening a fresh one.
    sourceRef.current?.close()
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // EventSource automatically sends `Last-Event-ID` based on the last event id
    // it has seen — no manual tracking needed on this end.
    const source = new EventSource(opts.url, { withCredentials: opts.withCredentials ?? false })
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      setError(undefined)
      // Reset backoff on successful open.
      reconnectMsRef.current = opts.reconnectInitialMs ?? 1_000
    }

    source.onerror = () => {
      setConnected(false)
      setError(new Error('SSE connection error'))
      // Exponential backoff: double each failure, capped at reconnectMaxMs.
      const delay = Math.min(reconnectMsRef.current * 2, opts.reconnectMaxMs ?? 30_000)
      reconnectMsRef.current = delay
      timerRef.current = setTimeout(connect, delay)
    }

    // Default `message` event. The `: keepalive` SSE heartbeat is a raw comment and
    // never surfaces to `onmessage` (per spec §6.1 and §13). No special-casing needed.
    source.onmessage = (e: MessageEvent) => {
      const entry: SseEventEntry<TEvents> = {
        type: 'message' as keyof TEvents,
        data: JSON.parse(e.data as string) as TEvents[keyof TEvents],
        id: e.lastEventId,
      }
      setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS))
      setLastEvent(entry)
    }
  }, [opts.enabled, opts.url, opts.withCredentials, opts.reconnectInitialMs, opts.reconnectMaxMs])

  useEffect(() => {
    if (opts.enabled === false) return
    connect()
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [connect, opts.enabled])

  const reconnect = useCallback(() => {
    reconnectMsRef.current = opts.reconnectInitialMs ?? 1_000
    connect()
  }, [connect, opts.reconnectInitialMs])

  return { connected, events, lastEvent, error, reconnect }
}
