# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `0.1.x` | ✅ |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately to **security@bymax.one**. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigation

You will receive a response within 72 hours. If the issue is confirmed, we will coordinate a fix and a responsible disclosure timeline with you.

---

## Security Model

### Auth-Inversion Responsibility

This library implements **auth inversion**: it never verifies JWTs, hashes passwords, or imports any authentication library. The `src/` directory contains zero references to `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport-*`, or any concrete auth module.

All authentication flows through the consumer-provided `IConnectionAuthenticator` interface:

```typescript
interface IConnectionAuthenticator {
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null>
  revalidate?(connectionId: string, originalAuth: AuthenticationResult): Promise<boolean>
}
```

**Responsibility boundary:**

- **This library's responsibility:** call `authenticate()` on every new connection; reject (HTTP 401 / WebSocket disconnect) when it returns `null`; call `revalidate()` periodically according to `reauthenticationPolicy`; close connections that fail revalidation.
- **Consumer's responsibility:** implement `IConnectionAuthenticator` securely; validate credentials correctly; return `null` for invalid/expired credentials.
- **Out of scope:** vulnerabilities in *bridge implementations* (e.g. the `@bymax-one/nest-auth` bridge for NestJS JWT) are the responsibility of those packages, not this library. Report such issues to the corresponding project.

### EventSource Auth Pattern

The browser `EventSource` API cannot send custom request headers. **Do not** attempt to pass a bearer token via `Authorization` on an SSE connection — browsers will ignore it. Use one of:

- **Cookie HttpOnly** — the browser sends cookies automatically on `EventSource` requests; the server validates the cookie in `authenticate(ctx.cookies)`.
- **Ticket pattern** — issue a short-lived, single-use token server-side; the client appends it as `?ticket=<token>` to the SSE URL; the authenticator consumes it via `ctx.query.ticket`.

WebSocket connections (via Socket.IO handshake) support bearer tokens in `ctx.headers.authorization`, but the cookie pattern is generally preferred.

### `connection:established` Client-Safe Subset

When a connection is admitted, the library emits a `connection:established` event to the client with a public-safe metadata subset:

```typescript
{
  connectionId: string
  traits: {
    userId: string
    tenantId: string | undefined
    roles: string[]
  }
}
```

No internal connection state, authentication claims, or secrets are included. The consumer controls whether this event is sent via `sse.emitConnectionEvent` / `websocket.emitConnectionEvent`.

### Multi-Tenant Anti-IDOR

The library routes emits to rooms using server-provided room IDs. **The consumer is responsible for not emitting cross-tenant.**

The room registry enforces that a `disconnect()` can only target connections stored in that instance's registry. However, `emitToTenant(tenantId, event)` delivers to whoever is in the `tenant:{tenantId}` room — the consumer must ensure that `tenantId` originates from the authenticated principal and not from untrusted input (e.g. a request body).

### CORS Configuration

**The consumer owns CORS.** The library exposes:

- `SseOptions` — no `cors` field; the SSE endpoint is a standard HTTP `GET` and cross-origin access is controlled at the NestJS application level via `app.enableCors()`.
- `WebSocketOptions.cors` — a `CorsConfig` object passed directly to the Socket.IO server. Restrict `origin` to your known frontend origins; avoid `origin: '*'` in production when using `credentials: true`.

```typescript
websocket: {
  cors: {
    origin: ['https://app.example.com'],
    credentials: true,
  },
}
```

### Secrets via Environment Variables

Never hard-code Redis URLs, API keys, or other secrets in module configuration. Use environment variables and pass them to `forRootAsync` via `useFactory`:

```typescript
BymaxRealtimeModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    transport: 'sse',
    authenticator: new MyAuthenticator(config.get('JWT_SECRET')),
    pubsub: new RedisRealtimePubSub({ client: new Redis(config.get('REDIS_URL')) }),
  }),
  inject: [ConfigService],
})
```

### Supply-Chain Security

Published packages include an npm provenance attestation (SLSA level 2). Verify with:

```bash
npm audit signatures @bymax-one/nest-realtime
```

---

## Contact

For non-security bugs and feature requests, use [GitHub Issues](https://github.com/bymaxone/nest-realtime/issues).

For security issues: **security@bymax.one**
