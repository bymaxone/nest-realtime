/**
 * @fileoverview Helper that builds canonical room ids from the prefix convention.
 * @layer utils
 */
import { ROOM_PREFIXES } from '../constants/room-prefixes.constants'

/**
 * Build a canonical room id following the library's prefix convention.
 *
 * Validation of the parts (e.g. non-empty ids) is the caller's responsibility —
 * this helper only joins the prefix and parts with `:` and escapes nothing, so a
 * part must not contain `:`. `('a:b', 'c')` and `('a', 'b:c')` both give
 * `resource:a:b:c`; encode parts that come from outside with `encodeURIComponent`.
 *
 * A `RESOURCE` room carries no tenant. Put the tenant in the id when ids are only
 * unique within one.
 *
 * @example
 * ```ts
 * composeRoomId('USER', 'u_abc') // → 'user:u_abc'
 * composeRoomId('TENANT', 't_acme') // → 'tenant:t_acme'
 * composeRoomId('RESOURCE', 'invoice', 'inv_123') // → 'resource:invoice:inv_123'
 * ```
 */
export function composeRoomId(prefix: keyof typeof ROOM_PREFIXES, ...parts: string[]): string {
  return [ROOM_PREFIXES[prefix], ...parts].join(':')
}
