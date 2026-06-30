<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-realtime"><img src="https://img.shields.io/npm/v/%40bymax-one%2Fnest-realtime?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-realtime"><img src="https://img.shields.io/npm/dm/%40bymax-one%2Fnest-realtime?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/bymaxone/nest-realtime/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-realtime/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://codecov.io/gh/bymaxone/nest-realtime"><img src="https://img.shields.io/codecov/c/github/bymaxone/nest-realtime?style=flat-square" alt="Coverage"></a>
  <a href="https://github.com/bymaxone/nest-realtime/actions/workflows/scorecard.yml"><img src="https://img.shields.io/ossf-scorecard/github.com/bymaxone/nest-realtime?style=flat-square&label=OpenSSF%20Scorecard" alt="OpenSSF Scorecard"></a>
  <a href="https://github.com/bymaxone/nest-realtime/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40bymax-one%2Fnest-realtime?style=flat-square" alt="MIT License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square" alt="TypeScript"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-green?style=flat-square" alt="Node 24+"></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-realtime"><img src="https://img.shields.io/badge/provenance-verified-blue?style=flat-square" alt="Provenance"></a>
</p>

<h1 align="center">@bymax-one/nest-realtime</h1>

<p align="center">
  Dual-transport realtime (SSE default, WebSocket opt-in) with a unified server-side API for NestJS 11.
</p>

---

## ✨ Overview

`@bymax-one/nest-realtime` provides NestJS applications with a production-ready, transport-agnostic realtime channel. The default transport is **Server-Sent Events (SSE)** — browser-native, HTTP-based, and zero extra client dependencies. WebSocket (via Socket.IO) is opt-in with a single config flag.

Key characteristics:

- A single `RealtimeService` API regardless of which transport is active — `emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, `disconnect`.
- Multi-tenant first-class: `user:{id}`, `tenant:{id}`, and `resource:{type}:{id}` room conventions with automatic join/leave.
- Auth is **inverted**: the library never verifies JWTs or imports an auth library — the consumer plugs an `IConnectionAuthenticator`.
- Zero direct npm dependencies; everything is a peer dependency.
- A tree-shakeable `./react` subpath with `useRealtime`, `RealtimeProvider`, and `usePresence`. `socket.io-client` is loaded via `await import()` — SSE-only builds stay under 4 KiB brotli.

---

## 🔥 Features

- **SSE default** — browser-native reconnect, `Last-Event-ID` replay, `: keepalive` comment heartbeat tuned for real-world proxies
- **WebSocket opt-in** — Socket.IO under the hood; enable with `transport: 'websocket'` or `'both'`
- **Composite mode `'both'`** — emit once, deliver to clients on either transport simultaneously
- **Auth inversion** — bring your own `IConnectionAuthenticator`; compatible with cookie HttpOnly, ticket, and bearer patterns
- **Multi-tenant rooms** — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}` conventions; auto-joined on connect
- **Horizontal scaling** — `IRealtimePubSub` for SSE fan-out; `@socket.io/redis-adapter` for WebSocket scaling
- **Offline queue** — `IOfflineQueueStorage` holds events for disconnected users; delivered on reconnect
- **Presence** — optional `IPresenceStorage` for online-user tracking
- **Lifecycle hooks** — fire-and-forget `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed`
- **Re-authentication** — periodic credential revalidation with a positive cache
- **Tree-shakeable React subpath** — `socket.io-client` dynamic-imported; SSE-only bundle ≤ 4 KiB brotli

---

## 📦 Subpath Exports

| Subpath | Purpose | Required peer deps | Optional peer deps |
|---|---|---|---|
| `.` (server) | NestJS module + transports + services | `@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata` | `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@socket.io/redis-adapter`, `ioredis` |
| `./shared` | Types + constants (no Node/NestJS deps) | _(none)_ | — |
| `./react` | Hooks + `RealtimeProvider` | `react ^19` | `socket.io-client ^4` |

Install only what your usage requires:

