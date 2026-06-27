/**
 * @fileoverview Test fixture — ticket-based (one-time ID) authenticator (Pattern B).
 * @layer test-fixture
 *
 * Reference: `docs/auth-patterns/ticket.md`
 *
 * An in-memory `Map` with a TTL stands in for Redis.  Tickets are consumed atomically
 * (delete-before-return) so a second concurrent call for the same ticket always gets
 * `null`.  Used in unit tests and integration specs that exercise the ticket flow.
 *
 * This file lives in `test/` and is never part of the published package.
 */
import type {
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionAuthenticator,
} from '../../../src/server/interfaces/connection-authenticator.interface'

interface TicketEntry {
  auth: AuthenticationResult
  expiresAt: number
  timer: NodeJS.Timeout
}

/**
 * Ticket-based authenticator fixture.
 *
 * Issue tickets via `issue(ticketId, auth, ttlMs)` before the SSE connect attempt.
 * Tickets are single-use: `authenticate` deletes the entry before returning the result
 * so a concurrent second call always receives `null`.
 *
 * @see {@link https://github.com/bymaxone/nest-realtime/blob/main/docs/auth-patterns/ticket.md}
 */
export class TicketAuthenticator implements IConnectionAuthenticator {
  private readonly store = new Map<string, TicketEntry>()

  /**
   * Issue a one-time ticket.  In production this would be a Redis `SET … EX … NX`
   * followed by a `GETDEL` on consume.
   *
   * @param ticketId - Unique ticket identifier (e.g. `crypto.randomUUID()`).
   * @param auth - The auth result that will be returned when the ticket is consumed.
   * @param ttlMs - Ticket lifetime in milliseconds (default 60 000).
   */
  issue(ticketId: string, auth: AuthenticationResult, ttlMs = 60_000): void {
    // Cancel any existing timer for this ticket id to avoid double-deletion.
    this.store.get(ticketId)?.timer && clearTimeout(this.store.get(ticketId)!.timer)
    const timer = setTimeout(() => this.store.delete(ticketId), ttlMs)
    this.store.set(ticketId, { auth, expiresAt: Date.now() + ttlMs, timer })
  }

  /**
   * Authenticate by consuming the ticket atomically.
   *
   * @returns The associated auth result, or `null` when the ticket is absent, expired,
   *   or already consumed.
   */
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticketId = ctx.query['ticket']
    if (!ticketId) return null

    const entry = this.store.get(ticketId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      clearTimeout(entry.timer)
      this.store.delete(ticketId)
      return null
    }

    // Atomic consume: delete the entry BEFORE returning so a concurrent second call
    // always finds the key absent.
    clearTimeout(entry.timer)
    this.store.delete(ticketId)
    return entry.auth
  }

  /** Clear all pending tickets and their timers (use in afterEach to avoid leaks). */
  clear(): void {
    for (const entry of this.store.values()) clearTimeout(entry.timer)
    this.store.clear()
  }
}
