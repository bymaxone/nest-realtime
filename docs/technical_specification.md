# @bymax-one/nest-realtime — Complete Technical Specification

> **Spec revision:** 2.1.0 (audited & hardened) · **Target package release:** v0.1.0
> **Last updated:** 2026-06-23
> **Status:** Ready for implementation
> **Type:** Public npm package (`@bymax-one/nest-realtime`)
> **Supported transports:** **SSE (Server-Sent Events)** — default — **and WebSocket (Socket.IO)** opt-in
> **Architectural pattern:** Unified server-side API via `ITransport`; consumer picks transport in config

---

## Table of Contents

1. [Vision and Value Proposition](#1-vision-and-value-proposition)
2. [Architecture](#2-architecture)
3. [Package Structure](#3-package-structure)
4. [Configuration API](#4-configuration-api)
5. [Contracts](#5-contracts)
6. [Transports](#6-transports)
7. [Services](#7-services)
8. [Authentication Strategy](#8-authentication-strategy)
9. [Rooms and Multi-tenant](#9-rooms-and-multi-tenant)
10. [Replay and Offline Queue](#10-replay-and-offline-queue)
11. [Horizontal Scalability](#11-horizontal-scalability)
12. [Frontend Integration](#12-frontend-integration)
13. [Standard Event Catalog](#13-standard-event-catalog)
14. [Error Code Catalog](#14-error-code-catalog)
15. [What is NOT in the package](#15-what-is-not-in-the-package)
16. [Dependencies](#16-dependencies)
17. [Implementation Phases](#17-implementation-phases)
18. [Known Limitations](#18-known-limitations)
19. [Example Integration](#19-example-integration)
20. [Appendix A — Glossary](#appendix-a--glossary)
21. [Appendix B — SSE vs WebSocket — when to pick each one](#appendix-b--sse-vs-websocket--when-to-pick-each-one)
22. [Appendix C — Proxy and infra considerations](#appendix-c--proxy-and-infra-considerations)

---

## 1. Vision and Value Proposition

### 1.1 What `@bymax-one/nest-realtime` is

`@bymax-one/nest-realtime` is a NestJS library for real-time backend → frontend communication (and optionally bi-directional) with **two interchangeable transport implementations**:

- **SSE (Server-Sent Events)** — default. Server → client one-way push over standard HTTP, authentication via HttpOnly cookie, native browser reconnection via `EventSource`, event replay via `Last-Event-ID`.
- **WebSocket** (Socket.IO) — opt-in. Full duplex, native multi-tenant namespaces, built-in rooms, horizontal scalability via `@socket.io/redis-adapter`.

The server-side API is **unified**: `realtimeService.emitToUser(userId, event, data)` works identically on any transport. Switching from SSE to WebSocket (or vice versa) is a **one-line config change** — application code does not change.

### 1.2 Why it exists — and why dual-transport

In multi-tenant SaaS architectures, you commonly need:
- Server-push notifications (payment received, invoice paid, webhook arrived) → **SSE is ideal**
- Live indicators on dashboards (job status, live metrics) → **SSE is ideal**
- Chat / collaboration / gaming → **WebSocket required** (bi-directional)

Without dual-transport, projects have to:
- Choose an SSE-only or WS-only lib
- Rewrite the server-side API when migrating between transports
- Keep two event/room conventions if they need both

`@bymax-one/nest-realtime` resolves this by unifying the server-side concept and exposing the transport as an infrastructure detail. For the developer calling `realtimeService.emitToTenant('t_acme', 'invoice.paid', { id: 'inv_123' })`, the transport is invisible.

### 1.3 Why SSE as the default

| Criterion | SSE | WebSocket |
|---|---|---|
| Coverage of **server-push** use cases | 100% | 100% (with overhead) |
| HttpOnly cookie auth | ✅ Native (standard HTTP) | ⚠️ Cumbersome (custom handshake) |
| Corporate proxies/firewalls | ✅ Passes through (standard HTTP) | ⚠️ Frequently blocked |
| Automatic reconnection | ✅ Browser via `EventSource` | ⚠️ Library (socket.io-client) |
| Frontend bundle | 0 KB (native `EventSource`) | ~80 KB (socket.io-client) |
| HTTP/2 multiplexing | ✅ Multiple streams per connection | ❌ N/A |
| Replay of missed events | ✅ `Last-Event-ID` builtin | ❌ Manual via offline queue |
| Native NestJS support | ✅ `@Sse()` decorator + RxJS | ✅ `@WebSocketGateway()` |

For the predominant SaaS use cases (server-push notifications, live dashboards, status updates), **SSE is simpler, lighter, and more robust**. WebSocket is reserved for real bi-directional needs (chat, collaborative editing, remote control).

### 1.4 Who uses it

- Multi-tenant NestJS backends that need to push notifications to the frontend
- Dashboards/admin panels with live indicators (webhook status, jobs, metrics)
- Applications migrating from HTTP polling to realtime without rewriting the whole stack
- Products that **may** evolve to bi-directional (start with SSE, migrate to WS without changing the API)
- Applications with real bi-directional requirements from day 1 (chat, collab) — use WebSocket directly

### 1.5 Distribution model

| Aspect | Detail |
|---|---|
| Registry | Public npm (`@bymax-one/nest-realtime`) |
| Cost | Zero — open source package |
| License | MIT |
| Runtime | Node.js 24+ |
| Backend framework | NestJS 11+ |
| Frontend framework | React 19+ via subpath `./react` (optional) |
| Subpaths | `.` (server), `./shared`, `./react` |

### 1.6 Design principles

1. **Transport-agnostic server-side API** — `RealtimeService` exposes `emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, and `disconnect`. Works identically with SSE, WS, or both simultaneously.
2. **Auth inversion** — the lib never imports `@bymax-one/nest-auth` or `@nestjs/jwt`. Consumer plugs in `IConnectionAuthenticator` (interface). Works with nest-auth (recommended), custom JWT, ticket pattern, or any strategy.
3. **SSE first, WS opt-in** — defaults favor the most common case (server→client push). WebSocket is enabled explicitly.
4. **Tree-shakeable frontend** — `useRealtime` detects SSE vs WS via URL scheme; `socket.io-client` is an optional peer dep loaded dynamically.
5. **Multi-tenant ready** — `tenantId` is automatically propagated in rooms. Isolation by namespace (WS) or room logic (SSE).
6. **Built-in horizontal scaling** — `IRealtimePubSub` for SSE (Redis pub/sub), `@socket.io/redis-adapter` for WS. Same architectural pattern in both.
7. **Built-in replay** — `Last-Event-ID` on SSE; optional offline queue for WS via `IOfflineQueueStorage`.
8. **Zero critical external dependencies** — only `rxjs` and `reflect-metadata` (both already NestJS deps) are required; everything else is an optional peer dep per transport.

### 1.7 Feature categorization

#### Core (always active)

| Component | Responsibility |
|---|---|
| `RealtimeService` | Unified API (`emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, `disconnect`) |
| `RoomRegistry` | Internal tracking of `Map<roomId, Set<connectionId>>` |
| `ConnectionRegistry` | Internal tracking of active connections with metadata (userId, tenantId, transport) |
| `IConnectionAuthenticator` | Required interface — consumer implements |
| `EventIdGenerator` | Generates monotonic IDs for `Last-Event-ID` and correlation |

#### SSE Transport (default — opt-out via `transport: 'websocket'`)

| Component | Responsibility |
|---|---|
| `SseTransport` | Implements `ITransport` over `@Sse()` + RxJS Subjects |
| `SseController` | Exposes HTTP endpoint (`GET /events` or configured path) |
| `EventReplayBuffer` | Keeps in-memory ring buffer for `Last-Event-ID` support |
| `HeartbeatService` | Periodically sends ping (`: keepalive\n\n`) to avoid proxy timeout |

#### WebSocket Transport (opt-in via `transport: 'websocket' | 'both'`)

| Component | Responsibility |
|---|---|
| `WebSocketTransport` | Implements `ITransport` over `@WebSocketGateway()` |
| `RealtimeGateway` | NestJS gateway with multi-tenant namespaces |
| `SocketIoRedisAdapter` | Auto-registers `@socket.io/redis-adapter` when a Redis client is provided |

#### Composite Transport (opt-in via `transport: 'both'`)

| Component | Responsibility |
|---|---|
| `CompositeTransport` | Fan-out emits to SSE and WS simultaneously — useful in migrations |

#### Frontend (`./react`)

| Component | Responsibility |
|---|---|
| `useRealtime` | Universal hook — detects SSE vs WS via URL scheme |
| `useRealtimeConnection` | Connection status (connected, reconnecting, error) |
| `usePresence` | Who is online (optional — requires `IPresenceStorage`) |
| `RealtimeProvider` | Context provider for multiple hooks to share a connection |

---

## 2. Architecture

### 2.1 NestJS dynamic module pattern

```typescript
// Synchronous
BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(jwtService),
})

// Asynchronous (recommended for projects with ConfigService)
BymaxRealtimeModule.forRootAsync({
  imports: [ConfigModule, AuthModule, CacheModule],
  inject: [ConfigService, JwtService, REDIS_CLIENT],
  useFactory: (config, jwt, redis) => ({
    transport: config.get('REALTIME_TRANSPORT') ?? 'sse',
    authenticator: new NestAuthBridge(jwt),
    sse: { endpoint: '/events', heartbeatMs: 30_000 },
    pubsub: new RedisPubSub(redis),  // enables SSE horizontal scaling
  }),
})
```

### 2.2 Logical diagram — SSE mode

```
┌─────────────┐  HTTP GET /events     ┌──────────────────┐
│   Browser   │ ───────────────────►  │ SseController    │
│  EventSource│  text/event-stream    │  @Sse('events')  │
│             │ ◄───────────────────  │                  │
└─────────────┘  (long-lived)         └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │  SseTransport    │
                                       │  ┌─────────────┐ │
                                       │  │ConnRegistry │ │
                                       │  │RoomRegistry │ │
                                       │  └─────────────┘ │
                                       └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │ RealtimeService  │ ← called from any service
                                       │  emitToUser()    │
                                       │  emitToTenant()  │
                                       │  emitToRoom()    │
                                       └────────┬─────────┘
                                                │ (optional)
                                                ▼
                                       ┌──────────────────┐
                                       │ IRealtimePubSub  │
                                       │  (Redis pub/sub) │ ← horizontal scaling
                                       └──────────────────┘
```

### 2.3 Logical diagram — WebSocket mode

```
┌─────────────┐  WS upgrade           ┌──────────────────┐
│   Browser   │ ──────────────────►   │ RealtimeGateway  │
│ socket.io-  │     ws / wss          │ @WebSocketGateway│
│  client     │ ◄──────────────────   │                  │
└─────────────┘   bidirectional       └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │WebSocketTransport│
                                       │  Socket.IO rooms │
                                       └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │ RealtimeService  │
                                       └────────┬─────────┘
                                                │ (optional)
                                                ▼
                                       ┌──────────────────────────┐
                                       │@socket.io/redis-adapter  │ ← horizontal scaling
                                       └──────────────────────────┘
```

### 2.4 Connection flow (SSE)

```
1. Browser opens <EventSource>("/events")
2. HTTP GET /events request with HttpOnly cookies →
3. SseController.subscribe():
   - extracts auth cookie
   - calls IConnectionAuthenticator.authenticate(req)
   - if invalid → 401 (browser does not reconnect after fatal 401)
   - if valid → creates connectionId, creates RxJS Subject<MessageEvent> →
4. ConnectionRegistry.register({ connectionId, userId, tenantId, transport: 'sse', subject }) →
5. SseTransport automatically adds to default rooms:
   - user:{userId}
   - tenant:{tenantId} (if applicable)
   - default broadcast room →
6. RxJS Observable is returned to NestJS → HTTP response with correct SSE headers →
7. Browser starts receiving: data: {...}\n\n →
8. On any disconnect, the stream is torn down via `takeUntil(close$)` (server-initiated: `disconnect()` calls `close$.next()`) or the client closing the HTTP connection; `finalize()` then runs:
   - HeartbeatService clears this connection's keepalive interval
   - ConnectionRegistry.unregister(connectionId)
   - onDisconnect lifecycle hook →
9. Browser automatically reconnects in ~3s; sends Last-Event-ID if present →
10. Server replays events with id > Last-Event-ID via EventReplayBuffer
```

### 2.5 Connection flow (WebSocket)

```
1. Browser opens socket.io-client(url, { withCredentials: true })
2. HTTP upgrade to WS, handshake with cookies →
3. RealtimeGateway.handleConnection(socket):
   - extracts auth cookie from socket.handshake.headers.cookie
   - calls IConnectionAuthenticator.authenticate(socket.handshake)
   - if invalid → socket.disconnect(true)
   - if valid → ConnectionRegistry.register →
4. socket.join('user:{userId}'), socket.join('tenant:{tenantId}') →
5. Emits canonical 'connection:established' with { connectionId, traits } (a client-safe subset of auth — see §6.2) →
6. Client OK; events flow bi-directionally →
7. On disconnect:
   - socket.on('disconnect') → ConnectionRegistry.unregister →
   - onDisconnect lifecycle
```

### 2.6 Emit flow (any transport)

```
Application service calls:
  realtimeService.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
  ↓
RealtimeService.emitToUser:
  ↓
  For each active transport (SSE / WS / both):
    transport.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
  ↓
SseTransport.emitToUser:
  - looks up user subjects in ConnectionRegistry (filtering transport='sse')
  - for each subject:
    - creates MessageEvent { id: nextId(), type: 'invoice.paid', data: {...} }
    - appends to EventReplayBuffer
    - subject.next(event)
  ↓
WebSocketTransport.emitToUser:
  - this.server.to('user:u_abc').emit('invoice.paid', { id: 'inv_123' })
  ↓
(optional) IRealtimePubSub.publish({ op: 'emitToUser', args, origin })
  → other backend instances receive and call the LOCAL-ONLY emit path
    (e.g. emitToUserLocal) — never the publishing emit, so a remote
    message triggers exactly one local delivery and is never re-published
```

---

## 3. Package Structure

### 3.1 Directory tree

```
src/
├── server/
│   ├── services/
│   │   ├── realtime.service.ts              # Unified public API
│   │   ├── connection-registry.service.ts   # Map<connectionId, ConnectionMeta>
│   │   ├── room-registry.service.ts         # Map<roomId, Set<connectionId>>
│   │   └── event-id-generator.service.ts    # Monotonic for Last-Event-ID
│   │
│   ├── transports/
│   │   ├── sse/
│   │   │   ├── sse.transport.ts             # ITransport impl
│   │   │   ├── sse.controller.ts            # @Sse() endpoint
│   │   │   ├── event-replay-buffer.ts       # Ring buffer for Last-Event-ID
│   │   │   └── heartbeat.service.ts         # ping :keepalive
│   │   ├── websocket/
│   │   │   ├── websocket.transport.ts       # ITransport impl
│   │   │   ├── realtime.gateway.ts          # @WebSocketGateway()
│   │   │   └── socket-io-redis-adapter.ts   # Wrapper around @socket.io/redis-adapter
│   │   └── composite/
│   │       └── composite.transport.ts       # Fan-out SSE + WS
│   │
│   ├── interfaces/
│   │   ├── transport.interface.ts           # ITransport
│   │   ├── connection-authenticator.interface.ts  # IConnectionAuthenticator
│   │   ├── connection-lifecycle-hooks.interface.ts # IConnectionLifecycleHooks
│   │   ├── realtime-pubsub.interface.ts     # IRealtimePubSub (SSE scaling)
│   │   ├── offline-queue-storage.interface.ts # IOfflineQueueStorage
│   │   └── presence-storage.interface.ts    # IPresenceStorage (optional)
│   │
│   ├── dto/
│   │   └── emit-payload.dto.ts
│   │
│   ├── decorators/
│   │   ├── on-connect.decorator.ts          # @OnConnect()
│   │   ├── on-disconnect.decorator.ts       # @OnDisconnect()
│   │   └── subscribe.decorator.ts           # @Subscribe('event') — WS only
│   │
│   ├── pubsub/
│   │   ├── in-memory-pubsub.ts              # Single-instance dev
│   │   └── (consumer provides Redis-backed)
│   │
│   ├── config/
│   │   ├── default-options.ts
│   │   └── validate-options.ts
│   │
│   ├── errors/
│   │   └── realtime-error-codes.constants.ts
│   │
│   ├── constants/
│   │   └── injection-tokens.constants.ts    # server-owned DI tokens (the only server-scoped constants;
│   │                                        # ROOM_PREFIXES + RESERVED_EVENT_NAMES are single-sourced in shared/
│   │                                        # and re-exported from the server index.ts)
│   │
│   ├── utils/
│   │   ├── encode-sse-event.ts              # MessageEvent → SSE wire format
│   │   ├── parse-cookie-header.ts
│   │   └── compose-room-id.ts
│   │
│   ├── realtime.module.ts                   # BymaxRealtimeModule
│   └── index.ts
│
├── shared/
│   ├── types/
│   │   ├── realtime-event.type.ts           # Generic Event<TData>
│   │   ├── connection-meta.type.ts
│   │   └── transport-mode.type.ts           # 'sse' | 'websocket' | 'both'
│   ├── constants/
│   │   ├── reserved-events.constants.ts     # canonical event names
│   │   └── room-prefixes.constants.ts
│   └── index.ts
│
└── react/
    ├── hooks/
    │   ├── use-realtime.ts                  # Universal hook (auto-detect)
    │   ├── use-realtime-connection.ts       # Connection state
    │   └── use-presence.ts
    ├── components/
    │   └── realtime-provider.tsx            # Context provider
    ├── internal/
    │   ├── sse-client.ts                    # EventSource wrapper
    │   └── websocket-client.ts              # socket.io-client dynamic import
    └── index.ts
```

### 3.2 Subpath exports

```json
"exports": {
  ".": {
    "types": "./dist/server/index.d.ts",
    "import": "./dist/server/index.mjs",
    "require": "./dist/server/index.cjs"
  },
  "./shared": {
    "types": "./dist/shared/index.d.ts",
    "import": "./dist/shared/index.mjs",
    "require": "./dist/shared/index.cjs"
  },
  "./react": {
    "types": "./dist/react/index.d.ts",
    "import": "./dist/react/index.mjs",
    "require": "./dist/react/index.cjs"
  }
}
```

### 3.3 Exports per subpath

**`@bymax-one/nest-realtime`** (server):

```typescript
// Module
export { BymaxRealtimeModule } from './realtime.module'

// Services
export { RealtimeService } from './services/realtime.service'

// Interfaces + the supporting types a consumer must reference to implement
// the (mandatory) authenticator, pub/sub, offline queue, and lifecycle hooks.
export type {
  ITransport,
  IConnectionAuthenticator,
  IConnectionLifecycleHooks,
  IRealtimePubSub,
  IOfflineQueueStorage,
  IPresenceStorage,
  // Supporting types referenced by the public API + reference implementations:
  AuthenticationResult,        // returned by IConnectionAuthenticator.authenticate / used by tenantResolver
  ConnectionAuthContext,       // received by IConnectionAuthenticator.authenticate
  ConnectionEventMeta,         // received by IConnectionLifecycleHooks
  RealtimePubSubMessage,       // used by IRealtimePubSub reference impl
  OfflineQueuedEvent,          // used by IOfflineQueueStorage reference impl
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleAsyncOptions,
} from './interfaces'

// Decorators (reserved public surface — see §7.5)
export { OnConnect, OnDisconnect, Subscribe } from './decorators'

// Constants — single-sourced in ./shared (zero-dep) and re-exported here so the
// `.` and `./shared` subpaths expose identical names.
export { ROOM_PREFIXES, RESERVED_EVENT_NAMES } from './shared'

// Tokens
export {
  REALTIME_OPTIONS_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_HOOKS_TOKEN,
} from './constants/injection-tokens.constants'
```

**`@bymax-one/nest-realtime/shared`** (zero deps):

```typescript
export type { RealtimeEvent, ConnectionMeta, TransportMode } from './types'
export { RESERVED_EVENT_NAMES, ROOM_PREFIXES } from './constants'
```

**`@bymax-one/nest-realtime/react`** (peer dep React 19):

```typescript
export { useRealtime } from './hooks/use-realtime'
export { useRealtimeConnection } from './hooks/use-realtime-connection'
export { usePresence } from './hooks/use-presence'
export { RealtimeProvider } from './components/realtime-provider'
export type { UseRealtimeOptions, UseRealtimeReturn } from './hooks/use-realtime'
```

---

## 4. Configuration API

### 4.1 `BymaxRealtimeModuleOptions` interface

```typescript
export type TransportMode = 'sse' | 'websocket' | 'both'

export interface BymaxRealtimeModuleOptions {
  /**
   * Transport implementation. Default 'sse' — server-push only over HTTP.
   * Use 'websocket' if you need bi-directional communication.
   * Use 'both' for migrations or apps where some features need each.
   */
  transport: TransportMode

  /**
   * Service metadata — propagated to logs and connection metadata.
   */
  service?: {
    name: string
    version: string
  }

  /**
   * Authentication — required. Consumer plugs in any strategy (nest-auth, custom JWT, ticket).
   */
  authenticator: IConnectionAuthenticator

  /**
   * Tenant resolver — extracts tenantId from authenticated context.
   * Used to scope multi-tenant rooms. Optional for single-tenant apps.
   */
  tenantResolver?: (auth: AuthenticationResult) => string | undefined

  /**
   * Lifecycle hooks — onConnect, onDisconnect, onError, onReauthenticationFailed.
   */
  hooks?: IConnectionLifecycleHooks

  /**
   * Cross-instance pub/sub — required when running multiple backend instances.
   * For SSE/both: implement IRealtimePubSub backed by Redis pub/sub.
   * For websocket-only: also accepts @socket.io/redis-adapter pubClient (set via .websocket.redisAdapter).
   */
  pubsub?: IRealtimePubSub

  /**
   * Optional storage for replay/queue when client is offline or reconnecting.
   * SSE: backs Last-Event-ID replay beyond in-memory buffer.
   * WS: queues events for offline users.
   */
  offlineQueue?: IOfflineQueueStorage

  /**
   * Optional presence storage — tracks "who's online" cross-instance.
   */
  presence?: IPresenceStorage

  /**
   * SSE-specific configuration.
   * Applied when transport is 'sse' or 'both'.
   */
  sse?: {
    /** HTTP path for the SSE endpoint. @default '/events' */
    endpoint?: string
    /** Heartbeat interval in ms — sends ': keepalive\n\n' to keep proxies happy. @default 30000 (30s) */
    heartbeatMs?: number
    /** Ring buffer size for Last-Event-ID replay (per-user). @default 100 */
    replayBufferSize?: number
    /** Maximum concurrent SSE connections per user. @default 5 */
    maxConnectionsPerUser?: number
    /** CORS configuration (passed to NestJS). */
    cors?: CorsConfig
    /** Whether to enable the canonical 'connection:established' event on connect. @default true */
    emitConnectionEvent?: boolean
  }

  /**
   * WebSocket-specific configuration.
   * Applied when transport is 'websocket' or 'both'.
   */
  websocket?: {
    /** Socket.IO namespace. @default '/' */
    namespace?: string
    /** CORS configuration for Socket.IO. */
    cors?: CorsConfig
    /** Maximum payload size in bytes. @default 1_000_000 (1 MB) */
    maxHttpBufferSize?: number
    /** Ping interval in ms. @default 25000 */
    pingIntervalMs?: number
    /** Ping timeout in ms. @default 20000 */
    pingTimeoutMs?: number
    /** Maximum concurrent WS connections per user. @default 5 */
    maxConnectionsPerUser?: number
    /**
     * Redis adapter for horizontal scaling.
     * Pass an ioredis client; the lib creates a pub/sub pair via `.duplicate()`.
     */
    redisAdapter?: {
      pubClient: import('ioredis').Redis
    }
  }

  /**
   * Re-authentication policy — verify credentials remain valid during long sessions.
   */
  reauthenticationPolicy?: {
    /** Re-check authentication every N seconds. @default 300 (5 min) */
    intervalSeconds?: number
    /** Action on failed re-auth: 'disconnect' (default) or 'event' (emit then disconnect). */
    onFailure?: 'disconnect' | 'event'
    /** Cache positive auth results for N ms to reduce load. @default 60000 (60s) */
    cacheTtlMs?: number
  }
}
```

### 4.2 Options table and defaults

| Option | Type | Default | Notes |
|---|---|---|---|
| `transport` | `'sse' \| 'websocket' \| 'both'` | **required** | Defines which stack initializes |
| `authenticator` | `IConnectionAuthenticator` | **required** | The lib does not work without auth — security guard rail |
| `tenantResolver` | `(auth) => string \| undefined` | direct `auth.tenantId` | Custom for apps with their own mapping |
| `hooks` | `IConnectionLifecycleHooks` | `NoOpHooks` | Useful for audit log, metrics |
| `pubsub` | `IRealtimePubSub` | `InMemoryPubSub` | Without it = single-instance; with it = horizontal scaling |
| `offlineQueue` | `IOfflineQueueStorage` | `undefined` | Without it, events for offline users are lost |
| `presence` | `IPresenceStorage` | `undefined` | Enables the `usePresence` frontend hook |
| `sse.endpoint` | `string` | `'/events'` | HTTP path |
| `sse.heartbeatMs` | `number` | `30000` | Keeps the connection alive behind proxies |
| `sse.replayBufferSize` | `number` | `100` | Events retained in memory for Last-Event-ID |
| `sse.maxConnectionsPerUser` | `number` | `5` | **FIFO eviction**: admits the new connection, evicts the user's oldest with `REALTIME_TOO_MANY_CONNECTIONS` (never rejects with 429) |
| `sse.cors` | `CorsConfig` | `undefined` | CORS for the SSE HTTP endpoint (passed to NestJS) |
| `sse.emitConnectionEvent` | `boolean` | `true` | Client receives `connection:established` on connect |
| `service` | `{ name; version }` | `undefined` | Service metadata propagated to logs + connection metadata |
| `websocket.namespace` | `string` | `'/'` | Root Socket.IO namespace |
| `websocket.cors` | `CorsConfig` | `undefined` | **Socket.IO's own** CORS option (configured separately from HTTP CORS) |
| `websocket.pingIntervalMs` | `number` | `25000` | Socket.IO default |
| `websocket.pingTimeoutMs` | `number` | `20000` | Socket.IO default |
| `websocket.maxHttpBufferSize` | `number` | `1_000_000` | 1 MB — protects against abuse |
| `websocket.maxConnectionsPerUser` | `number` | `5` | FIFO eviction (same policy as SSE) |
| `websocket.redisAdapter` | `{ pubClient }` | `undefined` | ioredis client for `@socket.io/redis-adapter` (lib calls `.duplicate()` for the subscriber) |
| `reauthenticationPolicy.onFailure` | `'disconnect' \| 'event'` | `'disconnect'` | Action when periodic re-auth fails |
| `reauthenticationPolicy.intervalSeconds` | `number` | `300` (5 min) | Re-check creds on long connections |
| `reauthenticationPolicy.cacheTtlMs` | `number` | `60000` (60s) | Caches positive auth |

### 4.3 Example `forRoot` — simple SSE

```typescript
import { Module } from '@nestjs/common'
import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'
import { NestAuthRealtimeBridge } from './realtime/nest-auth-realtime-bridge'

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      service: { name: 'my-app', version: process.env.RELEASE_SHA ?? 'dev' },
      authenticator: new NestAuthRealtimeBridge(),  // read JWT cookie, decode
      sse: {
        endpoint: '/events',
        heartbeatMs: 30_000,
      },
    }),
  ],
})
export class AppModule {}
```

### 4.4 Example `forRootAsync` — multi-instance production with SSE + Redis pub/sub

```typescript
@Module({
  imports: [
    BymaxRealtimeModule.forRootAsync({
      imports: [ConfigModule, AuthModule, CacheModule],
      inject: [ConfigService, JwtService, REDIS_CLIENT],
      useFactory: (config: ConfigService, jwt: JwtService, redis: Redis) => ({
        transport: 'sse',
        service: {
          name: config.getOrThrow('OTEL_SERVICE_NAME'),
          version: config.getOrThrow('RELEASE_SHA'),
        },
        authenticator: new NestAuthRealtimeBridge(jwt),
        tenantResolver: (auth) => auth.tenantId,
        pubsub: new RedisRealtimePubSub(redis, { channel: 'realtime' }),
        offlineQueue: new RedisOfflineQueue(redis, { ttlSeconds: 86_400 }),
        sse: {
          endpoint: '/events',
          heartbeatMs: 30_000,
          replayBufferSize: 200,
          cors: { origin: config.getOrThrow('FRONTEND_URL'), credentials: true },
        },
        hooks: {
          onConnect: (meta) => auditService.log('REALTIME_CONNECT', meta),
          onDisconnect: (meta) => auditService.log('REALTIME_DISCONNECT', meta),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

### 4.5 Example — `transport: 'both'` in SSE → WS migration

```typescript
// Use case: the app already has SSE running; new features (chat) need WS.
// Runs both simultaneously; emits made via the API go to both transports.

BymaxRealtimeModule.forRoot({
  transport: 'both',
  authenticator: new NestAuthRealtimeBridge(),
  pubsub: new RedisRealtimePubSub(redis),
  sse: { endpoint: '/events', heartbeatMs: 30_000 },
  websocket: {
    namespace: '/chat',
    redisAdapter: { pubClient: redis },
  },
})
```

### 4.6 Injection tokens

```typescript
export const REALTIME_OPTIONS_TOKEN = Symbol('BYMAX_REALTIME_OPTIONS')
export const REALTIME_TRANSPORT_TOKEN = Symbol('BYMAX_REALTIME_TRANSPORT')
export const REALTIME_AUTHENTICATOR_TOKEN = Symbol('BYMAX_REALTIME_AUTHENTICATOR')
export const REALTIME_PUBSUB_TOKEN = Symbol('BYMAX_REALTIME_PUBSUB')
export const REALTIME_OFFLINE_QUEUE_TOKEN = Symbol('BYMAX_REALTIME_OFFLINE_QUEUE')
export const REALTIME_PRESENCE_TOKEN = Symbol('BYMAX_REALTIME_PRESENCE')
export const REALTIME_HOOKS_TOKEN = Symbol('BYMAX_REALTIME_HOOKS')
```

### 4.7 `BymaxRealtimeModuleAsyncOptions`

The async configuration shape consumed by `BymaxRealtimeModule.forRootAsync` (used in §2.1, §4.4, §19.1). The `useFactory` resolves to a `BymaxRealtimeModuleOptions`.

```typescript
import { ModuleMetadata, Provider, Type } from '@nestjs/common'

export interface BymaxRealtimeModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Providers to inject into `useFactory`. */
  inject?: Array<Type<unknown> | string | symbol>
  /** Factory returning the resolved options (sync or async). */
  useFactory: (...args: never[]) => BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
  /** Extra providers to register in the module scope (e.g. an authenticator class). */
  extraProviders?: Provider[]
}
```

---

## 5. Contracts

### 5.1 `ITransport` — unified interface

```typescript
export interface ITransport {
  /** Transport identifier — 'sse' or 'websocket'. */
  readonly kind: 'sse' | 'websocket'

  /** Send to every connection of a single user. */
  emitToUser(userId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection of every user in a tenant. */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection in a logical room. */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void>

  /** Send to all connected clients. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void>

  /** Join a connection to a room (idempotent). */
  joinRoom(connectionId: string, roomId: string): Promise<void>

  /** Leave a connection from a room (idempotent). */
  leaveRoom(connectionId: string, roomId: string): Promise<void>

  /** Disconnect a specific connection (e.g., on auth revocation). */
  disconnect(connectionId: string, reason?: string): Promise<void>

  /** Lifecycle — called on NestJS bootstrap. */
  onModuleInit?(): Promise<void>

  /** Lifecycle — called on NestJS shutdown. */
  onApplicationShutdown?(): Promise<void>
}
```

### 5.2 `IConnectionAuthenticator` — plug-and-play auth

```typescript
/**
 * Generic shape returned by `authenticate()`.
 * Consumer can extend with extra fields (e.g., roles, permissions).
 */
export interface AuthenticationResult {
  userId: string
  tenantId?: string
  roles?: readonly string[]
  /** Free-form extras for downstream code (e.g., feature flags). */
  metadata?: Record<string, unknown>
}

export interface IConnectionAuthenticator {
  /**
   * Authenticate a connection request.
   * Receives transport-agnostic context: cookies, headers, query string.
   *
   * @returns Authenticated result, or `null` to reject the connection.
   */
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null>

  /**
   * (Optional) Re-validate during long sessions.
   * Called periodically based on reauthenticationPolicy.intervalSeconds.
   * @returns true to keep alive, false to disconnect.
   */
  revalidate?(connectionId: string, originalAuth: AuthenticationResult): Promise<boolean>
}

export interface ConnectionAuthContext {
  /** Cookies parsed from request headers. */
  cookies: Record<string, string>
  /** Selected headers — never includes Authorization in the SSE EventSource flow (browser strips it). */
  headers: Record<string, string | undefined>
  /** Query string params (for ticket-style auth). */
  query: Record<string, string | undefined>
  /** Client IP (best-effort, behind proxy may need x-forwarded-for). */
  ip: string
  /** User-Agent header. */
  userAgent: string | undefined
  /** Transport kind initiating the connection. */
  transport: 'sse' | 'websocket'
}
```

#### Example implementation — bridge for `@bymax-one/nest-auth`

```typescript
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IConnectionAuthenticator, ConnectionAuthContext, AuthenticationResult } from '@bymax-one/nest-realtime'

@Injectable()
export class NestAuthRealtimeBridge implements IConnectionAuthenticator {
  constructor(private readonly jwt: JwtService) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    // nest-auth standard cookie name
    const token = ctx.cookies['access_token']
    if (!token) return null

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tid?: string; roles?: string[] }>(token)
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles,
      }
    } catch {
      return null
    }
  }

  async revalidate(_connectionId: string, originalAuth: AuthenticationResult): Promise<boolean> {
    // For instant revocation, check a blacklist:
    // return !(await this.redis.exists(`auth:revoked:${originalAuth.userId}`))
    return true
  }
}
```

#### Example implementation — ticket pattern (for clients without cookies)

```typescript
// 1. Client makes POST /events/ticket → receives a one-shot ticket
// 2. Client opens EventSource('/events?ticket=xxx')

@Injectable()
export class TicketAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly redis: Redis) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticket = ctx.query['ticket']
    if (!ticket) return null

    // Tickets are one-shot, TTL 60s
    const raw = await this.redis.getdel(`realtime:ticket:${ticket}`)
    if (!raw) return null

    return JSON.parse(raw) as AuthenticationResult
  }
}
```

### 5.3 `IConnectionLifecycleHooks`

```typescript
export interface ConnectionEventMeta {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: 'sse' | 'websocket'
  ip: string
  userAgent: string | undefined
  connectedAt: Date
}

export interface IConnectionLifecycleHooks {
  /** Called after authentication succeeds. */
  onConnect?(meta: ConnectionEventMeta): void | Promise<void>

  /** Called when connection closes (any reason). */
  onDisconnect?(meta: ConnectionEventMeta & { reason?: string; durationMs: number }): void | Promise<void>

  /** Called on transport error. */
  onError?(meta: { connectionId?: string; error: Error; transport: 'sse' | 'websocket' }): void | Promise<void>

  /** Called on re-authentication failure. */
  onReauthenticationFailed?(meta: ConnectionEventMeta): void | Promise<void>
}
```

### 5.4 `IRealtimePubSub` — horizontal scaling

```typescript
export interface RealtimePubSubMessage {
  /** Operation type. */
  op: 'emitToUser' | 'emitToTenant' | 'emitToRoom' | 'broadcast' | 'disconnect'
  /** Operation arguments — shape depends on op. */
  args: unknown
  /** Instance ID that originated the message (avoid echo). */
  origin: string
}

/**
 * Shape of `RealtimePubSubMessage.args` for the emit ops, used by the §6.1
 * subscriber dispatch. The `disconnect` op instead carries `{ connectionId, reason }`.
 */
export interface EmitArgs {
  userId?: string
  tenantId?: string
  roomId?: string
  event: string
  data: unknown
  id: string
}

export interface IRealtimePubSub {
  /** Publish a message to all subscribers (other instances). */
  publish(message: RealtimePubSubMessage): Promise<void>

  /** Subscribe to messages. Returns an unsubscribe handle. */
  subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>>
}
```

Redis-backed implementation (reference):

```typescript
import Redis from 'ioredis'
import { IRealtimePubSub, RealtimePubSubMessage } from '@bymax-one/nest-realtime'
import { randomUUID } from 'node:crypto'

export class RedisRealtimePubSub implements IRealtimePubSub {
  private readonly instanceId = randomUUID()
  private readonly pub: Redis
  private readonly sub: Redis
  private handlers: Set<(m: RealtimePubSubMessage) => void> = new Set()

  constructor(redisClient: Redis, private readonly opts: { channel?: string } = {}) {
    this.pub = redisClient
    this.sub = redisClient.duplicate()
    const channel = opts.channel ?? 'realtime:bus'

    void this.sub.subscribe(channel)
    this.sub.on('message', (_ch, raw) => {
      const msg = JSON.parse(raw) as RealtimePubSubMessage
      if (msg.origin === this.instanceId) return  // ignore self
      for (const h of this.handlers) h(msg)
    })
  }

  async publish(message: RealtimePubSubMessage): Promise<void> {
    const channel = this.opts.channel ?? 'realtime:bus'
    await this.pub.publish(channel, JSON.stringify({ ...message, origin: this.instanceId }))
  }

  async subscribe(handler: (m: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => { this.handlers.delete(handler) }
  }
}
```

### 5.5 `IOfflineQueueStorage` — replay + offline buffer

```typescript
export interface OfflineQueuedEvent {
  id: string          // monotonic — used as Last-Event-ID
  event: string
  data: unknown
  emittedAt: Date
}

export interface IOfflineQueueStorage {
  /**
   * Append an event to a user's offline queue.
   * Implementations should enforce per-user retention (size + TTL).
   */
  append(userId: string, event: OfflineQueuedEvent): Promise<void>

  /**
   * Retrieve events with id > sinceId. Used for Last-Event-ID replay.
   * @param limit Maximum number of events to return.
   */
  retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]>

  /**
   * Mark events delivered (optional — implementations may purge or keep for audit).
   */
  acknowledge(userId: string, upToId: string): Promise<void>
}
```

### 5.6 `IPresenceStorage` — who is online (optional)

```typescript
export interface IPresenceStorage {
  setOnline(userId: string, connectionId: string, tenantId?: string): Promise<void>
  setOffline(userId: string, connectionId: string): Promise<void>
  isOnline(userId: string): Promise<boolean>
  listOnlineByTenant(tenantId: string): Promise<string[]>
  countOnline(): Promise<number>
}
```

---

## 6. Transports

### 6.1 `SseTransport` — default

The SSE implementation uses the native NestJS `@Sse()` decorator, which accepts a method returning `Observable<MessageEvent>`. To support programmatic server-side emits, we create one RxJS `Subject` per connection.

> **Heartbeat is a true SSE comment, not a `MessageEvent`.** NestJS's `@Sse()` serializes every `MessageEvent` into `event:`/`id:`/`data:` lines and **cannot emit a `:`-comment line**; a `MessageEvent` with empty `data` is also discarded by the browser per the WHATWG SSE dispatch algorithm and would still consume an auto-assigned event id that the browser would echo as `Last-Event-ID` (corrupting replay). Therefore the `: keepalive\n\n` keepalive is written **directly to the response stream** by `HeartbeatService` on an interval — it stays out of the `MessageEvent` Observable and out of the event-id space. This is why `HeartbeatService` is a distinct component and why `heartbeat` is **not** a reserved named event (see §13).

#### Controller skeleton

```typescript
import { Controller, Sse, Req, Res, MessageEvent, UnauthorizedException } from '@nestjs/common'
import { Observable, Subject, merge, takeUntil, finalize } from 'rxjs'
import { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

@Controller()
export class SseController {
  constructor(
    private readonly transport: SseTransport,
    private readonly heartbeat: HeartbeatService,
    private readonly opts: BymaxRealtimeModuleOptions,
  ) {}

  // `passthrough: true` keeps NestJS in control of the SSE response while still
  // giving HeartbeatService a handle to write raw `: keepalive` comments to it.
  @Sse('events')
  async subscribe(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Observable<MessageEvent>> {
    // 1. Authenticate
    const auth = await this.transport.authenticate(req)
    if (!auth) {
      throw new UnauthorizedException()
    }

    // 2. Resolve Last-Event-ID for replay (browser resends it as a header on reconnect)
    const lastEventId = req.headers['last-event-id'] as string | undefined

    // 3. Create per-connection Subject + a close subject, then register the connection
    const connectionId = randomUUID()
    const subject = new Subject<MessageEvent>()
    const close$ = new Subject<void>()   // server-initiated teardown (disconnect/revocation)
    await this.transport.registerConnection({
      connectionId,
      userId: auth.userId,
      tenantId: auth.tenantId,
      subject,
      close$,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })

    // 4. Replay missed events if Last-Event-ID provided
    const replayStream = lastEventId
      ? this.transport.buildReplayStream(auth.userId, lastEventId)
      : new Observable<MessageEvent>((s) => s.complete())

    // 5. Heartbeat — raw `: keepalive\n\n` comment written to the response stream (NOT a MessageEvent)
    this.heartbeat.start(connectionId, res, this.opts.sse?.heartbeatMs ?? 30_000)

    // 6. Stream = replay + live events; torn down by close$ (server-initiated) or client closing the HTTP request
    return merge(replayStream, subject.asObservable()).pipe(
      takeUntil(close$),
      finalize(() => {
        this.heartbeat.stop(connectionId)
        void this.transport.unregisterConnection(connectionId)
      }),
    )
  }
}
```

> **Teardown correctness.** Server-initiated `disconnect()` calls `close$.next()` (then `close$.complete()`); `takeUntil(close$)` completes the merged stream, `finalize()` clears the heartbeat interval and unregisters the connection. Completing only the live `subject` is **not** relied upon for server-initiated closes — `takeUntil` fires on an emitted value. Client-initiated closes (browser navigates away) complete the HTTP request, which also triggers `finalize()`.

#### Transport implementation

```typescript
@Injectable()
export class SseTransport implements ITransport {
  readonly kind = 'sse' as const

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
    private readonly replayBuffer: EventReplayBuffer,
    private readonly idGen: EventIdGenerator,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
  ) {}

  // Wire the cross-instance subscriber once. Remote messages dispatch to the
  // LOCAL-ONLY methods so a received message is delivered exactly once and is
  // never re-published (which would ping-pong between instances unboundedly).
  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.pubsub.subscribe((m: RealtimePubSubMessage) => {
      switch (m.op) {
        case 'emitToUser':   { const a = m.args as EmitArgs; this.emitToUserLocal(a.userId, a.event, a.data, a.id); break }
        case 'emitToTenant': { const a = m.args as EmitArgs; this.emitToTenantLocal(a.tenantId!, a.event, a.data, a.id); break }
        case 'emitToRoom':   { const a = m.args as EmitArgs; this.emitToRoomLocal(a.roomId!, a.event, a.data, a.id); break }
        case 'broadcast':    { const a = m.args as EmitArgs; this.broadcastLocal(a.event, a.data, a.id); break }
        case 'disconnect':   { const a = m.args as { connectionId: string; reason?: string }; this.disconnectLocal(a.connectionId, a.reason); break }
      }
    })
  }

  async onApplicationShutdown(): Promise<void> {
    await this.unsubscribe?.()
    for (const conn of this.connections.allByTransport('sse')) conn.close$.next()
  }

  // ---- Public API: local delivery + a SINGLE publish ----

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    const id = this.idGen.next()
    this.emitToUserLocal(userId, event, data, id)
    await this.pubsub.publish({ op: 'emitToUser', args: { userId, event, data, id }, origin: '' })
  }
  // emitToTenant / emitToRoom / broadcast are identical in shape:
  //   generate id → call the matching *Local method → publish ONCE.

  // ---- Local-only path: NO publish. Called by the subscriber and by the public methods. ----

  emitToUserLocal(userId: string, event: string, data: unknown, id: string): void {
    const msg: MessageEvent = { id, type: event, data: data as object }
    this.replayBuffer.append(userId, msg)
    for (const conn of this.connections.byUser(userId, 'sse')) conn.subject.next(msg)
  }
  // emitToTenantLocal / emitToRoomLocal / broadcastLocal: same body, different lookup
  // (byTenant / rooms.members / allByTransport) — none of them call this.pubsub.publish.

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.join(connectionId, roomId)
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.leave(connectionId, roomId)
  }

  // Force-close a connection. If it is owned by THIS instance, close locally;
  // otherwise publish op:'disconnect' so the owning instance closes it — this is
  // what makes §8.4 instant cross-instance revocation actually work.
  async disconnect(connectionId: string, reason?: string): Promise<void> {
    const conn = this.connections.get(connectionId)
    if (conn && conn.transport === 'sse') {
      this.disconnectLocal(connectionId, reason)
      return
    }
    await this.pubsub.publish({ op: 'disconnect', args: { connectionId, reason }, origin: '' })
  }

  // Local-only close (no re-publish — a relaying receiver must not re-broadcast).
  disconnectLocal(connectionId: string, reason?: string): void {
    const conn = this.connections.get(connectionId)
    if (!conn || conn.transport !== 'sse') return
    conn.close$.next()       // tears down the @Sse stream via takeUntil
    conn.close$.complete()
    this.connections.unregister(connectionId)
  }

  buildReplayStream(userId: string, lastEventId: string): Observable<MessageEvent> {
    const missed = this.replayBuffer.since(userId, lastEventId)
    return new Observable<MessageEvent>((subscriber) => {
      for (const msg of missed) subscriber.next(msg)
      subscriber.complete()
    })
  }
}
```

> **Why a local-only path is mandatory.** Each public `emitTo*` does local delivery **and** publishes once. The subscriber dispatches remote messages to the `*Local` methods only — never back into a publishing `emitTo*`. Without this split, a received message would be re-published with the receiver's `origin`, which the originator would re-process and re-publish, etc. The `origin === instanceId` self-filter (§5.4) only stops an instance from re-processing its **own** message; it does **not** stop the A→B→A relay loop. The `op:'disconnect'` path is the producer that §8.4's cross-instance revocation guarantee depends on.

#### Event format on the wire (SSE)

```
id: 1717000000-001
event: invoice.paid
data: {"id":"inv_123","amount":9900,"currency":"brl"}

id: 1717000000-002
event: invoice.refunded
data: {"id":"inv_123","refundId":"re_456"}

: keepalive

id: 1717000000-003
event: webhook.dlq
data: {"webhookId":"wh_789","reason":"timeout"}

```

A blank line separates events. `:` at the start is a comment (the heartbeat) — invisible to `EventSource`, so it carries no `id:` and never appears as a named event.

> **Transport helper methods** (called by the controller/gateway, omitted from the skeletons above for brevity): `SseTransport` also exposes `authenticate(req)` (delegates to the injected `IConnectionAuthenticator` with a built `ConnectionAuthContext`), `registerConnection(meta)`, and `unregisterConnection(connectionId)`; `WebSocketTransport` exposes `registerSocket(socket, auth)` and `unregisterSocket(socketId)`. The class also holds a private `unsubscribe?: () => Promise<void>` returned by `pubsub.subscribe`.

### 6.2 `WebSocketTransport` — opt-in

Canonical implementation uses Socket.IO via `@nestjs/platform-socket.io`.

```typescript
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

// NOTE: `@WebSocketGateway()` is evaluated at class-definition time, so a
// config-driven namespace cannot be passed as a decorator argument. The lib
// applies the configured `websocket.namespace` through a custom `IoAdapter`
// (which also extracts cookies/auth at the handshake), not via this decorator.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  constructor(
    private readonly transport: WebSocketTransport,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
  ) {}

  async handleConnection(socket: Socket) {
    const ctx = {
      cookies: parseCookieHeader(socket.handshake.headers.cookie ?? ''),
      headers: socket.handshake.headers,
      query: socket.handshake.query as Record<string, string>,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      transport: 'websocket' as const,
    }
    const auth = await this.auth.authenticate(ctx)
    if (!auth) {
      socket.disconnect(true)
      return
    }

    await this.transport.registerSocket(socket, auth)
    await socket.join(`user:${auth.userId}`)
    if (auth.tenantId) await socket.join(`tenant:${auth.tenantId}`)

    // Emit only client-safe traits — never the whole AuthenticationResult, whose
    // `metadata` (and possibly `roles`) may carry server-only data (§5.2).
    socket.emit('connection:established', {
      connectionId: socket.id,
      traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
    })
  }

  async handleDisconnect(socket: Socket) {
    await this.transport.unregisterSocket(socket.id)
  }
}
```

```typescript
@Injectable()
export class WebSocketTransport implements ITransport {
  readonly kind = 'websocket' as const
  private server!: Server

  setServer(server: Server) { this.server = server }

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    this.server.to(`user:${userId}`).emit(event, data)
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    this.server.to(`tenant:${tenantId}`).emit(event, data)
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    this.server.to(roomId).emit(event, data)
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    this.server.emit(event, data)
  }

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server.sockets.sockets.get(connectionId)
    if (socket) await socket.join(roomId)
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server.sockets.sockets.get(connectionId)
    if (socket) await socket.leave(roomId)
  }

  async disconnect(connectionId: string, reason?: string): Promise<void> {
    // Use the adapter-aware API so a socket connected to ANOTHER node is also
    // closed (the @socket.io/redis-adapter broadcasts disconnectSockets to all
    // servers). A local `this.server.sockets.sockets.get(id)` lookup would only
    // close sockets on this node — breaking cross-instance revocation (§8.4).
    this.server.in(connectionId).disconnectSockets(true)
  }
}
```

> **Redis adapter** for WS scaling: `@socket.io/redis-adapter` is registered automatically when `websocket.redisAdapter.pubClient` is provided in config. The lib calls `pubClient.duplicate()` for the subscriber.

### 6.3 `CompositeTransport` — mode `'both'`

```typescript
@Injectable()
export class CompositeTransport implements ITransport {
  // `ITransport.kind` is the per-transport mechanism id ('sse' | 'websocket'),
  // distinct from the module-level `TransportMode` ('sse' | 'websocket' | 'both').
  // The composite reports the dominant transport so it satisfies ITransport under strict mode.
  readonly kind = 'sse' as const

  constructor(
    private readonly sse: SseTransport,
    private readonly ws: WebSocketTransport,
  ) {}

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    await Promise.all([
      this.sse.emitToUser(userId, event, data),
      this.ws.emitToUser(userId, event, data),
    ])
  }

  // ... identical for tenant, room, broadcast
  // joinRoom / leaveRoom delegate to the corresponding connection's transport
}
```

> In `'both'` mode, **both endpoints exist simultaneously** (HTTP `/events` + WS `/socket.io`). The client connects to whichever it prefers. Server-side emits reach both.

---

## 7. Services

### 7.1 `RealtimeService` — unified public API

```typescript
@Injectable()
export class RealtimeService {
  constructor(@Inject(REALTIME_TRANSPORT_TOKEN) private readonly transport: ITransport) {}

  /**
   * Send to all connections of a single user (across all their devices/tabs).
   *
   * @example
   *   await realtime.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
   */
  emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToUser(userId, event, data)
  }

  /**
   * Send to all connections in a tenant (every user in that tenant).
   *
   * @example
   *   await realtime.emitToTenant('t_acme', 'plan.upgraded', { plan: 'pro' })
   */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToTenant(tenantId, event, data)
  }

  /**
   * Send to a logical room. Use prefixed naming convention:
   *   - 'user:{id}'         single user
   *   - 'tenant:{id}'       tenant-wide
   *   - 'resource:{type}:{id}'  per-resource (e.g., 'resource:invoice:inv_123')
   *
   * @example
   *   await realtime.emitToRoom('resource:invoice:inv_123', 'invoice.updated', { ... })
   */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToRoom(roomId, event, data)
  }

  /**
   * Send to all connected clients. Use sparingly.
   */
  broadcast(event: string, data: unknown): Promise<void> {
    return this.transport.broadcast(event, data)
  }

  /**
   * Join a specific connection to a room.
   */
  joinRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.joinRoom(connectionId, roomId)
  }

  /**
   * Remove a connection from a room.
   */
  leaveRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.leaveRoom(connectionId, roomId)
  }

  /**
   * Force-disconnect a specific connection (e.g., on auth revocation).
   */
  disconnect(connectionId: string, reason?: string): Promise<void> {
    return this.transport.disconnect(connectionId, reason)
  }
}
```

### 7.2 `ConnectionRegistry` (internal)

```typescript
// Internal, subject-bearing record (distinct from the public, zero-dep
// `ConnectionMeta` exported from `./shared`, which carries no RxJS types).
interface InternalConnection {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: 'sse' | 'websocket'
  ip: string
  userAgent: string | undefined
  connectedAt: Date
  /** The auth result captured at register time — needed by periodic revalidate(). */
  originalAuth: AuthenticationResult
  /** Per-conn event subject (SSE only); null for WebSocket. */
  subject: Subject<MessageEvent> | null
  /** Per-conn close signal (SSE only) — `disconnect()` calls `close$.next()`; null for WebSocket. */
  close$: Subject<void> | null
}

@Injectable()
export class ConnectionRegistry {
  private byId = new Map<string, InternalConnection>()
  private byUserId = new Map<string, Set<string>>()   // userId → Set<connectionId>
  private byTenantId = new Map<string, Set<string>>() // tenantId → Set<connectionId>

  register(conn: InternalConnection): void { ... }
  unregister(connectionId: string): void { ... }
  get(connectionId: string): InternalConnection | undefined { ... }
  byUser(userId: string, transport?: 'sse' | 'websocket'): InternalConnection[] { ... }
  byTenant(tenantId: string, transport?: 'sse' | 'websocket'): InternalConnection[] { ... }
  allByTransport(transport: 'sse' | 'websocket'): InternalConnection[] { ... }
  count(): number { ... }
}
```

### 7.3 `RoomRegistry` (internal)

```typescript
@Injectable()
export class RoomRegistry {
  private rooms = new Map<string, Set<string>>()      // roomId → Set<connectionId>
  private connectionRooms = new Map<string, Set<string>>()  // connectionId → Set<roomId>

  join(connectionId: string, roomId: string): void { ... }
  leave(connectionId: string, roomId: string): void { ... }
  members(roomId: string): readonly string[] { ... }
  leaveAll(connectionId: string): void { ... }  // on disconnect
}
```

### 7.4 `EventReplayBuffer` (internal, SSE)

```typescript
@Injectable()
export class EventReplayBuffer {
  private buffers = new Map<string, MessageEvent[]>()  // userId → ring buffer

  // The options token MUST be injected, otherwise `this.opts` is undefined and
  // the first append() throws a TypeError reading `this.opts.sse`.
  constructor(@Inject(REALTIME_OPTIONS_TOKEN) private readonly opts: BymaxRealtimeModuleOptions) {}

  append(userId: string, event: MessageEvent): void {
    const buf = this.buffers.get(userId) ?? []
    buf.push(event)
    // Parenthesize the default: relational `>` binds tighter than `??`, so
    // `buf.length > this.opts.sse?.replayBufferSize ?? 100` would parse as
    // `(buf.length > x) ?? 100` — a boolean — leaving the buffer unbounded.
    const cap = this.opts.sse?.replayBufferSize ?? 100
    if (buf.length > cap) buf.shift()
    this.buffers.set(userId, buf)
  }

  since(userId: string, lastEventId: string): MessageEvent[] {
    const buf = this.buffers.get(userId) ?? []
    const idx = buf.findIndex((e) => e.id === lastEventId)
    return idx === -1 ? [] : buf.slice(idx + 1)
  }
}
```

> For retention beyond in-memory (e.g., a user offline for hours), the consumer plugs in `IOfflineQueueStorage` (Redis-backed). The lib consults the in-memory buffer first; falls back to the storage if `lastEventId` is not in the buffer.

### 7.5 Lifecycle decorators (`@OnConnect` / `@OnDisconnect` / `@Subscribe`)

These are an ergonomic, **method-level** alternative to the config-based `IConnectionLifecycleHooks`:

| Decorator | Sets metadata consumed by | Purpose |
|---|---|---|
| `@OnConnect()` | the module's connection dispatcher | Marks a provider method to run after a connection authenticates (same timing as `hooks.onConnect`). |
| `@OnDisconnect()` | the module's connection dispatcher | Marks a method to run on disconnect (same timing as `hooks.onDisconnect`). |
| `@Subscribe('event')` | `RealtimeGateway` (**WebSocket only**) | Registers a handler for a client→server event. No-op under SSE (SSE is server→client only). |

Both mechanisms can coexist; the config hooks fire first. Prefer the config hooks for cross-cutting concerns (audit, metrics) and the decorators for feature-local handlers. `@Subscribe` has no effect when `transport: 'sse'`.

---

## 8. Authentication Strategy

### 8.1 Three supported patterns

#### Pattern A — HttpOnly Cookie (recommended, plug-and-play with nest-auth)

```typescript
const eventSource = new EventSource('/events', { withCredentials: true })
```

The HttpOnly `access_token` cookie set by nest-auth during normal login automatically accompanies the handshake. **No extra frontend code required.**

#### Pattern B — Ticket (clients without cookies / strict cross-origin)

```typescript
// Frontend
const { ticket } = await fetch('/events/ticket', { credentials: 'include' }).then(r => r.json())
const eventSource = new EventSource(`/events?ticket=${ticket}`)
```

```typescript
// Backend
@Controller()
export class EventsTicketController {
  constructor(private readonly redis: Redis, private readonly jwt: JwtService) {}

  @Post('events/ticket')
  @UseGuards(JwtAuthGuard)  // requires normal login
  async issueTicket(@Req() req: AuthenticatedRequest): Promise<{ ticket: string }> {
    const ticket = randomUUID()
    await this.redis.set(
      `realtime:ticket:${ticket}`,
      JSON.stringify({ userId: req.user.id, tenantId: req.user.tenantId }),
      'EX', 60,  // 60s to use
    )
    return { ticket }
  }
}
```

#### Pattern C — Bearer header (WebSocket only — `EventSource` does not support custom headers)

```typescript
const socket = io(url, { auth: { token: 'eyJ...' } })
```

The authenticator extracts from `socket.handshake.auth.token` instead of cookie.

### 8.2 Pattern comparison

| Pattern | Use case | Pros | Cons |
|---|---|---|---|
| A — HttpOnly Cookie | Web app on same domain or subdomain | Zero frontend code | Strict cross-origin without CORS + credentials |
| B — Ticket | Strict cross-origin, native mobile | Works in any client | Requires extra endpoint to issue the ticket |
| C — Bearer header | WS only, headless clients | API standard | Does not work in SSE (browser strips headers) |

### 8.3 Periodic re-authentication

SSE/WS connections are long-lived. The token may expire/be revoked during the session. `reauthenticationPolicy.intervalSeconds` (default 5 min) performs periodic checks:

```typescript
// Internally in the transport (illustrative). `policy` is the resolved
// `reauthenticationPolicy` from options; `this.hooks` is the optional
// `IConnectionLifecycleHooks` injected via `REALTIME_HOOKS_TOKEN`.
setInterval(async () => {
  for (const conn of this.connections.allByTransport(this.kind)) {
    const stillValid = await this.auth.revalidate?.(conn.connectionId, conn.originalAuth) ?? true
    if (!stillValid) {
      if (policy.onFailure === 'event') {
        await this.emitToUser(conn.userId, 'connection:reauthentication-failed', {})
      }
      await this.disconnect(conn.connectionId, 'REAUTHENTICATION_FAILED')
      this.hooks?.onReauthenticationFailed?.(conn)
    }
  }
}, policy.intervalSeconds * 1000)
```

### 8.4 Instant revocation

To immediately revoke a connection (e.g., logout on another device, administrative ban):

```typescript
// Application service calls:
await realtimeService.disconnect(connectionId, 'USER_LOGGED_OUT')
```

In a multi-instance environment, if the connection is not owned by the instance handling the call, the close is fanned out cross-instance:
- **SSE:** `disconnect()` publishes `{ op: 'disconnect', args: { connectionId, reason } }` on `IRealtimePubSub`; the owning instance's subscriber invokes `disconnectLocal()` (a non-publishing close — see §6.1). This `op:'disconnect'` producer/consumer is what makes this guarantee real.
- **WebSocket:** `disconnect()` calls `this.server.in(connectionId).disconnectSockets(true)`, which `@socket.io/redis-adapter` broadcasts to all nodes (no separate pub/sub op needed).

---

## 9. Rooms and Multi-tenant

### 9.1 Room ID convention

```
user:{userId}                       - user's connection room
tenant:{tenantId}                   - entire tenant room
resource:{type}:{id}                - per-resource room (e.g., resource:invoice:inv_123)
{custom}                            - allowed, outside the reserved prefixes
```

Constants exported in `./shared`:

```typescript
export const ROOM_PREFIXES = {
  USER: 'user',
  TENANT: 'tenant',
  RESOURCE: 'resource',
} as const

// Helper
export function composeRoomId(prefix: keyof typeof ROOM_PREFIXES, ...parts: string[]): string {
  return [ROOM_PREFIXES[prefix], ...parts].join(':')
}

// Usage:
composeRoomId('RESOURCE', 'invoice', 'inv_123')  // → 'resource:invoice:inv_123'
```

### 9.2 Automatic rooms

On connect (any transport), the lib auto-adds the connection to:
- `user:{userId}` — always
- `tenant:{tenantId}` — if `auth.tenantId` resolved

Custom rooms must be explicitly `joinRoom`-ed.

### 9.3 Multi-tenant in SSE

SSE has no native "namespaces" (as Socket.IO does). The lib simulates them via:
- Every SSE connection joins `tenant:{tenantId}` on connect
- `emitToTenant(tenantId, ...)` iterates the connections in that room
- Cross-tenant isolation is enforced **server-side** by the authenticator (each connection has a validated, fixed `tenantId` in metadata)

### 9.4 Multi-tenant in WebSocket

Socket.IO offers two mechanisms:
- **Namespaces** (recommended): different URL per tenant (`/tenant-{id}`) — total isolation, separate event handlers
- **Rooms**: within a single namespace, logical segregation via `socket.join('tenant:{id}')`

For simplicity and parity with SSE, the **default uses Rooms** inside the `/` namespace. The consumer can force per-tenant namespaces via `websocket.namespace` + dynamic creation helpers.

### 9.5 Anti-IDOR — protection against improper cross-tenant emit

The lib **does not validate** that the `tenantId` passed to `emitToTenant` matches the caller's tenant. That is the application code's responsibility. Recommendation:

```typescript
// Use case service:
@Injectable()
export class InvoiceService {
  constructor(private readonly realtime: RealtimeService) {}

  async markPaid(invoiceId: string, currentTenantId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (invoice.tenantId !== currentTenantId) throw new ForbiddenException()

    // ...

    // ✅ Emit uses validated tenantId
    await this.realtime.emitToTenant(currentTenantId, 'invoice.paid', { id: invoiceId })
  }
}
```

---

## 10. Replay and Offline Queue

### 10.1 `Last-Event-ID` (SSE — native protocol)

When the browser loses the SSE connection and automatically reconnects, it sends the `Last-Event-ID: <id>` header with the last `id:` received. The server:

```
1. Browser EventSource: connection drops
2. Browser auto-reconnect (default 3s)
3. GET /events request with Last-Event-ID: 1717000000-005
4. SseController.subscribe():
   - authenticates
   - calls transport.buildReplayStream(userId, '1717000000-005')
   - looks up in EventReplayBuffer (in-memory)
   - if sinceId is not in the buffer (gap), looks up in IOfflineQueueStorage
   - replay sends events with id > 1717000000-005 before new events
```

### 10.2 Offline queue (both transports)

For offline users (not connected when the event was emitted), `IOfflineQueueStorage` retains events to deliver on the next connect. The snippet below is **illustrative** — the canonical, fully-wired path (transport filter, replay-buffer append, single pub/sub publish) is §6.1; `offlineQueue` here is the optional `IOfflineQueueStorage` injected via `REALTIME_OFFLINE_QUEUE_TOKEN`:

```typescript
// Illustrative augmentation of the §6.1 emit path — see §6.1 for the canonical implementation.
async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
  const msg: MessageEvent = { id: this.idGen.next(), type: event, data: data as object }

  // 1. Emit live to this user's SSE connections (transport-filtered, as in §6.1)
  const connected = this.connections.byUser(userId, 'sse')
  for (const conn of connected) conn.subject.next(msg)

  // 2. If user has 0 connections AND offline queue is configured, persist
  if (connected.length === 0 && this.offlineQueue) {
    await this.offlineQueue.append(userId, { id: msg.id, event, data, emittedAt: new Date() })
  }
}
```

On the next connect, without `Last-Event-ID`, the lib consults the offline queue:

```typescript
// SseController.subscribe — after auth, before subscription:
if (!lastEventId && this.offlineQueue) {
  const pendingSince = req.headers['x-offline-since'] as string | undefined  // app-level convention
  if (pendingSince) {
    const pending = await this.offlineQueue.retrieveSince(auth.userId, pendingSince, 100)
    replayStream = of(...pending.map(toMessageEvent))
  }
}
```

### 10.3 Redis-backed implementation (reference)

```typescript
import Redis from 'ioredis'
import { IOfflineQueueStorage, OfflineQueuedEvent } from '@bymax-one/nest-realtime'

