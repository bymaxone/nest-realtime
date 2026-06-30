/**
 * @fileoverview Public barrel for the `@bymax-one/nest-realtime/react` subpath.
 * @layer react
 *
 * Exports only the public hooks, provider, context accessor, and convenience
 * type re-exports from `./shared`. Internal hooks (`useRealtimeSse`,
 * `useRealtimeWs`) are intentionally excluded to discourage direct usage.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'

// Hooks
export { useRealtime } from './hooks/use-realtime'
export type { UseRealtimeOptions } from './hooks/use-realtime'
export { useRealtimeConnection } from './hooks/use-realtime-connection'
export { usePresence } from './hooks/use-presence'
export type { UsePresenceReturn } from './hooks/use-presence'

// Provider
export { RealtimeProvider, useRealtimeContext } from './providers/realtime-provider'

// Shared re-exports — convenience imports for frontend consumers.
export type { RealtimeEvent, TransportMode } from '../shared'
