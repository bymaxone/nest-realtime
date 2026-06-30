# @bymax-one/nest-realtime — Architectural Reference

> See [CLAUDE.md](./CLAUDE.md) for critical rules and the verification checklist. This file documents architectural decisions, patterns, and invariants.

---

## Architecture Overview

```
src/
├── server/         → `.` subpath — NestJS module + all server-side implementation
│   ├── config/     → option validation (validate-options.ts)
│   ├── constants/  → injection tokens, phase constants
│   ├── factories/  → transport factory (creates SseTransport / WebSocketTransport / CompositeTransport)
│   ├── interfaces/ → ALL contracts: ITransport, IConnectionAuthenticator, IRealtimePubSub, ...
│   ├── offline-queue/ → RedisOfflineQueue (reference impl; requires ioredis peer)
│   ├── pubsub/     → InMemoryPubSub, RedisRealtimePubSub, PubSubSubscriber
│   ├── services/   → ConnectionRegistry, RoomRegistry, RealtimeService, EventIdGenerator,
│   │                  AuthenticationCache, ReauthenticationService, HeartbeatService,
│   │                  OfflineQueueManager, PresenceManager
│   ├── transports/
│   │   ├── sse/    → SseTransport, SseController, SseSubscriptionHandler, EventReplayBuffer, encodeSseEvent
│   │   ├── websocket/ → WebSocketTransport, RealtimeGateway, RealtimeIoAdapter
│   │   └── composite/ → CompositeTransport
│   ├── utils/      → composeRoomId
│   └── realtime.module.ts → BymaxRealtimeModule (forRoot + forRootAsync)
├── shared/         → `./shared` subpath — zero-dep types + constants
│   ├── constants/  → ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES
│   └── types/      → TransportMode, RealtimeEvent, PublicConnectionMeta
└── react/          → `./react` subpath — browser hooks + provider
    ├── hooks/      → useRealtime, useRealtimeConnection, usePresence
    │               → (internal: useRealtimeSse, useRealtimeWs)
    └── providers/  → RealtimeProvider, useRealtimeContext
```

---

## Transport Architecture

### `ITransport` abstraction

```typescript
interface ITransport {
  kind: 'sse' | 'websocket'   // never 'both'
  emit(connectionId: string, event: RealtimeEvent): Promise<void>
  emitToRoom(roomId: string, event: RealtimeEvent): Promise<void>
  disconnect(connectionId: string): Promise<void>
  // ... local variants for pub/sub re-emit
}
```

Three concrete implementations:

| Class | `kind` | When active |
|---|---|---|
| `SseTransport` | `'sse'` | `transport: 'sse'` |
| `WebSocketTransport` | `'websocket'` | `transport: 'websocket'` |
| `CompositeTransport` | **`'sse'`** | `transport: 'both'` |

`CompositeTransport.kind === 'sse'` — the composite transport reports itself as SSE because SSE is the dominant transport. The WebSocket half is the opt-in addition.

### SSE transport details

- Uses NestJS `@Sse()` decorator; each connection is an RxJS `Observable<MessageEvent>` returned from the controller.
- Every connected `(userId, connectionId)` pair has a per-connection `Subject` in the `ConnectionRegistry`.
- `HeartbeatService` writes `: keepalive\n\n` raw comment lines to the response stream at `sse.heartbeatMs` intervals (default 25 s). This is **not** a `MessageEvent` and is **not** assigned an event ID.
- `EventReplayBuffer` is a ring buffer (FIFO, per-user) that stores the last `replayBufferSize` events. On reconnect, the SSE controller sends `Last-Event-ID` replay.
- `encode-sse-event.ts` serializes `RealtimeEvent` to the SSE wire format (`id:`, `event:`, `data:` fields).

### WebSocket transport details

- Built on Socket.IO 4.x via `@nestjs/websockets` + `@nestjs/platform-socket.io`.
- `RealtimeIoAdapter` extends `IoAdapter` and registers the Socket.IO server on the configured `namespace`.
- `RealtimeGateway` handles `connection` and `disconnect` Socket.IO events; authentication runs in a connection middleware.
- The Redis adapter (`@socket.io/redis-adapter`) is wired in `RealtimeIoAdapter` when `websocket.redisAdapter.pubClient` is provided. It calls `.duplicate()` on the supplied ioredis client to create a subscriber client — the library never creates its own Redis connection.

