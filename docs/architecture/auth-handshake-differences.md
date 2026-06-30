# Auth Handshake Differences — SSE vs WebSocket

> Reference: spec §8.1 (three supported patterns) and §8.2 (pattern comparison).

## Pattern matrix

| Pattern | SSE (EventSource, browser) | SSE (server-side fetch) | WebSocket (Socket.IO) |
|---|---|---|---|
| **Cookie HttpOnly** | ✅ Browser sends automatically | ✅ `headers.cookie` in fetch | ✅ Socket.IO upgrade carries cookies |
| **Ticket (query string)** | ✅ Append `?ticket=` to URL | ✅ Append `?ticket=` | ✅ URL query string |
| **Ticket (auth field)** | ❌ EventSource has no auth field | ❌ Not applicable | ✅ `io(url, { auth: { ticket } })` |
| **Bearer header** | ❌ EventSource strips custom headers | ⚠️ Works only in server-side code | ✅ Via `auth.token` or `extraHeaders` |

Legend: ✅ fully supported · ⚠️ restricted context · ❌ not supported

---

## Cookie HttpOnly

**Why it works:** The HTTP upgrade carries all matching cookies. The browser includes
them automatically; server-side fetch passes them via the `Cookie` header.

**Client (browser):**
```typescript
// SSE
const es = new EventSource('/events', { withCredentials: true })

// WebSocket
const socket = io('https://api.example.com')
```

**Authenticator:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const token = ctx.cookies['access_token']
  return token ? verifyJwt(token) : null
}
```

---

## Ticket pattern

**Why it works:** A short-lived opaque token delivered before the connection is opened.
Socket.IO's `auth` field is the idiomatic path on WebSocket; on SSE the query string is
the only option (EventSource has no auth field).

**Client (SSE):**
```typescript
const ticket = await fetch('/auth/ticket').then(r => r.json()).then(r => r.ticket)
const es = new EventSource(`/events?ticket=${ticket}`)
```

**Client (WebSocket — preferred):**
```typescript
const socket = io('https://api.example.com', { auth: { ticket: 'otp_...' } })
```

**Authenticator:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const ticket = ctx.query['ticket']
  return ticket ? redeemTicket(ticket) : null
}
```

---

## Bearer header

**Why it works on WebSocket, not SSE:**
- The browser's `EventSource` API has no way to set custom HTTP headers — the request
  carries only URL + cookies. Bearer via header is therefore impossible for browser SSE.
- Socket.IO's `auth` object is an application-level payload sent after the HTTP upgrade,
  so it bypasses the browser restriction entirely. `RealtimeGateway` normalizes
  `auth.token` into `ctx.headers['authorization'] = 'Bearer <token>'`.

**Client (WebSocket — preferred):**
```typescript
const socket = io('https://api.example.com', { auth: { token: 'eyJ...' } })
```

**Client (WebSocket — extraHeaders, server-side / React Native only):**
```typescript
const socket = io('https://api.example.com', {
  extraHeaders: { authorization: 'Bearer eyJ...' },
})
```

**Authenticator:**
```typescript
async authenticate(ctx: ConnectionAuthContext) {
  const header = ctx.headers['authorization']
  if (!header?.startsWith('Bearer ')) return null
  return verifyJwt(header.slice(7))
}
```

---

## Recommendation per transport

| Transport | Recommended pattern | Fallback |
|---|---|---|
| SSE (browser) | Cookie HttpOnly | Ticket in query string |
| SSE (server-side) | Bearer header | Cookie or Ticket |
| WebSocket (browser) | Cookie HttpOnly or `auth.token` | `auth.ticket` |
| WebSocket (server-side) | `auth.token` | `extraHeaders` bearer |