export class RedisOfflineQueue implements IOfflineQueueStorage {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { ttlSeconds: number; maxPerUser?: number } = { ttlSeconds: 86400 },
  ) {}

  async append(userId: string, event: OfflineQueuedEvent): Promise<void> {
    const key = `realtime:offline:${userId}`
    await this.redis.zadd(key, Date.now(), JSON.stringify(event))
    await this.redis.expire(key, this.opts.ttlSeconds)
    if (this.opts.maxPerUser) {
      // Trim oldest if exceeded
      await this.redis.zremrangebyrank(key, 0, -(this.opts.maxPerUser + 1))
    }
  }

  async retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]> {
    const key = `realtime:offline:${userId}`
    const raws = await this.redis.zrange(key, 0, -1)
    return raws
      .map((r) => JSON.parse(r) as OfflineQueuedEvent)
      .filter((e) => e.id > sinceId)
      .slice(0, limit)
  }

  async acknowledge(userId: string, upToId: string): Promise<void> {
    const key = `realtime:offline:${userId}`
    const raws = await this.redis.zrange(key, 0, -1)
    const toRemove = raws.filter((r) => {
      const e = JSON.parse(r) as OfflineQueuedEvent
      return e.id <= upToId
    })
    if (toRemove.length) await this.redis.zrem(key, ...toRemove)
  }
}
```

> **Event-id ordering invariant.** Both the in-memory `EventReplayBuffer.since()` and this Redis queue's `retrieveSince()` compare ids as **strings** (`e.id > sinceId`). For that to be correct, `EventIdGenerator` must emit **lexicographically-orderable, fixed-width** ids (e.g. a zero-padded monotonic counter, optionally prefixed with a fixed-width timestamp — `1717000000-000001`). Variable-width ids (`...-1` vs `...-10`) would sort incorrectly and silently break replay. The same comparison is used in §7.4 and here — keep them identical.

---

## 11. Horizontal Scalability

### 11.1 Why we need it

The app runs on ≥ 2 instances. A user with 2 tabs: tab A connected to instance #1, tab B connected to instance #2. The application service runs on instance #1 and calls `realtime.emitToUser('u_abc', 'invoice.paid', {...})`. Without cross-instance pub/sub, **only tab A receives**. Pub/sub fixes that.

### 11.2 Flow with pub/sub

```
Instance #1                              Instance #2
   │                                         │
   │  service.emit(...)                      │
   │       │                                 │
   │       ▼                                 │
   │  SseTransport.emitToUser                │
   │       │                                 │
   │       ├─ emit local (tab A)             │
   │       │                                 │
   │       └─► IRealtimePubSub.publish ──┐   │
   │                                     │   │
   │                                     ▼   │
   │                       Redis pub/sub channel
   │                                     │   │
   │                                     │   ▼
   │                                     │   IRealtimePubSub subscriber
   │                                     │   │
   │                                     │   ▼
   │                                     │   SseTransport.emitToUser (local only)
   │                                     │   │
   │                                     │   ▼
   │                                     │   emit local (tab B) ✓