```bash
# SSE-only server
pnpm add @bymax-one/nest-realtime @nestjs/common @nestjs/core rxjs reflect-metadata

# With WebSocket
pnpm add @bymax-one/nest-realtime @nestjs/common @nestjs/core rxjs reflect-metadata \
         @nestjs/websockets @nestjs/platform-socket.io socket.io

# With Redis scaling
pnpm add @bymax-one/nest-realtime ... ioredis @socket.io/redis-adapter

# Frontend
pnpm add @bymax-one/nest-realtime/react react react-dom
```

---

## 🚀 Quick Start

### Scenario 1 — SSE single-instance (simplest)

```typescript
// app.module.ts
import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'
import { MyAuthenticator } from './auth/my-authenticator'

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: new MyAuthenticator(),
    }),
  ],
})
export class AppModule {}
```

```typescript
// events.controller.ts
import { Controller, Post, Body } from '@nestjs/common'
import { RealtimeService } from '@bymax-one/nest-realtime'

@Controller('events')
export class EventsController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post('notify')
  async notify(@Body() body: { userId: string; message: string }) {
    await this.realtime.emitToUser(body.userId, {
      type: 'notification',
      data: { message: body.message },
    })
  }
}
```

```tsx
// App.tsx
import { RealtimeProvider, useRealtime } from '@bymax-one/nest-realtime/react'

function NotificationBell() {
  const { lastEvent } = useRealtime<{ message: string }>({ event: 'notification' })
  return <div>{lastEvent?.data.message}</div>
}

export default function App() {
  return (
    <RealtimeProvider url="/api/events/stream">
      <NotificationBell />
    </RealtimeProvider>
  )
}
```

---

### Scenario 2 — SSE + Redis pub/sub (multi-instance)

Use `RedisRealtimePubSub` and `RedisOfflineQueue` (reference implementations) to scale across multiple server instances.

```typescript
import { BymaxRealtimeModule, RedisRealtimePubSub, RedisOfflineQueue } from '@bymax-one/nest-realtime'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: new MyAuthenticator(),
      pubsub: new RedisRealtimePubSub({ client: redis }),
      offlineQueue: new RedisOfflineQueue({ client: redis }),
      sse: {
        endpoint: '/events',
        heartbeatMs: 25_000,
        replayBufferSize: 100,
        maxConnectionsPerUser: 5,
      },
    }),
  ],
})
export class AppModule {}
```

> The `RedisRealtimePubSub` and `RedisOfflineQueue` are reference implementations included in the library. They require `ioredis` as a peer dependency. For custom implementations, implement `IRealtimePubSub` and `IOfflineQueueStorage`.

---

### Scenario 3 — WebSocket-only

```typescript
import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'websocket',
      authenticator: new MyAuthenticator(),
      websocket: {
        namespace: '/',
        cors: { origin: 'https://app.example.com', credentials: true },
        maxConnectionsPerUser: 3,
        redisAdapter: { pubClient: redis },  // uses @socket.io/redis-adapter internally
      },
    }),
  ],
})
export class AppModule {}
```

> **Sticky sessions required** when WebSocket polling transport is enabled and you have multiple instances. The Redis adapter syncs messages, but not handshake affinity.

---

### Scenario 4 — `'both'` migration mode

Use `transport: 'both'` when migrating from SSE to WebSocket (or vice versa). The library fans out a single emit to all connected clients regardless of which transport they use.

```typescript
import { BymaxRealtimeModule, RedisRealtimePubSub } from '@bymax-one/nest-realtime'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'both',
      authenticator: new MyAuthenticator(),
      pubsub: new RedisRealtimePubSub({ client: redis }),  // for SSE fan-out
      sse: {
        endpoint: '/events',
        maxConnectionsPerUser: 5,
      },
      websocket: {
        namespace: '/',
        cors: { origin: true, credentials: true },
        redisAdapter: { pubClient: redis },  // for WS fan-out
      },
    }),
  ],
})
export class AppModule {}
```

