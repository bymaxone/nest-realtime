/**
 * @fileoverview Optional presence-tracking contract ("who is online?").
 * @layer contracts
 */

/**
 * Optional presence tracking — answers "who is online?" across instances. When it
 * is not provided, presence-dependent features (e.g. the `usePresence` hook) are
 * disabled.
 */
export interface IPresenceStorage {
  setOnline(userId: string, connectionId: string, tenantId?: string): Promise<void>
  setOffline(userId: string, connectionId: string): Promise<void>
  isOnline(userId: string): Promise<boolean>
  listOnlineByTenant(tenantId: string): Promise<string[]>
  countOnline(): Promise<number>
}
