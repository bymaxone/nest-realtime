# Source layout and reference detail

> Moved out of [AGENTS.md](../../AGENTS.md), which Codex reads under a 32768 B cap. The rules a
> reviewer has to enforce stay in AGENTS.md; this file holds the reference-only detail they
> point at. When the two disagree, the code wins.

## Architecture Overview

```
src/
├── internal/       → `./internal` — NOT public API. The one bundle the `.` and
│                     `./websocket` entries both import by package specifier, so
│                     their shared classes and `Symbol` tokens keep one identity.
├── server/         → `.` subpath — the SSE module and everything transport-agnostic
│   ├── config/     → option validation (validate-options.ts)
│   ├── constants/  → injection tokens, reserved event names, room prefixes
│   ├── composition/ → TransportWiring seam + the composition both modules share
│   ├── interfaces/ → ALL contracts: ITransport, IConnectionAuthenticator, IRealtimePubSub, ...
│   ├── offline-queue/ → RedisOfflineQueue (reference impl; requires ioredis peer)
│   ├── pubsub/     → InMemoryPubSub, RedisRealtimePubSub, PubSubSubscriber
│   ├── services/   → ConnectionRegistry, RoomRegistry, RealtimeService, EventIdGenerator,
│   │                  AuthenticationCache, ReauthenticationService, HeartbeatService,
│   │                  OfflineQueueManager, PresenceManager
│   ├── transports/
│   │   └── sse/    → SseTransport, SseController, SseSubscriptionHandler, EventReplayBuffer, encodeSseEvent
│   ├── utils/      → composeRoomId, parseCookieHeader
│   └── realtime.module.ts → BymaxRealtimeModule (SSE only; forRoot + forRootAsync)
├── websocket/      → `./websocket` subpath — the only graph that imports Socket.IO
│   ├── realtime-websocket.module.ts → BymaxRealtimeWebSocketModule ('websocket' | 'both')
│   ├── websocket-wiring.ts → the TransportWiring the module supplies
│   └── transports/
│       ├── websocket/ → WebSocketTransport, RealtimeGateway, RealtimeIoAdapter
│       └── composite/ → CompositeTransport ('both')
├── shared/         → `./shared` subpath — zero-dep types + constants
│   ├── constants/  → ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES
│   └── types/      → TransportMode, RealtimeEvent, PublicConnectionMeta
└── react/          → `./react` subpath — browser hooks + provider
    ├── hooks/      → useRealtime, useRealtimeConnection, usePresence
    │               → (internal: useRealtimeSse, useRealtimeWs)
    └── providers/  → RealtimeProvider, useRealtimeContext
```

## Transport Architecture

### `ITransport` abstraction

```typescript
interface ITransport {
  kind: 'sse' | 'websocket' // never 'both'
  emit(connectionId: string, event: RealtimeEvent): Promise<void>
  emitToRoom(roomId: string, event: RealtimeEvent): Promise<void>
  disconnect(connectionId: string): Promise<void>
  // ... local variants for pub/sub re-emit
}
```

Three concrete implementations:

| Class                | `kind`        | When active                                  |
| -------------------- | ------------- | -------------------------------------------- |
| `SseTransport`       | `'sse'`       | `transport: 'sse'`                           |
| `WebSocketTransport` | `'websocket'` | `transport: 'websocket'` — via `./websocket` |
| `CompositeTransport` | **`'sse'`**   | `transport: 'both'` — via `./websocket`      |

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

## `ConnectionRegistry` and `RoomRegistry`

### `ConnectionRegistry`

Holds the in-memory map of active connections per instance:

```
connectionId → {
  userId, tenantId, transport, ip, userAgent, connectedAt,
  subject (SSE only), close$ (SSE only),
  originalAuth: { userId, tenantId, roles, metadata },
}
```

FIFO eviction: when `maxConnectionsPerUser` is reached, the **oldest** connection is evicted (closed with `REALTIME_TOO_MANY_CONNECTIONS`) and the new connection is admitted. The new connection is **never rejected with HTTP 429**.

### `RoomRegistry`

Maps `roomId → Set<connectionId>`. Auto-membership:

- `user:{userId}` — joined on every connect.
- `tenant:{tenantId}` — joined when `tenantId` is present in `AuthenticationResult`.

Consumer-controlled membership: `RealtimeService.joinRoom(connectionId, roomId)` and `leaveRoom(connectionId, roomId)`.

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

## Error Code Catalog (§14)

| Code                               | Constant                                       | When emitted                                      |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `REALTIME_INVALID_OPTIONS`         | `REALTIME_ERROR_CODES.INVALID_OPTIONS`         | Bad `forRoot` options at bootstrap                |
| `REALTIME_AUTH_FAILED`             | `REALTIME_ERROR_CODES.AUTH_FAILED`             | `authenticate()` returned `null`                  |
| `REALTIME_REAUTHENTICATION_FAILED` | `REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED` | `revalidate()` returned `false`                   |
| `REALTIME_TOO_MANY_CONNECTIONS`    | `REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS`    | FIFO eviction of oldest connection                |
| `REALTIME_INVALID_TICKET`          | `REALTIME_ERROR_CODES.INVALID_TICKET`          | Ticket not found / expired                        |
| `REALTIME_PUBSUB_UNAVAILABLE`      | `REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE`      | Pub/sub backend unreachable (degrades gracefully) |
| `REALTIME_PAYLOAD_TOO_LARGE`       | `REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE`       | Event data exceeds configured limit               |
| `REALTIME_REPLAY_BUFFER_MISS`      | `REALTIME_ERROR_CODES.REPLAY_BUFFER_MISS`      | `Last-Event-ID` outside the replay window         |
