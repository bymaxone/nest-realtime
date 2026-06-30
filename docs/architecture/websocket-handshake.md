# WebSocket Handshake Auth

> Reference: spec §8.1 (three supported patterns) and §8.2 (pattern comparison).

Socket.IO exposes a dedicated `auth` field on every handshake — `socket.handshake.auth` —
that the client sets via `io(url, { auth: { token, ticket } })`. The library's
`RealtimeGateway` merges these into `ConnectionAuthContext` so the consumer-provided
`IConnectionAuthenticator` always receives a single, unified context regardless of how
the client delivered its credential.

---

## Pattern 1 — HttpOnly Cookie

**How it works.** The browser automatically includes any matching cookie in the
Socket.IO HTTP upgrade request. The gateway extracts it via `parseCookieHeader` from
`socket.handshake.headers.cookie`.

**Client side:**
```typescript
// No extra config — the browser sends the cookie automatically.
const socket = io('https://api.example.com')
```

**Authenticator side:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const token = ctx.cookies['access_token']
  if (!token) return null
  return verifyJwt(token)
}
```

**Notes:** Works same-origin and CORS (when `credentials: true`). The most secure
option because the cookie is inaccessible to JavaScript (`HttpOnly`).

---

## Pattern 2 — Ticket (query string or `auth.ticket`)

**How it works.** A short-lived opaque token is exchanged before connecting. The client
passes it as `?ticket=<value>` in the URL or — preferred for Socket.IO clients — via
`io(url, { auth: { ticket } })`. The gateway surfaces `auth.ticket` into `ctx.query.ticket`.

**Client side (Socket.IO-idiomatic):**
```typescript
const socket = io('https://api.example.com', { auth: { ticket: 'otp_...' } })
```

**Client side (query string):**
```typescript
const socket = io('https://api.example.com?ticket=otp_...')
```

**Authenticator side:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const ticket = ctx.query['ticket']
  if (!ticket) return null
  return redeemTicket(ticket)  // validates + deletes the one-time token
}
```

**Notes:** Best cross-origin choice when cookies are blocked. Tickets must be
short-lived (seconds) and single-use to prevent replay.

---

## Pattern 3 — Bearer header (`auth.token`)

**How it works.** The client sends a Bearer token. The Socket.IO-idiomatic path is
`io(url, { auth: { token } })` — the gateway normalizes it into
`ctx.headers['authorization'] = 'Bearer <token>'`. Alternatively the client can set
`extraHeaders: { authorization: 'Bearer <token>' }` (HTTP upgrade only; not applicable
in browser WebSocket because `EventSource` and `WebSocket` both strip custom headers).

**Why Bearer works on WebSocket but NOT SSE:** The browser's `EventSource` API does not
expose a way to set custom HTTP headers; the upgrade request carries only cookies. The
Socket.IO `auth` field is a Socket.IO application-level payload sent after the upgrade,
so the library can read it regardless of browser restrictions.

**Client side (preferred):**
```typescript
const socket = io('https://api.example.com', { auth: { token: 'eyJ...' } })
```

**Client side (extraHeaders — server-side / React Native only):**
```typescript
const socket = io('https://api.example.com', {
  extraHeaders: { authorization: 'Bearer eyJ...' },
})
```

**Authenticator side:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const header = ctx.headers['authorization']
  if (!header?.startsWith('Bearer ')) return null
  return verifyJwt(header.slice(7))
}
```

---

## Summary

| Pattern | SSE (EventSource) | WebSocket (Socket.IO) | Notes |
|---|---|---|---|
| Cookie HttpOnly | ✅ Default | ✅ Works | Most secure |
| Ticket | ✅ Best for cross-origin | ✅ Via `auth.ticket` or query | Short-lived, single-use |
| Bearer header | ❌ EventSource strips headers | ✅ Via `auth.token` | WS-only |
