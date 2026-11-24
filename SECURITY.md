# Security Policy

## Supported Versions

| Version          | Supported                                     |
| ---------------- | --------------------------------------------- |
| `1.2.x` (latest) | ✅ Receives security fixes                    |
| Older lines      | ❌ Unsupported; upgrade to the latest `1.2.x` |

Only the latest minor line receives security fixes. If you run an older version, upgrade first, then report.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately to **support@bymax.one**. Include:

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
- **Out of scope:** vulnerabilities in _bridge implementations_ (e.g. the `@bymax-one/nest-auth` bridge for NestJS JWT) are the responsibility of those packages, not this library. Report such issues to the corresponding project.

### Threat model: same-process code

Code that runs in the same process as this library is trusted, as it is in Node itself: it can already read your credentials, replace any module and call every API directly. The guards that refuse a replaced built-in, a planted `then` or a returned `Proxy` are best-effort checks that catch an accident, such as a polyfill or a patch applied after the import. They are not a security boundary against hostile code in the process. Limits: a thenable that is neither a native promise nor a `Proxy`, such as a host's own class with a `then`, is awaited as it is, and a test that fakes the global `Date` (fake timers) or spies on `Date.now` is either not seen by the re-authentication clock or refused by the guard.

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
- `WebSocketOptions.cors` — a `CorsConfig` object passed directly to the Socket.IO server. Restrict `origin` to your known frontend origins; avoid `origin: '*'` in production when using `credentials: true`. It sets CORS response headers only: **it does not refuse a WebSocket upgrade**, because a browser does not apply CORS to one (see below).

```typescript
websocket: {
  cors: {
    origin: ['https://app.example.com'],
    credentials: true,
  },
}
```

### WebSocket origin is the host's check

A client that sends `Origin: https://evil.example` and a valid cookie connects over the WebSocket transport even when `websocket.cors.origin` lists only your frontend; the CORS headers decide what a browser lets a page read, and the upgrade is not subject to them. This is cross-site WebSocket hijacking when the session cookie is sent cross-site. The library does not check `Origin`; the host must:

- refuse an unlisted origin in its `IConnectionAuthenticator` (`ctx.headers.origin` on the handshake), returning `null`;
- set the session cookie `SameSite=Lax` or `Strict`;
- prefer a short-lived ticket in the handshake to an ambient cookie;
- serve `transports: ['websocket']` and refuse the long-polling handshake at the proxy if the authenticator is to require an `Origin`: the authenticator reads the headers of the first request only, and a browser sends `Origin` on every WebSocket handshake but not on a same-origin long-polling `GET`.

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

For security issues: **support@bymax.one**
