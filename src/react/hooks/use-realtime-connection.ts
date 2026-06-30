/**
 * @fileoverview Connection-state-only view over the universal realtime hook.
 * @layer react/hooks
 *
 * Use when a component only needs to know whether the connection is live and to
 * trigger a manual reconnect. For full event streaming use `useRealtime`.
 *
 * This is a thin projection over `useRealtime`: it opens the same underlying
 * connection and that connection still receives and accumulates events
 * internally. The hook simply does not expose the `events` array (or `lastEvent`
 * / `emit`) in its return value — so consumers get a narrow, stable surface, not
 * a separate lighter-weight subscription.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { useRealtime, type UseRealtimeOptions } from './use-realtime'

/**
 * Connection-state view — returns only `connected`, `error`, and `reconnect`.
 *
 * Useful for status indicators, connection guards, or simple error-handling UI.
 * The shared underlying `useRealtime` connection still processes events; this
 * hook intentionally omits the `events` array from what it returns to keep the
 * surface small and focused on connection status.
 *
 * @example
 * function ConnectionStatus() {
 *   const { connected } = useRealtimeConnection({ url: '/realtime/sse' })
 *   return <span>{connected ? '🟢 live' : '🔴 disconnected'}</span>
 * }
 */
export function useRealtimeConnection(opts: UseRealtimeOptions) {
  const { connected, error, reconnect } = useRealtime<Record<string, never>>(opts)
  return { connected, error, reconnect }
}