> `CompositeTransport.kind === 'sse'` — the composite transport reports itself as SSE because SSE is the dominant transport. `ITransport.kind` is always `'sse' | 'websocket'`, never `'both'`.

---

## 🔌 Auth Inversion

The library **never** verifies JWTs, hashes passwords, or imports any authentication library. It only calls the consumer-provided `IConnectionAuthenticator.authenticate()` on each new connection.

This is a **structural rule** — `src/` has zero imports of `@bymax-one/nest-auth`, `@nestjs/jwt`, or `passport-*`. See `docs/technical_specification.md` §5.2 for the full contract.

### Pattern 1 — Cookie HttpOnly (SSE-safe, recommended)

```typescript
import type { IConnectionAuthenticator, ConnectionAuthContext, AuthenticationResult } from '@bymax-one/nest-realtime'
import { verifyAccessToken } from './jwt'

export class CookieAuthenticator implements IConnectionAuthenticator {
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const token = ctx.cookies['access_token']
    if (!token) return null
    try {
      const claims = await verifyAccessToken(token)
      return { userId: claims.sub, tenantId: claims.tid }
    } catch {
      return null
    }
  }
}
```

### Pattern 2 — Ticket (pre-issued one-time token)

```typescript
export class TicketAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly ticketStore: TicketStore) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticket = ctx.query['ticket']
    if (!ticket || Array.isArray(ticket)) return null
    return this.ticketStore.consume(ticket)  // null if expired/invalid
  }
}
```

> The WebSocket gateway normalizes the `ticket` query parameter to a single string before delegating to `authenticate()`.

### Pattern 3 — Bearer header (WebSocket only)

```typescript
export class BearerAuthenticator implements IConnectionAuthenticator {
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    if (ctx.transport !== 'websocket') return null  // SSE EventSource cannot send headers
    const auth = ctx.headers['authorization']
    if (!auth?.startsWith('Bearer ')) return null
    return this.verifyToken(auth.slice(7))
  }
}
```

> SSE `EventSource` cannot send custom headers. Use a cookie or ticket pattern for SSE connections.

For a complete `@bymax-one/nest-auth` bridge example, see `docs/examples/auth/`.

---

## 🧩 Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `transport` | `'sse' \| 'websocket' \| 'both'` | — | **Required.** Transport mode. |
| `authenticator` | `IConnectionAuthenticator` | — | **Required.** Auth contract implementation. |
| `pubsub` | `IRealtimePubSub` | `InMemoryPubSub` | Cross-instance pub/sub (Redis recommended for multi-instance). |
| `offlineQueue` | `IOfflineQueueStorage` | _(none)_ | Stores events while a user is disconnected. |
| `presence` | `IPresenceStorage` | _(none)_ | Online-user tracking. |
| `hooks` | `IConnectionLifecycleHooks` | _(none)_ | Fire-and-forget connect/disconnect/error callbacks. |
| `reauthenticationPolicy` | `ReauthenticationPolicy` | _(none)_ | Periodic credential revalidation. |
| `sse.endpoint` | `string` | `'/realtime/events'` | SSE endpoint path. |
| `sse.heartbeatMs` | `number` | `25_000` | Interval for `: keepalive` comment (ms). |
| `sse.replayBufferSize` | `number` | `50` | Events kept per user for `Last-Event-ID` replay. |
| `sse.maxConnectionsPerUser` | `number` | `10` | FIFO eviction limit (oldest closed, new admitted). |
| `sse.emitConnectionEvent` | `boolean` | `true` | Send `connection:established` on connect. |
| `websocket.namespace` | `string` | `'/'` | Socket.IO namespace. |
| `websocket.cors` | `CorsConfig` | _(none)_ | CORS for the WebSocket endpoint. |
| `websocket.maxConnectionsPerUser` | `number` | `10` | FIFO eviction limit. |
| `websocket.redisAdapter.pubClient` | `unknown` | _(none)_ | ioredis client for `@socket.io/redis-adapter`. |
| `reauthenticationPolicy.intervalSeconds` | `number` | `300` | How often credentials are revalidated. |
| `reauthenticationPolicy.onFailure` | `'disconnect' \| 'event'` | `'disconnect'` | Action on failed revalidation. |
| `reauthenticationPolicy.cacheTtlMs` | `number` | `60_000` | Positive-result cache TTL. |