```

### 11.3 For SSE — custom `IRealtimePubSub` (Redis recommended)

The lib **does not** depend on `ioredis` directly. The consumer implements `IRealtimePubSub` (usually over Redis pub/sub) and injects it via config. Reference implementation in §5.4.

### 11.4 For WebSocket — `@socket.io/redis-adapter` (official)

For the WS transport, the lib can use the official adapter instead of `IRealtimePubSub`:

```typescript
import { createAdapter } from '@socket.io/redis-adapter'

// Lib internally, when configuring Socket.IO:
if (opts.websocket?.redisAdapter) {
  const pubClient = opts.websocket.redisAdapter.pubClient
  const subClient = pubClient.duplicate()
  io.adapter(createAdapter(pubClient, subClient))
}
```

> In `'both'` mode, both mechanisms work: SSE via `IRealtimePubSub`, WS via Socket.IO Redis adapter. Each transport maintains independent scalability.

> ⚠️ **Sticky sessions are MANDATORY for horizontally-scaled WebSocket when the HTTP long-polling fallback is enabled** (`transports: ['websocket', 'polling']`, the Socket.IO default). The `@socket.io/redis-adapter` synchronizes **messages** across nodes, but it does **not** remove the load balancer's session-affinity requirement: a polling client performs several HTTP round-trips during the handshake, and every one of them MUST reach the same node, or the upgrade fails with `"Session ID unknown"` and the client loops on reconnect. This is the single most common real-world Socket.IO scaling failure. Mitigations: (a) enable session affinity / sticky sessions on the load balancer (e.g. AWS ALB target-group stickiness, nginx `ip_hash`, an affinity cookie), or (b) set `transports: ['websocket']` to disable the polling fallback entirely (loses the fallback, but removes the affinity requirement because a raw WebSocket is a single long-lived connection). SSE is unaffected — it is a single long-lived HTTP request and needs no affinity. See §18.9 and Appendix C.3.

### 11.5 Sticky sessions vs the Redis adapter — what each one does

| Concern | `@socket.io/redis-adapter` | Sticky sessions (load balancer) |
|---|---|---|
| Cross-node message fan-out (emit on node A reaches a client on node B) | ✅ Provides this | ❌ Does not address |
| Polling-handshake affinity (multi-round-trip handshake hits one node) | ❌ Does **not** provide this | ✅ Required for this |

You need **both** for a scaled WebSocket deployment with polling fallback. The adapter is not a substitute for affinity, and affinity is not a substitute for the adapter.

### 11.6 Integration with `@bymax-one/nest-cache`

The lib does NOT import `@bymax-one/nest-cache` directly. But the recommended standard is for the consumer to reuse the same Redis client:

```typescript
BymaxRealtimeModule.forRootAsync({
  imports: [CacheModule],          // @bymax-one/nest-cache
  inject: [CACHE_REDIS_CLIENT_TOKEN],
  useFactory: (redis: Redis) => ({
    transport: 'both',
    authenticator: new MyAuthenticator(),
    pubsub: new RedisRealtimePubSub(redis),
    websocket: { redisAdapter: { pubClient: redis } },
    offlineQueue: new RedisOfflineQueue(redis, { ttlSeconds: 86400 }),
  }),
})
```

---

## 12. Frontend Integration

### 12.1 Universal `useRealtime` hook

```typescript
export interface UseRealtimeOptions<TEvents extends Record<string, unknown>> {
  /**
   * Connection URL.
   * - `http(s)://...` → uses SSE (EventSource)
   * - `ws(s)://...`   → uses WebSocket (socket.io-client, dynamically imported)
   */
  url: string

