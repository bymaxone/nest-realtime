# Pattern B — Ticket / One-Time ID Authentication

## When to use

The ticket pattern is suitable for clients that **cannot store cookies** or that operate
across strict cross-origin boundaries where cookies are not forwarded:

- Native mobile or desktop apps.
- Server-to-server SSE subscriptions.
- Developer tooling where setting custom headers on `EventSource` is not possible.
- Scenarios where `SameSite=None` cookie forwarding is undesirable.

## How it works

1. The client authenticates using its normal auth flow (e.g. `Authorization: Bearer <token>`).
2. The consumer's backend endpoint (`POST /events/ticket`) issues a short-lived UUID
   stored atomically in Redis (or an equivalent key–value store).
3. The client opens the SSE connection with `?ticket=<uuid>` in the query string.
4. The authenticator reads the ticket from `ctx.query.ticket`, atomically consumes it
   (`GETDEL`), and returns the associated auth result — or `null` if the ticket is absent,
   expired, or already consumed.

The SSE request itself carries no credentials in headers; the ticket is single-use and
lives only in the query string.

## Reference implementation

```typescript
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'

export class TicketAuthenticator implements IConnectionAuthenticator {
  // In production, replace this Map with a Redis GETDEL (atomic consume).
  private readonly store = new Map<string, { auth: AuthenticationResult; expiresAt: number }>()

  /**
   * Issue a one-time ticket.  Call this from the POST /events/ticket endpoint.
   * The issued ticket should be passed to the client over the already-authenticated
   * channel (e.g. as a JSON response body to an authenticated API request).
   */
  issue(ticketId: string, auth: AuthenticationResult, ttlMs = 60_000): void {
    this.store.set(ticketId, { auth, expiresAt: Date.now() + ttlMs })
    // Clean up after expiry — in production use Redis TTL instead of setTimeout.
    setTimeout(() => this.store.delete(ticketId), ttlMs)
  }

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticketId = ctx.query['ticket']
    if (!ticketId) return null

    const entry = this.store.get(ticketId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(ticketId)
      return null
    }

    // Atomic consume: delete first so a second concurrent call gets null.
    this.store.delete(ticketId)
    return entry.auth
  }
}
```

In Redis the consume step is:

```lua
-- GETDEL is available since Redis 6.2 and is atomic.
local v = redis.call('GETDEL', KEYS[1])
return v
```

## Security notes

- **Short TTL (≤ 60 s).** A ticket that lives too long is effectively a bearer token in a URL,
  which ends up in server logs, browser history, and `Referer` headers.
- **Atomic consume.** Use `GETDEL` (Redis 6.2+) or a `WATCH`/`MULTI`/`EXEC` transaction to
  ensure exactly-once use under concurrent requests.
- **Rate-limit the issuing endpoint** (`POST /events/ticket`) to prevent ticket-farming attacks.
  Apply the same rate limits as your login endpoint.
- **Do not log query strings** that may contain ticket values (configure your reverse proxy
  to strip or redact the `ticket` parameter from access logs).
- **One ticket per connection.** Issue a fresh ticket for every reconnect; never reuse a
  consumed ticket ID.
