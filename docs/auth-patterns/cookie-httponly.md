# Pattern A — HttpOnly Cookie Authentication

## When to use

The HttpOnly cookie pattern is the recommended approach for **browser-based SSE clients**.

`EventSource` (the browser's native SSE API) does not allow custom headers such as
`Authorization` — the browser controls what headers are sent and strips any header the
consumer tries to inject.  Cookies, however, are sent automatically by the browser on
every same-origin (and cross-origin when `credentials: 'include'` is configured) request.
Storing the access token in an `HttpOnly` cookie keeps it invisible to JavaScript, which
is the primary defence against XSS token theft.

## How to implement

```typescript
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'
import { verify } from 'jsonwebtoken'

export class CookieJwtAuthenticator implements IConnectionAuthenticator {
  constructor(
    private readonly secret: string,
    private readonly cookieName = 'access_token',
  ) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const token = ctx.cookies[this.cookieName]
    if (!token) return null
    try {
      const payload = verify(token, this.secret) as {
        sub: string
        tid?: string
        roles?: string[]
      }
      return { userId: payload.sub, tenantId: payload.tid, roles: payload.roles }
    } catch {
      return null
    }
  }
}
```

Register it through the module options:

```typescript
BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new CookieJwtAuthenticator(process.env.JWT_SECRET!),
})
```

For a full bridge to `@bymax-one/nest-auth`'s `JwtService` (including `revalidate` and
revocation support) see [`docs/examples/nest-auth-bridge.md`](../examples/nest-auth-bridge.md).

## Security notes

| Cookie attribute | Recommendation |
|---|---|
| `HttpOnly` | **Required.** Prevents JavaScript from reading the token. |
| `Secure` | **Required in production.** Ensures the cookie is only sent over HTTPS. |
| `SameSite` | `Lax` (default in modern browsers) or `Strict`. `None` requires `Secure` and is only needed for third-party embedding — prefer `Lax`. |
| `Path` | Scope to the SSE endpoint (e.g. `/events`) to limit exposure to other routes. |
| `Max-Age` / `Expires` | Match your JWT expiry to avoid long-lived orphan cookies. |

**Do not** set `SameSite=None` without `Secure`; that combination is rejected by modern
browsers and leaks the token over plain HTTP.

**Refresh tokens** should live in a separate `HttpOnly` cookie on the token-refresh
endpoint only, not on the SSE path.  The realtime library never touches refresh tokens.
