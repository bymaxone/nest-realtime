/**
 * @fileoverview Optional presence-tracking hook.
 * @layer react/hooks
 *
 * Listens to backend-emitted `presence:online` / `presence:offline` application
 * events flowing through the shared `<RealtimeProvider>` connection and maintains
 * a local set of online user IDs.
 *
 * Preconditions:
 *   1. The backend must be configured with an `IPresenceStorage` implementation
 *      so it emits `presence:online` / `presence:offline` events (see spec §5.6).
 *   2. This hook must be mounted inside a `<RealtimeProvider>`.
 *
 * Note: `'use client'` is required for React Server Components compatibility.
 */
'use client'
import { useEffect, useState } from 'react'
import { useRealtimeContext } from '../providers/realtime-provider'

/** Return value of {@link usePresence}. */
export interface UsePresenceReturn {
  /** Sorted array of user IDs currently online. */
  onlineUserIds: string[]
  /**
   * Returns `true` when the given user is currently online.
   *
   * @param userId - The user ID to check.
   */
  isOnline: (userId: string) => boolean
  /** Total count of users online. */
  count: number
}

/**
 * Tracks online / offline users based on presence events from the realtime backend.
 *
 * Must be used inside a `<RealtimeProvider>`. The hook is a pure subscriber —
 * it does not open its own connection.
 *
 * @example
 * function OnlineBadge() {
 *   const { count, isOnline } = usePresence()
 *   return <span>{count} online</span>
 * }
 */
export function usePresence(): UsePresenceReturn {
  // Intentionally throws when called outside the provider (delegates to useRealtimeContext).
  const { events } = useRealtimeContext()
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    const lastEv = events[events.length - 1]
    if (!lastEv) return

    if (lastEv.type === 'presence:online') {
      const payload = lastEv.data as { userId: string }
      setOnline((prev) => new Set(prev).add(payload.userId))
    } else if (lastEv.type === 'presence:offline') {
      const payload = lastEv.data as { userId: string }
      setOnline((prev) => {
        const next = new Set(prev)
        next.delete(payload.userId)
        return next
      })
    }
  }, [events])

  return {
    onlineUserIds: Array.from(online),
    isOnline: (userId: string) => online.has(userId),
    count: online.size,
  }
}
