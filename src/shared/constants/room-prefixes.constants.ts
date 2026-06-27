/**
 * @fileoverview Canonical room id prefixes for scoping emits and auto-join.
 * @layer shared
 */

/**
 * Canonical room id prefixes — used to scope emits and auto-join connections.
 *
 * Convention:
 * - `user:{userId}`                — a single user's connections
 * - `tenant:{tenantId}`            — every connection within a tenant
 * - `resource:{resourceType}:{id}` — a per-resource room (e.g. invoice, session)
 *
 * Anything else is application-defined and free-form. Changing a prefix value is
 * a breaking change for every connected client and stored room id.
 */
export const ROOM_PREFIXES = {
  USER: 'user',
  TENANT: 'tenant',
  RESOURCE: 'resource',
} as const

/** Union of canonical room prefix values (`'user' | 'tenant' | 'resource'`). */
export type RoomPrefix = (typeof ROOM_PREFIXES)[keyof typeof ROOM_PREFIXES]
