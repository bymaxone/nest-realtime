/**
 * @fileoverview React context provider for sharing one realtime connection.
 * @layer react/providers
 *
 * `RealtimeProvider` opens a single underlying `EventSource` or socket and
 * makes it available to all descendant hooks via `useRealtimeContext`. Multiple
 * consumers (e.g. `usePresence` + `useRealtime` in sibling components) share
 * the same connection instead of opening one each.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { createContext, useContext, type PropsWithChildren } from 'react'
import { useRealtime, type UseRealtimeOptions } from '../hooks/use-realtime'

/** Context shape: the full return value of `useRealtime`. */
type RealtimeContextValue = ReturnType<typeof useRealtime>

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

/**
 * Provides a shared realtime connection to all descendant consumers.
 *
 * Mount once near the root of your component tree (or inside a layout that
 * requires realtime) and consume the shared state with `useRealtimeContext`.
 *
 * @example
 * <RealtimeProvider options={{ url: '/realtime/sse', withCredentials: true }}>
 *   <App />
 * </RealtimeProvider>
 */
export function RealtimeProvider({
  options,
  children,
}: PropsWithChildren<{ options: UseRealtimeOptions }>) {
  const value = useRealtime(options)
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

/**
 * Returns the realtime state from the nearest `<RealtimeProvider>`.
 *
 * @throws {Error} When called outside a `<RealtimeProvider>`.
 *
 * @example
 * function EventList() {
 *   const { connected, events } = useRealtimeContext()
 *   return <ul>{events.map(e => <li key={e.id}>{JSON.stringify(e.data)}</li>)}</ul>
 * }
 */
export function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtimeContext must be used within <RealtimeProvider>')
  return ctx
}