For the complete configuration reference, see `docs/technical_specification.md` §4.

For async configuration (`forRootAsync` with `useFactory` / `useClass` / `useExisting`), see the spec §4.3.

---

## 🔍 Replay & Offline Queue

### Last-Event-ID replay (SSE)

When an SSE client reconnects, the browser automatically sends the `Last-Event-ID` header with the ID of the last received event. The library replays all events in the ring buffer newer than that ID.

```typescript
BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(),
  sse: {
    replayBufferSize: 100,  // events kept per user (ring buffer, FIFO eviction)
  },
})
```

### Offline queue

Events emitted while a user has no active connection are stored in the offline queue and delivered when they reconnect:

```typescript
import { RedisOfflineQueue } from '@bymax-one/nest-realtime'

BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(),
  offlineQueue: new RedisOfflineQueue({ client: redis }),
})
```

Implement `IOfflineQueueStorage` to use a custom storage backend.

### FIFO connection eviction

When a user exceeds `maxConnectionsPerUser`, the library closes the **oldest** connection with error code `REALTIME_TOO_MANY_CONNECTIONS` and admits the new connection. It never rejects the new connection with HTTP 429.

---

## 🌐 Frontend (`./react`)

### Installation

```bash
pnpm add react react-dom @bymax-one/nest-realtime
```

### `RealtimeProvider`

Wrap your app (or a subtree) with `RealtimeProvider`. It manages the SSE connection (or WebSocket when `forceWebSocket` is true) and provides context to child hooks.

```tsx
import { RealtimeProvider } from '@bymax-one/nest-realtime/react'

export default function App() {
  return (
    <RealtimeProvider url="/api/realtime/events">
      <YourApp />
    </RealtimeProvider>
  )
}
```

### `useRealtime`

Subscribe to a specific event type. The hook returns the most recent event and a history array.

```tsx
import { useRealtime } from '@bymax-one/nest-realtime/react'

interface InvoiceEvent {
  invoiceId: string
  amount: number
}

function InvoiceList() {
  const { lastEvent, events } = useRealtime<InvoiceEvent>({ event: 'invoice.paid' })

  return (
    <ul>
      {events.map(e => (
        <li key={e.id}>{e.data.invoiceId} — ${e.data.amount}</li>
      ))}
    </ul>
  )
}
```

### `useRealtimeConnection`

Access connection state (connected, transport kind, reconnect count).

```tsx
import { useRealtimeConnection } from '@bymax-one/nest-realtime/react'

function StatusBadge() {
  const { connected, transport } = useRealtimeConnection()
  return <span>{connected ? `✓ ${transport}` : 'disconnected'}</span>
}
```

### `usePresence`

Track online users in a room (requires `IPresenceStorage` configured server-side).

```tsx
import { usePresence } from '@bymax-one/nest-realtime/react'

function OnlineUsers({ roomId }: { roomId: string }) {
  const { onlineUsers } = usePresence(roomId)
  return <div>{onlineUsers.length} online</div>
}
```

### `socket.io-client` dynamic import

`socket.io-client` is loaded via `await import()` only when the `forceWebSocket` option is set or the server upgrades the transport. An SSE-only build never pays for it (SSE bundle ≤ 4 KiB brotli vs ~80 KiB with static socket.io-client).

---

## ⚙️ Horizontal Scaling

### SSE — `IRealtimePubSub`

SSE connections are per-instance. To fan out emits across instances, configure a pub/sub backend:

```typescript
import { RedisRealtimePubSub } from '@bymax-one/nest-realtime'

BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(),
  pubsub: new RedisRealtimePubSub({ client: redis }),
})
```

