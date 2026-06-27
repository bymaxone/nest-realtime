# Pattern C — Bearer Header Authentication (WebSocket only)

## When to use

The bearer header pattern is appropriate for **WebSocket connections** where the client
controls the initial HTTP handshake headers.

**Do NOT use this pattern for SSE.**  The browser's `EventSource` API sends only the
headers the browser chooses — it has no API to set custom headers such as
`Authorization`.  A non-browser `EventSource` polyfill (Node.js or a mobile SDK) may
support custom headers, but relying on this breaks web compatibility and creates an
inconsistent security surface.

For SSE use [Pattern A — HttpOnly Cookie](./cookie-httponly.md) or
[Pattern B — Ticket](./ticket.md) instead.

## How to implement (WebSocket)

```typescript
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'
import { verify } from 'jsonwebtoken'

export class BearerAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly secret: string) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    // For WebSocket, the token may come from the handshake auth payload instead:
    //   ctx.headers['x-socket-auth'] or ctx.query['token']
    const raw = ctx.headers['authorization']
    const token = this.extractBearer(raw)
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

  private extractBearer(header: string | undefined): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined
    const token = header.slice(7)
    return token.length > 0 ? token : undefined
  }
}
```

### Socket.IO handshake alternative

Socket.IO allows passing auth data at connection time outside the HTTP headers:

```typescript
// Client side
const socket = io({ auth: { token: '<jwt>' } })

// Server side (inside authenticate)
async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
  // Socket.IO populates ctx.query or a custom handshake auth object.
  const token = ctx.query['token']
  if (!token) return null
  // ...validate token...
}
```

## Security notes

- **This pattern is WebSocket-only.** The SSE handler strips the `Authorization` header
  unconditionally before calling `IConnectionAuthenticator.authenticate` (see
  `ConnectionAuthContext.headers` — the key is absent for SSE). An SSE client that
  somehow sets `Authorization` will receive a 401.
- **Validate algorithm and audience.** When using JWTs, always specify the expected
  algorithm (`algorithms: ['RS256']`) and audience (`audience: 'my-service'`) to prevent
  algorithm-confusion attacks.
- **Short-lived tokens.** Bearer tokens in the WebSocket handshake have a window between
  issue and connect.  Keep access-token TTLs short (≤ 15 min) and implement a refresh
  flow via a separate channel.
- **TLS.** Tokens in HTTP headers are only safe over TLS; do not use bearer auth on
  plain-text WebSocket (`ws://`).