---

## Cross-Instance Emit Shape

This invariant must be respected in all implementations and descriptions:

```
emitToUser(userId, event)
  │
  ├─ 1. local delivery:  emitToUserLocal(userId, event)
  │                      (sends to connections on THIS instance)
  │
  └─ 2. publish once:    IRealtimePubSub.publish({ op: 'emit', userId, event })
                         (other instances receive and re-emit via local-only paths)

Subscriber (other instances):
  message arrives → emitToUserLocal(userId, event)
                    (no re-publish → no loop)
```

The same shape applies to `emitToTenant`, `emitToRoom`, and `broadcast`.

**Cross-instance revocation** (`disconnect(connectionId)`):

```
disconnect(connectionId)
  │
  ├─ 1. local:   disconnect own connection if present
  └─ 2. publish: { op: 'disconnect', connectionId }
                 → subscriber calls disconnectLocal(connectionId) on receiving instance
```

### Echo prevention in `PubSubSubscriber`

The subscriber must NOT re-publish what it receives (infinite loop). The implementation tracks a per-instance ID (`REALTIME_INSTANCE_ID_TOKEN`) and ignores messages published by itself.

---

## `ConnectionRegistry` and `RoomRegistry`

### `ConnectionRegistry`

Holds the in-memory map of active connections per instance:

```
connectionId → { userId, tenantId, transport, connectedAt, subject (SSE only), socket (WS only) }
```

FIFO eviction: when `maxConnectionsPerUser` is reached, the **oldest** connection is evicted (closed with `REALTIME_TOO_MANY_CONNECTIONS`) and the new connection is admitted. The new connection is **never rejected with HTTP 429**.

### `RoomRegistry`

Maps `roomId → Set<connectionId>`. Auto-membership:
- `user:{userId}` — joined on every connect.
- `tenant:{tenantId}` — joined when `tenantId` is present in `AuthenticationResult`.

Consumer-controlled membership: `RealtimeService.joinRoom(connectionId, roomId)` and `leaveRoom(connectionId, roomId)`.

---

## Authentication Flow

```
1. HTTP GET /events (SSE) or Socket.IO handshake (WS)
2. SseController / RealtimeGateway builds ConnectionAuthContext from request
3. IConnectionAuthenticator.authenticate(ctx) → AuthenticationResult | null
4. null → 401 (SSE) / disconnect with REALTIME_AUTH_FAILED (WS)
5. AuthenticationResult → ConnectionRegistry.register() → RoomRegistry auto-join
6. connection:established event emitted to client (if emitConnectionEvent is true)
```

### Re-authentication

When `reauthenticationPolicy.intervalSeconds` is configured:

- `ReauthenticationService` calls `IConnectionAuthenticator.revalidate(connectionId, originalAuth)` periodically.
- A positive result is cached for `cacheTtlMs` (default 60 s) to reduce auth-provider load.
- On failure: `onFailure: 'disconnect'` (default) closes the connection; `'event'` emits `connection:reauthentication-failed` instead.

---

## Offline Queue and Replay

### Online path (connection present)

`emitToUser` → `ConnectionRegistry.getConnections(userId)` → direct delivery via transport.

### Offline path (no active connections)

`emitToUser` → no connections found → `IOfflineQueueStorage.enqueue(userId, event)`.

On reconnect: `OfflineQueueManager` flushes queued events to the new connection before any live events.

### Last-Event-ID replay (SSE)

`EventReplayBuffer` stores the last `N` events per user (ring buffer). On SSE reconnect with `Last-Event-ID` header:
1. `SseSubscriptionHandler` reads the `Last-Event-ID`.
2. `EventReplayBuffer.getEventsAfter(userId, lastId)` returns missed events.
3. They are emitted before the live stream.

---

## React Subpath Architecture

### `RealtimeProvider`

A React context provider that manages the connection lifecycle:

