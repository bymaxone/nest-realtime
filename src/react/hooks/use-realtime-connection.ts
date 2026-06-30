/**
 * @fileoverview Lightweight connection-state hook — no event accumulation.
 * @layer react/hooks
 *
 * Use when you only need to know whether the connection is live and want to
 * trigger a manual reconnect. For full event streaming use `useRealtime`.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { useRealtime, type UseRealtimeOptions } from './use-realtime'

/**
 * Lite realtime hook — exposes only `connected`, `error`, and `reconnect`.
 *
 * Useful for status indicators, connection guards, or simple error-handling UI
 * where the events array is unnecessary overhead.
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