  /**
   * Optional explicit transport override. Useful for path-only URLs or
   * advanced configs (e.g., subprotocols).
   * @default auto-detect from URL scheme
   */
  transport?: 'sse' | 'websocket'

  /**
   * Event handlers keyed by event name.
   */
  events: { [K in keyof TEvents]?: (data: TEvents[K]) => void }

  /**
   * Auth context for ticket-style flows. Default: rely on cookies (SSE) or socket.io auth (WS).
   */
  auth?: {
    /** Function to fetch a fresh ticket. Called on connect and reconnect. */
    fetchTicket?: () => Promise<string>
  }

  /**
   * Reconnection tuning.
   */
  reconnect?: {
    /** Backoff in ms. @default 3000 */
    initialDelayMs?: number
    /** Maximum backoff. @default 30000 */
    maxDelayMs?: number
    /** Maximum attempts before giving up. @default Infinity */
    maxAttempts?: number
  }

  /**
   * Whether to connect immediately on mount. @default true
   */
  autoConnect?: boolean
}

export interface UseRealtimeReturn {
  /** Connection state. */
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'
  /** Last received event (any type). */
  lastEvent: { type: string; data: unknown; id?: string } | null
  /** Number of reconnection attempts so far. */
  reconnectAttempts: number
  /** Manual control. */
  connect(): void
  disconnect(): void
}