- **SSE mode** (default): creates an `EventSource` and dispatches events to subscribers.
- **WebSocket mode** (`forceWebSocket: true` or auto-upgrade): dynamically imports `socket.io-client` via `await import('socket.io-client')` — the static bundle never includes it.

### `useRealtime`

```typescript
const { lastEvent, events } = useRealtime<TData>({ event: 'invoice.paid' })
```

Subscribes to a specific event type. `events` is a bounded history array.

### `useRealtimeConnection`

```typescript
const { connected, transport, reconnectCount } = useRealtimeConnection()
```

Returns connection state. `transport` is `'sse' | 'websocket'`.

### `usePresence`

```typescript
const { onlineUsers } = usePresence(roomId)
```

Subscribes to `presence:online` and `presence:offline` events. Requires `IPresenceStorage` configured server-side.

### `socket.io-client` dynamic import invariant

The static bundle of `dist/react/index.mjs` must never contain a static `import ... from 'socket.io-client'` or `require('socket.io-client')`. Gate: `pnpm size` checks this via a regex on the bundle.

---

## Testing Patterns

### Unit tests — mocking the transport

```typescript
const mockTransport: Partial<ITransport> = {
  kind: 'sse',
  emit: jest.fn().mockResolvedValue(undefined),
  emitToRoom: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
}
```

### Unit tests — mocking the authenticator

```typescript
const mockAuth: IConnectionAuthenticator = {
  authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1' }),
}
```

### E2E tests — EventSource

E2E tests use the `eventsource` npm package as a Node.js polyfill for `EventSource`. The SSE controller is tested via `supertest` + a real NestJS test application. Cross-instance tests spin up two application instances via `worker_threads` and a real Redis connection.

### Stryker mutation testing

Configuration: `stryker.config.json` — thresholds `high: 99, low: 95, break: 95`. Run via `pnpm mutation` (pre-release only; ~15–25 min). Critical paths held to ≥ 95%:

- `connection-registry.service.ts`
- `room-registry.service.ts`
- `sse.transport.ts`
- `event-replay-buffer.ts`
- `event-id-generator.service.ts`
- `encode-sse-event.ts`
- `realtime-pubsub-subscriber.ts`
- `composite.transport.ts`
- `validate-options.ts`

Document surviving equivalent mutants with `// Stryker disable next-line <Mutator>: <reason>` rather than lowering thresholds.

---

## Error Code Catalog (§14)

| Code | Constant | When emitted |
|---|---|---|
| `REALTIME_INVALID_OPTIONS` | `REALTIME_ERROR_CODES.INVALID_OPTIONS` | Bad `forRoot` options at bootstrap |
| `REALTIME_AUTH_FAILED` | `REALTIME_ERROR_CODES.AUTH_FAILED` | `authenticate()` returned `null` |
| `REALTIME_REAUTHENTICATION_FAILED` | `REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED` | `revalidate()` returned `false` |
| `REALTIME_TOO_MANY_CONNECTIONS` | `REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS` | FIFO eviction of oldest connection |
| `REALTIME_INVALID_TICKET` | `REALTIME_ERROR_CODES.INVALID_TICKET` | Ticket not found / expired |
| `REALTIME_PUBSUB_UNAVAILABLE` | `REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE` | Pub/sub backend unreachable (degrades gracefully) |
| `REALTIME_PAYLOAD_TOO_LARGE` | `REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE` | Event data exceeds configured limit |
| `REALTIME_REPLAY_BUFFER_MISS` | `REALTIME_ERROR_CODES.REPLAY_BUFFER_MISS` | `Last-Event-ID` outside the replay window |

---

## Invariants Checklist

Before marking any change complete:

- [ ] `grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/` → zero
- [ ] `grep -E "^import.*socket.io-client" dist/react/index.mjs` → zero (after `pnpm build`)
- [ ] `pnpm typecheck && pnpm lint` → clean
- [ ] `pnpm test:cov` → 100% line/branch on every modified file
- [ ] `pnpm build && pnpm size` → all budgets green
- [ ] `package.json` `"dependencies": {}` — no direct deps added
- [ ] No `.gitkeep` / placeholder files
- [ ] All comments and identifiers in English; no Phase/Task references in committed files