The cross-instance emit flow: `emitToUser()` delivers locally **and** publishes once to the pub/sub channel. Each other instance's subscriber receives the message and re-emits via its local-only paths (`emitToUserLocal` etc.) — no re-publish, no loop.

Cross-instance connection revocation (e.g. `disconnect()`) uses an `op: 'disconnect'` message over the same channel.

Implement `IRealtimePubSub` to use any pub/sub backend (Redis Streams, NATS, etc.).

### WebSocket — `@socket.io/redis-adapter`

The Redis adapter is registered automatically when `websocket.redisAdapter.pubClient` is provided. It calls `.duplicate()` on the supplied ioredis client to create a dedicated subscriber client.

```typescript
websocket: {
  redisAdapter: { pubClient: redis }
}
```

> Sticky sessions are required when using Socket.IO's HTTP long-polling fallback in a multi-instance setup. The Redis adapter syncs messages between instances but not handshake affinity.

### Integration with `@bymax-one/nest-cache`

The offline queue and presence storage can share the Redis connection managed by `@bymax-one/nest-cache`. See `docs/examples/cache-integration/` for a reference wiring.

---

## 🚧 Infra Notes

SSE connections are long-lived HTTP responses. Certain proxy and CDN defaults can silently break them:

| Concern | Fix |
|---|---|
| **Response body compression** | Disable for the SSE endpoint. `Content-Encoding: gzip` on a streaming response buffers the body, defeating SSE. |
| **Proxy buffering** | Disable. Nginx: `proxy_buffering off`. The library sends `X-Accel-Buffering: no` automatically. |
| **CDN caching** | Add `Cache-Control: no-transform, no-store` on the SSE response. The library sets this by default. |
| **Connection timeout** | Set above your heartbeat interval (default 25s). ALB idle timeout default is 60s — compatible. |
| **WebSocket + polling + load balancer** | Enable sticky sessions (IP hash or cookie affinity). Required for polling fallback; not required for WebSocket-only. |

For Nginx, Cloudflare, AWS ALB, and serverless platform-specific notes, see `docs/architecture/infra-considerations.md`.

---

## 📊 Rooms Convention

| Room ID | Used for | Auto-joined |
|---|---|---|
| `user:{userId}` | Per-user messages (all connections of one user) | ✅ Always |
| `tenant:{tenantId}` | All connections in a tenant | ✅ When `tenantId` is present |
| `resource:{type}:{id}` | Per-resource scoped events (e.g. `resource:invoice:abc123`) | Manual (consumer calls `joinRoom`) |

Use `composeRoomId` to build room IDs consistently:

```typescript
import { composeRoomId } from '@bymax-one/nest-realtime'
const invoiceRoom = composeRoomId('resource', 'invoice', invoiceId)
// → "resource:invoice:abc123"
```

---

## 🧪 Testing

```bash
# Unit + integration tests (100% coverage)
pnpm test:cov

# E2E tests (single-instance, no Redis required)
pnpm test:e2e

# E2E cross-instance tests (requires Redis at REDIS_URL)
REDIS_URL=redis://localhost:6379 pnpm test:e2e -- --testPathPattern=cross-instance

# Mutation testing (pre-release gate; target ≥ 95%)
pnpm mutation

# Build + bundle size gate
pnpm build && pnpm size
```

### Mocking the transport in unit tests

```typescript
import { RealtimeService } from '@bymax-one/nest-realtime'

const mockRealtime = {
  emitToUser: jest.fn(),
  emitToTenant: jest.fn(),
  emitToRoom: jest.fn(),
  broadcast: jest.fn(),
} satisfies Partial<RealtimeService>
```

### EventSource polyfill in E2E tests

The library uses the `eventsource` npm package as an `EventSource` polyfill in Node test environments. E2E tests use `supertest` for the SSE endpoint.

---

## 🤝 Contributing

Bug reports and security disclosures: please read [SECURITY.md](./SECURITY.md) before opening an issue.

For feature requests and pull requests, open a GitHub issue first to discuss the change.

---

## 📜 License

MIT — see [LICENSE](./LICENSE).