export function useRealtime<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeOptions<TEvents>,
): UseRealtimeReturn { ... }
```

### 12.2 Internal implementation — SSE via `EventSource`

```typescript
function useSseInternal(opts: ResolvedSseOptions): UseRealtimeReturn {
  const [status, setStatus] = useState<Status>('idle')
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!opts.autoConnect) return

    let cancelled = false
    let attempts = 0

    const connect = async () => {
      if (cancelled) return
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting')

      // Optional ticket flow
      let url = opts.url
      if (opts.auth?.fetchTicket) {
        const ticket = await opts.auth.fetchTicket()
        const sep = url.includes('?') ? '&' : '?'
        url = `${url}${sep}ticket=${encodeURIComponent(ticket)}`
      }

      const es = new EventSource(url, { withCredentials: true })
      sourceRef.current = es

      es.onopen = () => {
        setStatus('connected')
        attempts = 0
      }

      // Listen to named events
      for (const event of Object.keys(opts.events)) {
        es.addEventListener(event, (e: MessageEvent) => {
          const parsed = JSON.parse(e.data) as unknown
          setLastEvent({ type: event, data: parsed, id: e.lastEventId })
          opts.events[event]?.(parsed as never)
        })
      }

      // Default 'message' event
      es.onmessage = (e) => {
        setLastEvent({ type: 'message', data: JSON.parse(e.data), id: e.lastEventId })
      }

      es.onerror = () => {
        es.close()
        attempts += 1
        if (attempts > (opts.reconnect?.maxAttempts ?? Infinity)) {
          setStatus('error')
          return
        }
        const delay = Math.min(
          (opts.reconnect?.initialDelayMs ?? 3000) * Math.pow(2, Math.min(attempts - 1, 5)),
          opts.reconnect?.maxDelayMs ?? 30_000,
        )
        setTimeout(() => void connect(), delay)
      }
    }

    void connect()

    return () => {
      cancelled = true
      sourceRef.current?.close()
    }
  }, [opts.url])

  // ...
}
```

> **Replay across reconnects.** The native `EventSource` auto-reconnects on *transient* drops and automatically resends the `Last-Event-ID` header — that is what drives server-side replay (§10.1). The manual `es.close()` + recreate path above should run **only for fatal errors** (e.g. a 401 that the browser will not retry); for transient errors, let the browser reconnect natively so the `Last-Event-ID` header is preserved. If you do close and recreate, track `e.lastEventId` and pass it back (e.g. as a query param the `SseController` also honors), or replay is lost.

### 12.3 Internal implementation — WebSocket (dynamic import)

```typescript
async function useWebSocketInternal(opts: ResolvedWsOptions): UseRealtimeReturn {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    let socket: any  // socket.io-client type — imported dynamically
    let cancelled = false

    const setup = async () => {
      const { io } = await import('socket.io-client')  // dynamic — bundle loads only here
      socket = io(opts.url, {
        withCredentials: true,
        // Polling fallback for WS-hostile networks. NOTE: if the server is
        // horizontally scaled, this REQUIRES load-balancer sticky sessions
        // (§18.9). Use ['websocket'] only to drop the fallback + affinity need.
        transports: ['websocket', 'polling'],
      })

      socket.on('connect', () => setStatus('connected'))
      socket.on('disconnect', () => setStatus('closed'))

      for (const event of Object.keys(opts.events)) {
        socket.on(event, opts.events[event])
      }
    }

    void setup()

    return () => {
      cancelled = true
      socket?.disconnect()
    }
  }, [opts.url])

  // ...
}
```

### 12.4 Automatic transport detection

```typescript
function detectTransport(url: string, override?: 'sse' | 'websocket'): 'sse' | 'websocket' {
  if (override) return override
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'websocket'
  if (url.startsWith('http://') || url.startsWith('https://')) return 'sse'
  // Path-only — assume same-origin SSE
  return 'sse'
}
```

### 12.5 Usage example (React 19)

```typescript
import { useRealtime } from '@bymax-one/nest-realtime/react'

interface MyEvents {
  'invoice.paid': { id: string; amount: number }
  'webhook.dlq': { webhookId: string; reason: string }
}

export function DashboardPage() {
  const { status, lastEvent } = useRealtime<MyEvents>({
    url: '/api/events',  // → SSE
    events: {
      'invoice.paid': (data) => toast.success(`Invoice ${data.id} paid R$ ${data.amount / 100}`),
      'webhook.dlq': (data) => toast.error(`Webhook ${data.webhookId} failed: ${data.reason}`),
    },
  })

  return (
    <header>
      <ConnectionBadge status={status} />
      {/* ... */}
    </header>
  )
}
```

### 12.6 `RealtimeProvider` for use across multiple hooks

```typescript
import { RealtimeProvider, useRealtime, usePresence } from '@bymax-one/nest-realtime/react'

function App() {
  return (
    <RealtimeProvider url="/api/events">
      <DashboardPage />     {/* uses useRealtime */}
      <PresenceIndicator /> {/* uses usePresence — shares the connection */}
    </RealtimeProvider>
  )
}
```

---

## 13. Standard Event Catalog

Canonical events reserved by the lib (do not use these names for custom events):

| Event | When | Payload | Direction |
|---|---|---|---|
| `connection:established` | After successful auth | `{ connectionId: string, traits: AuthenticationResult }` | server → client |
| `connection:reauthentication-failed` | Periodic re-auth failed | `{ reason: string }` | server → client (before disconnect) |
| `connection:credential-expiring` | _Reserved (not emitted in v0.1 — no expiry-detection mechanism yet)_ | `{ expiresAt: string }` | server → client |
| `room:joined` | _Reserved (not emitted in v0.1 — `joinRoom` does not yet emit it)_ | `{ roomId: string }` | server → client |
| `room:left` | _Reserved (not emitted in v0.1 — `leaveRoom` does not yet emit it)_ | `{ roomId: string }` | server → client |
| `error` | Transport error | `{ code: string, message: string }` | server → client |

> The SSE **heartbeat** is a `: keepalive` comment (§6.1), **not** a named event — it never reaches `addEventListener` and so is not listed here. Events marked _Reserved_ are names the lib owns (so consumers must not reuse them) but does not yet emit in v0.1; emitting `room:joined`/`room:left` from `joinRoom`/`leaveRoom` is a candidate for a later minor version. The `connection:reauthentication-failed` payload is `{ reason: string }` consistently in §8.3 and here.

In WebSocket, client → server reserved events:
- `ping` / `pong` — Socket.IO internal
- `disconnect` — Socket.IO internal

---

## 14. Error Code Catalog

| Code | When | HTTP / WS code |
|---|---|---|
| `REALTIME_INVALID_OPTIONS` | Malformed config at initialization | Throws |
| `REALTIME_NO_AUTHENTICATOR` | `authenticator` not provided | Throws |
| `REALTIME_AUTH_FAILED` | `authenticator.authenticate` returned null | 401 (SSE) / disconnect (WS) |
| `REALTIME_REAUTHENTICATION_FAILED` | Periodic re-check failed | Disconnect with reason |
| `REALTIME_TOO_MANY_CONNECTIONS` | User exceeded `maxConnectionsPerUser` → **oldest connection evicted (FIFO)** | Oldest SSE stream closed / WS socket disconnected with this reason (the **new** connection is admitted, never 429'd) |
| `REALTIME_INVALID_TICKET` | Ticket expired/used/non-existent | 401 — surfaced only if the authenticator distinguishes it; the §5.2 ticket example returns `null`, which maps to `REALTIME_AUTH_FAILED` |
| `REALTIME_PUBSUB_UNAVAILABLE` | Pub/sub configured but failed to connect | Warn log; lib degrades to single-instance |
| `REALTIME_PAYLOAD_TOO_LARGE` | Event exceeds `maxHttpBufferSize` | Dropped + log |
| `REALTIME_REPLAY_BUFFER_MISS` | `Last-Event-ID` not in the buffer (gap) | Replay via `IOfflineQueueStorage` if configured; otherwise the gap is unrecoverable and events before the buffer window are lost |

---

## 15. What is NOT in the package

- ❌ **IConnectionAuthenticator implementation** — consumer plugs (nest-auth bridge is an example in the docs, not in lib code)
- ❌ **Offline queue storage** — interface; consumer implements Redis/DynamoDB/etc
- ❌ **Presence storage** — interface; consumer implements
- ❌ **Redis pub/sub client** — `IRealtimePubSub` interface; consumer implements (example in §5.4)
- ❌ **Chat UI / notification inbox** — product concern
- ❌ **Event history persistence** — the lib is "fire-and-forget"; persistence stays with the app's event store
- ❌ **End-to-end encryption** — events go in cleartext inside the SSE/WS payload; use TLS at the transport layer
- ❌ **Server-side emit rate limiting** — separate concern (the lib does not block emits, only transports them)
- ❌ **Replay for messages beyond `replayBufferSize`** — without offline queue, messages are lost
- ❌ **Payload compression for SSE** — the lib does not compress SSE payloads, and you should **not** put HTTP body compression in front of the SSE route: `compression` middleware (and any buffering proxy) holds events instead of flushing them, breaking real-time delivery. Exclude `text/event-stream` from compression (or `res.flush()` after each event) and send `Cache-Control: no-cache, no-transform`. Note HTTP/2 does **not** compress bodies (HPACK compresses headers only), and nginx does not gzip `text/event-stream` by default. Socket.IO has its own `perMessageDeflate` (WebSocket frame compression), configurable directly. See Appendix C.1.
- ❌ **SockJS / other transport fallback support** — Socket.IO already provides native long-polling fallback

---

## 16. Dependencies

### 16.1 Required peer dependencies

```json
"peerDependencies": {
  "@nestjs/common": "^11.0.0",
  "@nestjs/core": "^11.0.0",
  "rxjs": "^7.8.0",
  "reflect-metadata": "^0.2.0"
}
```

### 16.2 Optional peer dependencies (per transport)

```json
"peerDependencies": {
  "@nestjs/websockets": "^11.0.0",
  "@nestjs/platform-socket.io": "^11.0.0",
  "socket.io": "^4.0.0",
  "@socket.io/redis-adapter": "^8.0.0",
  "ioredis": "^5.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "socket.io-client": "^4.0.0"
},
"peerDependenciesMeta": {
  "@nestjs/websockets": { "optional": true },
  "@nestjs/platform-socket.io": { "optional": true },
  "socket.io": { "optional": true },
  "@socket.io/redis-adapter": { "optional": true },
  "ioredis": { "optional": true },
  "react": { "optional": true },
  "react-dom": { "optional": true },
  "socket.io-client": { "optional": true }
}
```

| Package | When to install |
|---|---|
| `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io` | If `transport: 'websocket' \| 'both'` |
| `@socket.io/redis-adapter` + `ioredis` | For horizontal WS scaling |
| `ioredis` | When implementing Redis-backed `IRealtimePubSub` or `IOfflineQueueStorage` |
| `react`, `react-dom` | When using the `./react` subpath |
| `socket.io-client` | Frontend using WS transport |

### 16.3 `"dependencies": {}`

Zero direct dependencies. Everything via peer.

### 16.4 DevDependencies

The canonical `@bymax-one/*` devDependencies set, identical to the sibling libs (`nest-logger`, `nest-cache`, `nest-notification`): NestJS testing utilities, Jest + ts-jest, Vitest (frontend), `tsup`, ESLint + Prettier, and Stryker for mutation testing.

---

## 17. Implementation Phases

### Phase 1 — Foundation + SSE Transport

**Goal:** The lib exposes `RealtimeService` working with SSE single-instance.

Deliverables:
- [ ] Project scaffold (tsconfig, tsup, eslint, jest)
- [ ] Types in `src/shared/` (TransportMode, RealtimeEvent, ConnectionMeta)
- [ ] Interfaces (`ITransport`, `IConnectionAuthenticator`, `IConnectionLifecycleHooks`)
- [ ] `ConnectionRegistry`, `RoomRegistry`, `EventIdGenerator`, `EventReplayBuffer`
- [ ] `SseTransport` + `SseController` + heartbeat
- [ ] `RealtimeService` (delegation to transport)
- [ ] `BymaxRealtimeModule.forRoot()` + `forRootAsync()`
- [ ] Unit tests at **100% line/branch per implemented file** (Bymax library standard); ≥ 95% mutation on critical paths at the pre-release gate

Validation:
- NestJS fixture backend
- curl client simulating `EventSource` (long-poll with `Accept: text/event-stream`)
- Emit via `RealtimeService.emitToUser` reaches the client in <100ms

### Phase 2 — Auth + Last-Event-ID + Reauthentication

**Goal:** SSE production-ready single-instance. (Heartbeat ships in Phase 1.)

Deliverables:
- [ ] Auth patterns A (cookie) and B (ticket) working — example nest-auth bridge
- [ ] `EventReplayBuffer` with ring buffer
- [ ] `Last-Event-ID` handling in SseController
- [ ] Configurable `: keepalive` heartbeat
- [ ] Periodic `reauthenticationPolicy`
- [ ] `IConnectionLifecycleHooks` wired
- [ ] E2E tests with `EventSource` polyfill (Node `eventsource` package)

Validation:
- Automatic reconnection after a drop delivers missed events
- Periodic re-auth disconnects when the token has expired
- Heartbeat keeps the connection behind default nginx timeout (60s)

### Phase 3 — Horizontal Scaling (SSE)

**Goal:** SSE multi-instance via pub/sub.

Deliverables:
- [ ] `IRealtimePubSub` interface + default `InMemoryPubSub`
- [ ] `RedisRealtimePubSub` as an example impl
- [ ] `IOfflineQueueStorage` interface + `RedisOfflineQueue` example
- [ ] Cross-instance fan-out in `SseTransport`
- [ ] Tests with 2 simulated instances (worker_threads)

Validation:
- Emit from instance #1 reaches a connection on instance #2 within <200ms
- Offline queue retains events for an offline user

### Phase 4 — WebSocket Transport

**Goal:** Lib supports `transport: 'websocket'`.

Deliverables:
- [ ] `WebSocketTransport` + `RealtimeGateway`
- [ ] `@socket.io/redis-adapter` integration
- [ ] Periodic re-auth on WS (vs SSE — differences)
- [ ] E2E tests with `socket.io-client`
- [ ] `CompositeTransport` for `'both'` mode

Validation:
- WS client receives emits identical to an SSE client
- Switching `transport: 'sse' → 'websocket'` in config does not change service code

### Phase 5 — Frontend (`./react`)

**Goal:** Universal `useRealtime` hook with auto-detect.

Deliverables:
- [ ] SSE-only `useRealtime`
- [ ] `useRealtime` WS via dynamic socket.io-client import
- [ ] `useRealtimeConnection`, `RealtimeProvider`
- [ ] `usePresence` (if `IPresenceStorage` configured)
- [ ] Tests with React Testing Library + MSW + EventSource mock
- [ ] Bundle size check — SSE-only React build ≤ 4 KB brotli

Validation:
- React app connects via SSE with 0 socket.io-client dependencies
- React app connects via WS, socket.io-client loads dynamically
- Automatic reconnection + replay work end-to-end

### Phase 6 — Release `v0.1.0`

- [ ] README with badges, quick start, 4 examples (simple SSE, SSE+Redis, WS, both)
- [ ] CHANGELOG, SECURITY, CLAUDE.md, AGENTS.md
- [ ] CI workflows
- [ ] Bundle size validation
- [ ] `pnpm publish --provenance`

**Total scope:** 6 phases (most complex lib in the portfolio). Execution by AI agents — no estimate in human days. The Complexity Matrix per sub-step lives in `docs/development_plan.md`; the executable tasks live in `docs/tasks/` (one file per phase).

---

## 18. Known Limitations

### 18.1 SSE does not support client → server

This is inherent to the protocol. For "ack" or client commands, use a separate HTTP POST.

### 18.2 `EventSource` does not accept custom headers

The browser strips headers in GET `EventSource`. Header-based auth only works with socket.io-client (WS) or the `event-source-polyfill` (not all browsers support it). Recommended default: cookie or ticket.

### 18.3 HTTP/1.1 limits 6 connections per origin

For apps with many tabs, consider:
- HTTP/2 (multiplexing — no practical limit)
- Dedicated subdomain (e.g., `events.bymax.finance`)
- `RealtimeProvider` to multiplex via a single `EventSource` + client-side dispatching

### 18.4 In-memory replay buffer is per-instance

After a restart or in multi-instance, the buffer is zeroed/divergent. For strong "no event loss" guarantees, configure `IOfflineQueueStorage` (Redis-backed).

### 18.5 Heartbeat keepalive vs aggressive proxies

Proxies/load balancers with timeout < 30s will drop SSE connections during silent periods. Configure `heartbeatMs` below the timeout (default 30s works with nginx 60s default).

### 18.6 No cross-event ordering guarantee

Events for the same user are delivered in order. Cross-event/cross-user ordering is not guaranteed (especially in multi-instance pub/sub mode).

### 18.7 No server-side backpressure

If the client is slow and the server emits fast, events may accumulate in the RxJS Subject buffer. The lib does not block the producer. Recommendation: emit moderately (do not use realtime for high-frequency streams — use HTTP polling or another solution).

### 18.8 WebSocket fallback transports

Socket.IO supports long-polling as a fallback. In corporate environments hostile to WS, this helps. But the lib **does not** document long-polling as the preferred path — pick SSE in those cases (native HTTP, no upgrade).

### 18.9 WebSocket horizontal scaling requires sticky sessions

When the WebSocket transport runs on ≥ 2 nodes **and** the HTTP long-polling fallback is enabled (`transports: ['websocket', 'polling']`, the default), the load balancer **must** pin each client to one node (session affinity). The `@socket.io/redis-adapter` syncs messages across nodes but does **not** remove this handshake-affinity requirement; without it, polling handshakes fail with `"Session ID unknown"` and clients loop on reconnect. Either enable sticky sessions or set `transports: ['websocket']` to drop the polling fallback. SSE has no such requirement. See §11.4–§11.5 and Appendix C.3.

---

## 19. Example Integration

### 19.1 Example — SSE for platform notifications (multi-tenant SaaS)

```typescript
// apps/backend/src/app.module.ts
@Module({
  imports: [
    BymaxRealtimeModule.forRootAsync({
      imports: [ConfigModule, CacheModule, AuthModule],
      inject: [ConfigService, JwtService, CACHE_REDIS_CLIENT_TOKEN],
      useFactory: (config: ConfigService, jwt: JwtService, redis: Redis) => ({
        transport: 'sse',
        service: { name: 'platform-backend', version: process.env.RELEASE_SHA! },
        authenticator: new NestAuthRealtimeBridge(jwt),
        tenantResolver: (auth) => auth.tenantId,
        pubsub: new RedisRealtimePubSub(redis, { channel: 'platform:realtime' }),
        offlineQueue: new RedisOfflineQueue(redis, { ttlSeconds: 86_400, maxPerUser: 500 }),
        sse: {
          endpoint: '/events',
          heartbeatMs: 30_000,
          replayBufferSize: 200,
          cors: { origin: config.getOrThrow('FRONTEND_URL'), credentials: true },
        },
        hooks: {
          onConnect: (meta) => logger.info('REALTIME_CONNECT', 'Connection opened', meta.userId, meta),
          onDisconnect: (meta) => logger.info('REALTIME_DISCONNECT', 'Connection closed', meta.userId, meta),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

Real use case — webhook DLQ alert:

```typescript
@Injectable()
export class WebhookProcessor {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly logger: PinoLoggerService,
  ) {}

  async handleDeadLetter(webhook: Webhook, reason: string) {
    await this.realtime.emitToTenant(webhook.tenantId, 'webhook.dlq', {
      webhookId: webhook.id,
      provider: webhook.provider,
      reason,
      timestamp: new Date().toISOString(),
    })
    this.logger.warn('WEBHOOK_DLQ', `Webhook moved to DLQ: ${reason}`, undefined, {
      webhookId: webhook.id,
    })
  }
}
```

Frontend (Next.js 16, tenant dashboard):

```tsx
'use client'
import { useRealtime } from '@bymax-one/nest-realtime/react'
import { toast } from 'sonner'

interface PlatformEvents {
  'webhook.dlq': { webhookId: string; provider: string; reason: string }
  'invoice.paid': { id: string; amount: number; currency: string }
  'dispute.opened': { disputeId: string; amount: number }
}

export function RealtimeListener() {
  useRealtime<PlatformEvents>({
    url: '/api/events',
    events: {
      'webhook.dlq': (data) => toast.error(`Webhook ${data.webhookId} failed: ${data.reason}`),
      'invoice.paid': (data) => toast.success(`Invoice ${data.id} paid`),
      'dispute.opened': (data) => toast.warning(`Dispute ${data.disputeId} opened`),
    },
  })

  return null  // headless
}
```

### 19.2 Example — WebSocket for a live training session

```typescript
// apps/backend/src/app.module.ts
BymaxRealtimeModule.forRoot({
  transport: 'websocket',
  authenticator: new MyWsAuthBridge(),
  websocket: {
    namespace: '/training',
    pingIntervalMs: 25_000,
    redisAdapter: { pubClient: redisClient },
  },
})
```

Use case — personal trainer broadcasting targets to online students:

```typescript
@Injectable()
export class TrainingSessionService {
  constructor(private readonly realtime: RealtimeService) {}

  async broadcastSetTarget(sessionId: string, target: { reps: number; weight: number }) {
    await this.realtime.emitToRoom(
      `resource:training-session:${sessionId}`,
      'set.target',
      target,
    )
  }
}
```

### 19.3 Example — `'both'` mode for gradual migration

```typescript
// Scenario: the app already has SSE for notifications; a new chat feature requires WS.
BymaxRealtimeModule.forRoot({
  transport: 'both',
  authenticator: new MyAuthenticator(),
  pubsub: new RedisRealtimePubSub(redis),
  sse: { endpoint: '/events' },
  websocket: { namespace: '/chat', redisAdapter: { pubClient: redis } },
})

// Service emits once; it goes to both transports automatically.
await realtime.emitToTenant(tenantId, 'chat.message', { from, body })
```

Frontend chooses which to use:

```tsx
// Notifications dashboard
useRealtime({ url: '/api/events', events: { ... } })  // SSE

// Chat page
useRealtime({ url: 'wss://api/chat', events: { ... } })  // WS
```

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **SSE** | Server-Sent Events — HTTP one-way push protocol (`text/event-stream`) |
| **WS** | WebSocket — full-duplex bi-directional protocol |
| **EventSource** | Native browser API for consuming SSE |
| **Socket.IO** | WS library with rooms, namespaces, reconnect, fallbacks |
| **Last-Event-ID** | HTTP header sent by the browser when reconnecting SSE; used for replay |
| **Heartbeat / keepalive** | Periodic empty message to avoid proxy timeout |
| **Pub/sub** | Messaging mechanism between instances for event fan-out |
| **Room** | Logical grouping of connections (user, tenant, resource) |
| **Namespace (Socket.IO)** | Isolated sub-channel within the same Socket.IO server |
| **Backpressure** | When the producer emits faster than the consumer can process |
| **IDOR** | Insecure Direct Object Reference — cross-tenant access vulnerability |
| **Ticket pattern** | Temporary auth for clients without cookies: issue ticket via POST, use in query string |

---

## Appendix B — SSE vs WebSocket — when to pick each one

| Situation | Choice |
|---|---|
| Push notifications (payment, status, alert) | **SSE** |
| Live dashboards | **SSE** |
| Live log tail | **SSE** |
| Progressive streaming (LLM output, file processing) | **SSE** |
| Chat / messaging | **WS** |
| Collaborative editor (Google Docs–like) | **WS** |
| Gaming / remote control | **WS** |
| Client sends frequent small updates to the server | **WS** |
| "Is typing..." indicator | **WS** |
| You are on a corporate network hostile to WS | **SSE** |
| You need it to work behind weird proxies | **SSE** |
| Ultra-minimal frontend bundle | **SSE** |
| You want to start simple and migrate later if needed | **SSE** (default) |
| You already have Socket.IO in production and want to keep it | **WS** |
| Bi-directional use case from day 1 | **WS** |

### Quick rule

> **Server emits more than the client?** SSE. **Active bi-directional?** WS.

---

## Appendix C — Proxy and infra considerations

### C.1 Nginx (SSE)

```nginx
location /events {
  proxy_pass http://backend;
  proxy_http_version 1.1;
  proxy_set_header Connection '';
  proxy_buffering off;             # CRITICAL — without this, nginx buffers and SSE does not flow
  proxy_cache off;
  proxy_read_timeout 24h;          # or >> heartbeat interval
  chunked_transfer_encoding off;
  gzip off;                        # never gzip text/event-stream — compression buffers the stream
}
```

The application can also send the `X-Accel-Buffering: no` response header on the SSE route, which nginx honors to disable buffering for that response without a location block. Do **not** place `compression` middleware in front of the SSE route, and send `Cache-Control: no-cache, no-transform` (see §15).

### C.2 Cloudflare (SSE)

- Works out-of-the-box on Free and higher plans
- 100s connection limit on the Free tier — use **Pro+ for long connections** or configure aggressive heartbeat
- Enable HTTP/2 or HTTP/3 for multiplexing

### C.3 AWS ALB / API Gateway

- ALB: supports SSE natively, configure `idle_timeout` > heartbeat
- ALB + **scaled WebSocket with polling fallback**: enable **target-group stickiness** (session affinity) or the polling handshake breaks across targets — see §11.4–§11.5 / §18.9
- API Gateway HTTP API: **30s limit** — not recommended for long-running SSE; use ALB directly
- API Gateway WebSocket API: dedicated service for WS

### C.4 Vercel / Netlify (serverless)

- Hosting SSE on **serverless functions is problematic** (short timeouts, billing per execution)
- Recommendation: NestJS backend on a dedicated VM/container (Railway, Fly.io, AWS Fargate)

### C.5 File descriptor limits

Each SSE/WS connection consumes 1 FD. Default Linux ~1024. For >1000 connections:

```bash
ulimit -n 65536
```

In containers, configure `ulimits` in the compose/docker.

### C.6 Memory per-connection

- SSE: ~10-30 KB per connection (Subject + buffer)
- WS Socket.IO: ~30-50 KB per connection (Socket instance + buffers)

10k concurrent connections → 300-500 MB. Plan capacity.

---

> **Next steps (after this spec):**
> 1. Generate `development_plan.md` (Layer 2) with detailed phases + the phase dashboard
> 2. Generate `docs/tasks/phase-NN-<slug>.md` (Layer 3) — one file per phase — with executable tasks
> 3. Code bootstrap following the plan
> 4. Release `v0.1.0` on npm
</content>
</invoke>