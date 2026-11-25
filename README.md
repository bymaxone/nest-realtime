<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--realtime-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-realtime" />
</p>

<h1 align="center">@bymax-one/nest-realtime</h1>

<p align="center">
  <strong>Dual-transport realtime for NestJS & React</strong><br />
  <sub>SSE by Default · WebSocket Opt-In · Multi-Tenant Rooms · Auth Inversion · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-realtime"><img src="https://img.shields.io/npm/v/@bymax-one/nest-realtime?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-realtime"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-realtime?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-realtime/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-realtime/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-realtime/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-realtime/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100.00%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-realtime"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-realtime/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-realtime/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-realtime?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-realtime">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-realtime/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="https://github.com/bymaxone/nest-realtime-example">Example App</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-realtime` is a **transport-agnostic realtime channel** shipped as a single npm package with **4 subpath exports** — covering the SSE server module, the WebSocket module, the shared type contracts, and the React hooks that consume them.

The default transport is **Server-Sent Events**: browser-native, plain HTTP, no client library to ship. WebSocket via Socket.IO is one config flag away, and `'both'` runs them side by side. Your application code calls the same `RealtimeService` either way — the transport is a deployment decision, not an architectural one.

### Why nest-realtime?

- **🎯 One API, any transport** — `emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, and `disconnect` behave identically on SSE, WebSocket, or both. Migrating between transports changes a config line, not your call sites.
- **📡 SSE first, and that is the point** — SSE reconnects natively, replays through `Last-Event-ID`, and traverses proxies as ordinary HTTP. Most apps only push server → client, and for those WebSocket is a dependency you pay for without using.
- **🔌 Auth stays yours** — The library never verifies a JWT, never imports an auth package. You implement `IConnectionAuthenticator`; cookie, ticket, and bearer patterns are all supported. This is enforced structurally, not by convention.
- **🏢 Multi-tenant by construction** — Every connection auto-joins `user:{id}` and, when present, `tenant:{id}`. Tenant scoping is a room convention, not an afterthought bolted onto a chat library.
- **🪶 Nothing in your bundle you didn't ask for** — `"dependencies": {}` on the server, and `socket.io-client` is reached through `await import()` so an SSE-only frontend ships about 2 KB brotli and never loads it.

---

## 🔥 Features

### 📡 Transports

- ✅ **SSE (default)** — native browser reconnect, `Last-Event-ID` replay, `: keepalive` heartbeat tuned for real proxies
- ✅ **WebSocket (opt-in)** — Socket.IO gateway behind the `/websocket` subpath, with full-duplex `emit`; an SSE app never installs it
- ✅ **Composite mode** — `transport: 'both'`, also on the `/websocket` subpath, fans a single emit out to clients on either transport
- ✅ **Unified contract** — every transport implements `ITransport`, so `RealtimeService` never branches

### 🔐 Security & Auth

- ✅ **Auth inversion** — the consumer plugs `IConnectionAuthenticator`; the library owns no credentials
- ✅ **Zero auth imports** — `src/` imports no auth package (`@nestjs/jwt`, `passport-*`, `@bymax-one/nest-auth`), and a lint rule fails the build if one appears
- ✅ **Three handshake patterns** — HttpOnly cookie (SSE-safe), one-time ticket, and bearer header (WebSocket only)
- ✅ **Periodic re-authentication** — revalidate credentials on an interval, with a positive-result cache
- ✅ **Tenant from the token, never the body** — `tenantId` comes from the authenticated result via `tenantResolver`

### 🏢 Multi-Tenant & Delivery

- ✅ **Room conventions** — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`, with the first two auto-joined
- ✅ **Offline queue** — `IOfflineQueueStorage` holds events for absent users and flushes them on reconnect
- ✅ **Replay buffer** — per-user ring buffer answers `Last-Event-ID` after a dropped SSE stream
- ✅ **FIFO connection limits** — the oldest connection is evicted, so a new tab never gets a 429
- ✅ **Presence contract** — optional `IPresenceStorage` seam and `usePresence()` hook; the library never calls the storage or emits `presence:*` itself, so your application does both

### 🧩 Developer Experience

- ✅ **Dynamic module** — `forRoot()` and `forRootAsync()` with `useFactory` / `useClass` / `useExisting`
- ✅ **Strict TypeScript, zero `any`** — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` enabled
- ✅ **Horizontal scaling** — `IRealtimePubSub` for SSE fan-out, `@socket.io/redis-adapter` for WebSocket

---

## 📦 Subpath Exports

One package, several entry points — import only what your app needs:

| Subpath           | Import                                   | Purpose                                        |                           Dependencies                            |
| ----------------- | ---------------------------------------- | ---------------------------------------------- | :---------------------------------------------------------------: |
| **Server**        | `@bymax-one/nest-realtime`               | NestJS module for SSE, services, contracts     |                          NestJS 11, rxjs                          |
| **WebSocket**     | `@bymax-one/nest-realtime/websocket`     | NestJS module for `'websocket'` and `'both'`   | + `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` |
| **Shared**        | `@bymax-one/nest-realtime/shared`        | Types, room prefixes, event names, error codes |                               None                                |
| **React**         | `@bymax-one/nest-realtime/react`         | Hooks & `RealtimeProvider`                     |                             React 19                              |
| **Observability** | `@bymax-one/nest-realtime/observability` | Metrics contributor, pub/sub health indicator  |        + `@bymax-one/nest-core`, `prom-client` (optional)         |

```
       shared (zero deps)
      ↗        ↑        ↖
 server    websocket    react
```

`/websocket` also exports `RealtimeGateway`, `WebSocketTransport` and `CompositeTransport`. They are exported for the module's own wiring and for tests: applications register `BymaxRealtimeWebSocketModule` and install `RealtimeIoAdapter`, and do not construct them.

**The `websocket` subpath exists so the server one costs nothing extra.** Everything that touches `@nestjs/websockets`, `@nestjs/platform-socket.io` and `socket.io` is reachable only through it, so an SSE application never installs the Socket.IO stack. Importing it is what opts in.

The package also exposes `@bymax-one/nest-realtime/internal`. It is **not public API** and carries no compatibility promise — it is the shared runtime the two server subpaths import so that a service registered through one and injected through the other is the same class. Import the four above; nothing you need is only there.

These names from `./internal`, none of them API and none with a compatibility promise, are grouped below. Composition: `composeForRoot`, `composeForRootAsync`, `TransportRegistration`, `TransportWiring` and `sseWiring`. Shared services: `EventIdGenerator`, `ReauthenticationService`, `AuthenticationGate`, `AuthenticationUnavailableError`, `ConnectionAdmission`, `ConnectionLimitError`, `UNBOUNDED_TICKET`, `AdmissionTicket`, `OfflineQueueDeliveryService`, `EventReplayBuffer`, `HeartbeatService`, `SseSubscriptionHandler`, `createSseController`, `RoomRegistry`, `SseTransport` and `RealtimePubSubSubscriber`. Observability seams: `RealtimeMetricsTally`, `REFUSAL_REASONS`, `EVICTION_REASONS`, `TALLY_TRANSPORTS`, `RefusalReason`, `EvictionReason`, `TallyTransport`, `RealtimeTracing`, `RealtimeSpanName`, `RealtimeSpanAttributes`, `logEvent`, `REALTIME_LOG_EVENTS`, `RealtimeLogEvent` and `LogFields`. Utilities: `DEFAULT_HOOK_TIMEOUT_MS`, `assertIdentityIsNotBlank`, `resolveAuthTenant`, `admitRooms`, `assertBuiltinsIntact`, `replacedBuiltinCount`, `returnable`, `awaitable`, `shielded`, `started`, `describeError`, `callHostMethod`, `hostMethod`, `readHostKey`, `quitWithin`, `QuitableClient`, `runHook`, `unavailableError`, `refuseReservedRoom`, `requireRoomName`, `realtimeError`, `CodedError`, `reportDeliveryFailure` and `parseCookieHeader`.

---

> [!TIP]
> Prefer to learn from a working app? See the [nest-realtime-example](https://github.com/bymaxone/nest-realtime-example) — a NestJS + React project wired with this library.

## 🚀 Quick Start

### 1. Install

```bash
pnpm add @bymax-one/nest-realtime   # or npm install / yarn add
```

> [!IMPORTANT]
> You must also install the **peer dependencies** for the subpaths you use. The library declares `"dependencies": {}` — nothing is installed on your behalf.

```bash
# Server subpath (required)
pnpm add @nestjs/common @nestjs/core rxjs reflect-metadata

# WebSocket subpath (optional — only when you import @bymax-one/nest-realtime/websocket)
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io

# Horizontal scaling (optional)
pnpm add ioredis @socket.io/redis-adapter

# React subpath (optional)
pnpm add react react-dom

# WebSocket on the frontend (optional)
pnpm add socket.io-client
```

### 2. Implement the Authenticator Interface

This is the only interface you are required to provide. The library calls it once per connection and never inspects the credential itself. What it returns is your code's own object: a getter on it that throws raises that error as it is, the handshake fails, the error is logged under `err` and counted as `reason="error"`, and the client is sent nothing of it.

```typescript
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'
import { verifyAccessToken } from './jwt'

export class CookieAuthenticator implements IConnectionAuthenticator {
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const token = ctx.cookies['access_token']
    if (!token) return null

    try {
      const claims = await verifyAccessToken(token)
      return { userId: claims.sub, tenantId: claims.tid }
    } catch {
      return null // null rejects the connection
    }
  }
}
```

> [!NOTE]
> Returning `null` rejects the connection — throwing is not required. On SSE the client gets a `401`; on WebSocket the handshake fails with a `connect_error` whose `err.data.code` is `REALTIME_AUTH_FAILED` (`socket.active` is `false`, so Socket.IO does not retry on its own). See [Auth Inversion](#-security-model) for the ticket and bearer patterns.

### 3. Register the Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common'
import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'
import { CookieAuthenticator } from './auth/cookie-authenticator'

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: new CookieAuthenticator(),
    }),
  ],
})
export class AppModule {}
```

Clients now connect to `GET /realtime/sse` (configurable via `sse.endpoint`).

### 4. Emit From Anywhere

Inject `RealtimeService` into any provider or controller:

```typescript
import { Controller, Post, Body, Param } from '@nestjs/common'
import { RealtimeService } from '@bymax-one/nest-realtime'

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post(':id/pay')
  async pay(@Param('id') invoiceId: string, @Body() body: { userId: string; amount: number }) {
    await this.realtime.emitToUser(body.userId, 'invoice.paid', {
      invoiceId,
      amount: body.amount,
    })
  }
}
```

> [!IMPORTANT]
> The emit signature is `(target, eventName, data)` — three arguments. The event name is a separate string, not a field inside the payload.

### 5. Consume in React

Wrap the subtree once, then read from it with hooks:

```tsx
// App.tsx
import { RealtimeProvider } from '@bymax-one/nest-realtime/react'

export default function App() {
  return (
    <RealtimeProvider options={{ url: '/realtime/sse', eventNames: ['invoice.paid'] }}>
      <InvoiceList />
    </RealtimeProvider>
  )
}
```

```tsx
// InvoiceList.tsx
import { useRealtimeContext } from '@bymax-one/nest-realtime/react'

export function InvoiceList() {
  const { events, connected } = useRealtimeContext()

  return (
    <>
      <span>{connected ? '🟢 live' : '🔴 disconnected'}</span>
      <ul>
        {events.map((e, i) => (
          <li key={i}>
            {String(e.type)} — {JSON.stringify(e.data)}
          </li>
        ))}
      </ul>
    </>
  )
}
```

> [!NOTE]
> Events carry an `id` on the SSE branch only — the WebSocket branch has no per-event id, so the shared context type does not expose one. Narrow on `transport === 'sse'` if you need it.

> [!IMPORTANT]
> `EventSource` delivers a **named** event only to a listener registered for that exact name. Application-level names such as `invoice.paid` must be listed in `eventNames`, or they never reach the hook. Reserved and presence events are subscribed automatically.

### 6. Scale Across Instances

SSE connections live on the instance that accepted them. To fan an emit out to every instance, provide a pub/sub backend:

```typescript
import {
  BymaxRealtimeModule,
  RedisRealtimePubSub,
  RedisOfflineQueue,
} from '@bymax-one/nest-realtime'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new CookieAuthenticator(),
  pubsub: new RedisRealtimePubSub({ client: redis }),
  offlineQueue: new RedisOfflineQueue({ client: redis }),
  sse: { heartbeatMs: 25_000, replayBufferSize: 100, maxConnectionsPerUser: 5 },
})
```

For WebSocket, scaling goes through Socket.IO's own Redis adapter instead, configured in [step 7](#7-add-websocket-optional); `pubsub` and `offlineQueue` do not apply to WebSocket connections.

### 7. Add WebSocket (optional)

WebSocket lives behind its own subpath, so an SSE application never installs the Socket.IO stack. Install its peers (see [Install](#1-install)), then do two things: register `BymaxRealtimeWebSocketModule` from `/websocket` instead of `BymaxRealtimeModule`, and install `RealtimeIoAdapter` in `main.ts`. Two copies of `socket.io` in `node_modules` make TypeScript report TS2416 on `RealtimeIoAdapter` under `skipLibCheck: false`; dedupe to one copy.

```typescript
// app.module.ts
import { Module } from '@nestjs/common'
import { BymaxRealtimeWebSocketModule } from '@bymax-one/nest-realtime/websocket'
import Redis from 'ioredis'
import { CookieAuthenticator } from './auth/cookie-authenticator'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

@Module({
  imports: [
    BymaxRealtimeWebSocketModule.forRoot({
      transport: 'websocket', // or 'both' to serve SSE as well
      authenticator: new CookieAuthenticator(),
      websocket: {
        cors: { origin: 'https://app.example.com', credentials: true },
        redisAdapter: { pubClient: redis }, // only to scale across instances
      },
    }),
  ],
})
export class AppModule {}
```

```typescript
// main.ts
import { NestFactory } from '@nestjs/core'
import { RealtimeIoAdapter } from '@bymax-one/nest-realtime/websocket'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useWebSocketAdapter(new RealtimeIoAdapter(app))
  await app.listen(3000)
}
bootstrap()
```

> [!IMPORTANT]
> The `main.ts` line is not optional. `RealtimeIoAdapter` is what applies `websocket.cors`, `namespace`, `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize` and `redisAdapter`. Without it those options are ignored, the gateway's own CORS stays closed (`origin: false`) so no CORS header lets a browser on another origin read a long-polling response (a WebSocket upgrade is not subject to CORS: see [WebSocket origin](#websocket-origin)), and the module logs this error once at start-up:

```
RealtimeIoAdapter is not the active WebSocket adapter, so the websocket options are ignored and the gateway CORS stays closed (origin: false): browsers on another origin cannot connect. Add app.useWebSocketAdapter(new RealtimeIoAdapter(app)) in main.ts, importing it from '@bymax-one/nest-realtime/websocket'.
```

With `redisAdapter`, the adapter registers `@socket.io/redis-adapter` and calls `pubClient.duplicate()` for the subscriber. That connection is the library's: it is closed when the application closes, and a QUIT that Redis does not answer within two seconds is dropped, so a Redis that stopped answering cannot hold the shutdown. Your `pubClient` is never closed or changed. If it cannot be installed (the package is missing, the client has no `duplicate()`), the boot fails with `REALTIME_REDIS_ADAPTER_FAILED` instead of serving a single instance; a Redis that is merely unreachable does not fail the boot. Socket.IO's polling fallback needs sticky sessions even then — see [docs/architecture/scaling-cheatsheet.md](./docs/architecture/scaling-cheatsheet.md). On the frontend, a `ws://` or `wss://` `url` selects WebSocket in `RealtimeProvider`. Replay through `Last-Event-ID` and the offline queue are SSE features: a WebSocket connection has neither.

---

## ⚙️ Configuration

All options are passed to `forRoot()` / `forRootAsync()`. Only `transport` and `authenticator` are required.

| Group                      | Key Options                                                                                                                                                                                                                  | Default                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **transport**              | `'sse'` \| `'websocket'` \| `'both'`                                                                                                                                                                                         | — (**required**)                                                                       |
| **authenticator**          | `IConnectionAuthenticator`                                                                                                                                                                                                   | — (**required**)                                                                       |
| **tenantResolver**         | `(auth) => string \| undefined \| null` — derives `tenantId` from the auth result (it receives the authenticator's own result, not a copy), on **both** transports; `undefined` and `null` mean "no opinion" and fall back   | `auth.tenantId`                                                                        |
| **hooks**                  | `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed`, `onDeliveryFailure` (fire-and-forget)                                                                                                                    | —                                                                                      |
| **hookTimeoutMs**          | How long the library waits for a hook it awaits (`onDisconnect` on both transports, WebSocket `onConnect`) before giving up on it; integer from 1 to 2147483647                                                              | `5000`                                                                                 |
| **onConnectFailure**       | What a failing `onConnect` does to its connection: `'ignore'` logs it and keeps the connection, `'close'` logs it and closes the connection on both transports, after the hook has run; anything else is refused at start-up | `'ignore'`                                                                             |
| **authenticateTimeoutMs**  | How long a handshake waits for `authenticate` before it is refused (SSE `503`, WebSocket the generic error); integer from 1 to 2147483647                                                                                    | `10000`                                                                                |
| **maxPendingHandshakes**   | How many calls to `authenticate` may be waiting at once, across both transports; over it a handshake is refused at once without calling it; integer >= 1                                                                     | `1000`                                                                                 |
| **maxConnections**         | How many connections one instance holds, both transports together; a handshake past it is refused before `authenticate` is called (SSE `503`, WebSocket the generic error); integer >= 1, no way to switch it off            | `10000`                                                                                |
| **pubsub**                 | `IRealtimePubSub` — cross-instance fan-out for SSE                                                                                                                                                                           | `InMemoryPubSub`                                                                       |
| **offlineQueue**           | `IOfflineQueueStorage` — events held while a user is away                                                                                                                                                                    | — (disabled)                                                                           |
| **presence**               | `IPresenceStorage` — contract for your own presence tracking; the library never calls it                                                                                                                                     | — (disabled)                                                                           |
| **sse**                    | `endpoint`, `heartbeatMs`, `replayBufferSize`, `replayTtlMs`, `replayMaxIdleUsers`, `maxConnectionsPerUser`, `emitConnectionEvent`, `maxQueuedBytes`, `maxQueuedEvents`, `stallHeartbeats`                                   | `/realtime/sse`, `30000`, `100`, `300000`, `1000`, `5`, `true`, `2097152`, `1000`, `3` |
| **websocket**              | `namespace`, `cors`, `maxHttpBufferSize`, `pingIntervalMs`, `pingTimeoutMs`, `maxConnectionsPerUser`, `emitConnectionEvent`, `redisAdapter`                                                                                  | `'/'`, — (Socket.IO defaults), `5` for `maxConnectionsPerUser`                         |
| **reauthenticationPolicy** | `intervalSeconds`, `onFailure` (`'disconnect'` \| `'event'`), `cacheTtlMs`, `revalidateTimeoutMs`, `concurrency`                                                                                                             | `300`, `'disconnect'`, `60000`, `10000`, `8`                                           |

`sse.heartbeatMs` must be between 5,000 and 90,000 ms. Any other value, including `NaN` and a non-number, stops the application at start-up with `REALTIME_INVALID_OPTIONS`. `websocket.pingIntervalMs` and `websocket.pingTimeoutMs` must be integers from 1 to 2147483647 (Socket.IO runs both as timers, and Node runs a longer one as 1 ms). `sse.replayTtlMs` must be an integer from 1 to 2147483647 and `sse.replayMaxIdleUsers` an integer of 1 or more. `sse.maxQueuedBytes`, `sse.maxQueuedEvents` and `sse.stallHeartbeats` must be integers of 0 or more, and `0` switches that bound off.

#### Replay is per instance, and bounded

`Last-Event-ID` replay answers a client that reconnects **to the same instance**: the ring buffer is in that process's memory, and event ids are minted per instance, so replaying "after id N" from another instance's ring could skip or repeat events. Without sticky routing, a client that reconnects to a different instance gets the offline queue (when configured), not replay. The buffer keeps the events of users that have a connection on the instance or had one lately, and nothing for anyone else: a user that never connected there is not buffered, however many events are emitted to them. When a user's last connection closes the entry is kept for `sse.replayTtlMs` (default 300,000 ms), and no more than `sse.replayMaxIdleUsers` (default 1,000) such idle entries are kept at once, the one that closed longest ago going first. The ring of a user with a connection open is never evicted, and expiry is checked when the buffer is used, so there is no timer. The most it holds is (connections open + `replayMaxIdleUsers`) x `replayBufferSize` x the size of an event: with the defaults, 2,000 connected users and 1,000 idle ones, each ring full of 1 KB events, that is (2,000 + 1,000) x 100 x 1 KB, about 300 MB. Lower `replayBufferSize` or `replayMaxIdleUsers` to hold less.

#### Authentication is bounded

`authenticate` is called for every handshake, on both transports, and it is bounded two ways. A call that has not settled in `authenticateTimeoutMs` (default 10,000 ms) is given up on: the client is refused, with a `503` and the generic body on SSE and the generic `connect_error` on WebSocket, and the `AbortSignal` in the call's second argument is aborted so that a `fetch` or a query behind it can stop. At most `maxPendingHandshakes` (default 1,000) calls are waiting at once, across both transports, and a call keeps its place until it actually settles, not until the client was refused: an authenticator that never answers fills the limit, and every further handshake is then refused at once, without calling it, so a dependency that is down is not given a new call for every handshake. A consumer that honours the signal frees its place at once. The consequence is intended: a backend that stays slow keeps the limit full for as long as it stays slow, and new clients get a `503` until it answers or its calls end. Neither refusal is logged for each request: one line for each ten seconds says how many handshakes were refused and why, with nothing of the requests in it.

#### Hooks the library waits for

A hook is a notification: its failure is logged and nothing else changes. The library awaits some hooks, and gives up on each after `hookTimeoutMs` (default 5,000 ms; an integer from 1 to 2147483647, checked at start-up): `onDisconnect` on both transports and `onConnect` on WebSocket, which is awaited before the connection is announced. A hook that has not settled by then is logged as `did not settle within N ms` and abandoned, whatever it returns later. The other hooks are not waited for and have no limit. On SSE the client is cut first and `onDisconnect` runs after, so a slow hook cannot keep a connection open; on shutdown every connection is closed at once, so a hook that never settles delays closing the application by about one `hookTimeoutMs`, not by one per connection. A hook that needs longer than the timeout must hand its work off and return. A host whose `onConnect` does work the connection depends on can set `onConnectFailure: 'close'`: a failing `onConnect` then closes the connection, which on WebSocket is closed before `connection:established` is sent and on SSE is ended after the hook settles. On both transports `onConnect` is seen before the `onDisconnect` that follows it, and an event published while the hook runs may already have reached the client; scope a connection in `AuthenticationResult.rooms` when none may be missed. A connection that `'close'` refuses has also already displaced the user's oldest one when the user is at `maxConnectionsPerUser`: eviction happens at admission, before `onConnect`. On WebSocket the `reason` that `onDisconnect` receives is `CLIENT_DISCONNECT` for every connection, including one the server closed (`disconnect(connectionId, reason)` and `onConnectFailure: 'close'`), so it does not say who closed the connection; on SSE the reason is set when the library closed the connection with one (`disconnect(connectionId, reason)`, the connection bounds) and is `undefined` otherwise: a connection that ended on its own, one that `onConnectFailure: 'close'` refused, or one closed at shutdown.

#### The offline-queue read on a reconnect

A reconnect that carries `Last-Event-ID` reads the offline queue before its stream opens, so the read is part of the handshake, made with the authentication before the response is committed (so a refusal is a status even when the application registers an interceptor), and is bounded like it: a queue that has not answered in `authenticateTimeoutMs` (default 10,000 ms) is given up on, the client gets a `503` with the generic body, nothing is registered, and its place is given back. The events stay in the queue, since a read never prunes it. A queue that **fails** is not treated the same way: the error is reported and the client gets its live events with an empty gap. The timeouts are logged once for each ten seconds with a count.

The call to your store cannot be cancelled: `IOfflineQueueStorage.retrieveSince` takes no signal, so the call runs on and its late answer is ignored. It keeps its place until it settles, not until it was given up on: at most `maxPendingHandshakes` (default 1,000) offline reads are waiting at once, and a reconnect that finds them all taken gets the same `503` at once, without a call to your store. A store that hangs therefore fills that limit, instead of collecting one more open call for every reconnect, and the `503` lasts for as long as it stays hung or until its calls end. With `RedisOfflineQueue`, set `commandTimeout` on the ioredis client (for example `new Redis({ commandTimeout: 5000 })`) so that a hung Redis rejects those calls instead of holding them for ever.

The queue is read twice for one reconnect: with the authentication, before the response is committed, and again when the stream is built, for what was appended in between (an application interceptor that emits to the user, say: the user has no connection and no replay ring on this instance, so the event is in the queue and nowhere else). The second read starts after the last event the first returned, or after `Last-Event-ID` when it returned none, and the two share the one limit on the events of a reconnect, the same deadline for each read and the one count of reads waiting. What the first read came to decides whether there is a second, and two rules follow. **If your store failed on the first read**, the error is reported, the reconnect is served without a gap as an outage of the store has always been served, and there is no second read, so an outage does not turn every reconnect into a refusal. **If the first read succeeded**, any failure of the second, a timeout, a refusal by the count of reads waiting, or an error from your store, ends the attempt **before anything is delivered**: a stream built without those events would move the client's cursor past them with the next event it receives, and an attempt that delivers nothing leaves the cursor where it was, so the events are only delayed. A first read that timed out, or was refused by the count, ends the attempt with the `503` as before. The test `sse-subscription.handler.queue-reads.spec.ts` runs every combination of the two reads. Your store's `retrieveSince` has to return the events after an id in the same order as the ids, as `RedisOfflineQueue` does, or the second read is wrong too.

What the client then does depends on how the attempt ended, and no `Retry-After` is sent, so its own reconnect policy is the only pace:

| The server answers                              | When                                                    | A plain browser `EventSource`                                                                                                                                                                                                                    | The `useRealtimeSse` hook                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503` with the generic body                     | the response is not committed yet                       | The connection fails and the browser does **not** reconnect by itself. The application has to open a new `EventSource`, which cannot send `Last-Event-ID`, so what was missed is not replayed unless it adds the id to the url as `lastEventId`. | Reconnects after its backoff with a **new** `EventSource` that carries the last id it saw as the `lastEventId` query parameter: the events are replayed from there.        |
| `200`, then the stream ends with an error frame | an application interceptor committed the response first | Reconnects by itself and sends the last id it saw, so the events are read again.                                                                                                                                                                 | The browser reconnects with the id. If the hook's own backoff opens a new source first, that one carries the id as `lastEventId`, so either way the events are read again. |

An application that cannot lose events has to keep its own cursor and open the stream with it. The id is read from the `Last-Event-ID` header or, when the request has none, from the `lastEventId` query parameter, which is what `useRealtimeSse` sends (replacing a `lastEventId` the url you gave it already carries, once it has seen an event; the other parameters are then written again, so a key with no value gains an equals sign (`?flag` becomes `?flag=`), an encoded space is written as `+`, an empty parameter is dropped, an encoded `+` stays one, and a percent-encoded byte that is not valid UTF-8 is written as the replacement character, so `%FF` becomes `%EF%BF%BD` while a valid sequence such as `%E2%82%AC` is unchanged) and what an application adds to the url of a new `EventSource`; the header wins when both are present. An id longer than 256 characters, from either place, and a query value that is not a single string (a repeated parameter, say) are read as no id. The query parameter travels in the url, so it is written to access logs and caches with the rest of it; the ids this library generates are 20 characters (`{epoch ms}-{counter}`) and are not credentials.

#### How many connections one instance holds

`maxConnectionsPerUser` bounds one user; it does not bound an instance. `maxConnections` (default `10000`, an integer of 1 or more, with no value that switches it off) bounds the whole instance, counting the connections of both transports together and the handshakes admitted and not yet registered. A handshake that arrives when the instance already holds that many is refused before `authenticate` is called, so a flood of them costs the instance no call to your backend: a `503` with the generic body on SSE (no `Retry-After` is sent), the generic `connect_error` on WebSocket. The refusals are logged once for each ten seconds with a count, and nothing of the request is in the line. A place held for a handshake is given back when its connection is registered, or when its request or socket closes, whichever comes first, and in any case after `authenticateTimeoutMs` plus 5,000 ms, at the next handshake that asks for room, so a client that leaves half way, even on a framework that reports no close, does not use up the limit. A reconnect whose offline-queue read outlives its place takes one again before it registers, and its stream ends if the instance has filled in the meantime.

The place is given back on the response's `close` as Express reports it, and on the Node response behind a Fastify reply (`reply.raw`) or on the socket when that is where a framework reports it. This is tested on Express, over real HTTP; the Fastify reply shape is handled and unit-tested, but there is no Nest-on-Fastify test in this repository.

Set it **below the process's file-descriptor limit, less headroom**. Each connection holds a descriptor, and so do the listening socket, the files the process has open, and every connection to Redis, a database or another service. A limit of 10,000 on a process allowed 1,024 descriptors (the common default of `ulimit -n`) would run out of descriptors long before it refused anyone. Worked example: with `ulimit -n 65536` and about 500 descriptors for everything that is not a client connection, set `maxConnections` to 60,000 or less; with `ulimit -n 1024`, either raise the limit or set `maxConnections` to 800 or less. Check what the process really has with `cat /proc/<pid>/limits` or `ulimit -n` inside the container, since a container or a service manager often sets a different number from your shell.

The limit has a cost, and it is not a defence by itself. It trades a process that runs out of descriptors and stops serving, for one that refuses new connections while it is full: the clients it already has are served. Because it cannot evict, anyone who fills it, with many users or with a token minted for each request, keeps real clients out until their sockets close. Limits for each address, the rate of new connections and the number of connections at the proxy or the edge stay the controls that stop that, and this option is the last bound behind them.

#### A client that does not read

An SSE response writes one event at a time and waits for the client to read before the next, so everything behind that wait is held in server memory. Each connection is bounded: when the events and bytes sent to it and not yet taken by its socket pass `sse.maxQueuedEvents` or `sse.maxQueuedBytes` (an event that is alone in the queue is always taken, however large), or no byte has left the process for `sse.stallHeartbeats` heartbeats in a row while the response holds bytes, the connection is closed with the reason `REALTIME_SLOW_CONSUMER` and a warning is logged. Only that connection is closed; the client reconnects and `Last-Event-ID` replays what it missed. A connection whose response has no socket to measure is not bounded.

> [!NOTE]
> `maxConnectionsPerUser` defaults to `5` on both transports: a user's sixth connection closes their oldest, which is sent a disconnect. The oldest is closed when the new connection is admitted, before `onConnect` runs, so a connection that `onConnectFailure: 'close'` refuses has already displaced it. `0` switches the cap off. The cap, `replayBufferSize` and `websocket.maxHttpBufferSize` must be integers (`0` or more, and `1` or more for the payload bound) and have a most: 100,000 for the cap on either transport, 100,000 events for `replayBufferSize` (memory per user stream is that times the size of a frame), and 104,857,600 bytes (100 MiB) for `websocket.maxHttpBufferSize`, whose Socket.IO default is 1,000,000 bytes. `NaN`, `Infinity`, a fraction, a numeric string, a value past its most and any integer past 9,007,199,254,740,991 (`1e300`, `2 ** 53`) are refused at start-up, since a comparison with `NaN` is never true and a bound that large never trips. The cap is per user and does not bound the connections of an instance: many users, or a token minted per request, are bounded by your proxy or the process's file-descriptor limit, not by this option.

An option that holds `undefined` or `null` is read as unset: it takes its default, in the module options and in `sse`, `websocket` and `reauthenticationPolicy`, so `maxConnectionsPerUser: cond ? 3 : undefined` means the default cap of `5`, never no cap. Say `0` where `0` switches a bound off. A refusal of an option names the option and the type of what it received (`received a string`), prints a finite number, and echoes nothing else, so a value pasted into the wrong field does not reach a log.

The shape of what you pass is checked at start-up too, and refused with `REALTIME_INVALID_OPTIONS`: `sse`, `websocket`, `reauthenticationPolicy` and `hooks` must be objects; `pubsub`, `offlineQueue` and `presence` must have every function of their interface (`IRealtimePubSub`, `IOfflineQueueStorage`, `IPresenceStorage`), on the object or its prototype; each hook that is set and `tenantResolver` must be a function; `sse.emitConnectionEvent` and `websocket.emitConnectionEvent` must be booleans; `sse.endpoint` must be a non-blank string, with or without a leading slash. An endpoint holds no whitespace, because no request can reach it, and the `sseEndpoint` of `forRootAsync` gets the same check. The options argument must be an object, and so must what a `forRootAsync` factory returns; an array, a `Date` or a `Map` is refused there and where a group is expected, while an instance of your own class is read by its keys. `new RedisOfflineQueue(options)` refuses options that are not an object and a `client` that is not one.

The options are typed per entry point: `SseRealtimeModuleOptions` and `SseRealtimeModuleAsyncOptions` fix `transport: 'sse'`, and `WebSocketRealtimeModuleOptions` and `WebSocketRealtimeModuleAsyncOptions` (from `/websocket`) fix `'websocket' | 'both'`. `forRootAsync` takes `useFactory`, `useClass` (a `BymaxRealtimeModuleOptionsFactory`) or `useExisting`. A `useClass` or `useExisting` provider implements `createRealtimeOptions()`, which returns the options or a promise of them; a provider that does not is refused with `REALTIME_INVALID_OPTIONS`, as is an `extraProviders` that is not an array of providers (a class, or an object with `provide`). An options object, a group, a pluggable piece or a provider whose read throws, such as a getter or a proxy, is refused the same way, with the error it threw as the `cause`. The same holds for the keys of a `forRootAsync` registration and for an object that throws when its type is read, such as a proxy whose every read throws: it is refused as an object that could not be read, with the error it threw as the `cause`. A factory that returns the object itself is covered, including a proxy that throws on `then` or was revoked; one written as an `async` function rejects its own promise with the object's error, which reaches the application as that factory's failure. A refusal is recognised by its stable code, so an error of your own that carries a `REALTIME_` code is not wrapped.

> [!IMPORTANT]
> **`forRootAsync` takes the SSE route on the registration, not from the factory.** NestJS
> registers controllers at decoration time, before any factory has run, so `sse.endpoint`
> cannot move the route there. Declare it as `sseEndpoint` alongside `transport`:
>
> ```typescript
> BymaxRealtimeModule.forRootAsync({
>   transport: 'sse',
>   sseEndpoint: '/realtime/sse', // defaults to '/events'
>   inject: [ConfigService],
>   useFactory: (cfg: ConfigService) => ({ transport: 'sse', authenticator: ... }),
> })
> ```
>
> The async default is `'/events'`, not the `forRoot` default of `'/realtime/sse'`. A factory
> that returns a different `sse.endpoint` is **rejected at bootstrap** rather than ignored, and
> `REALTIME_OPTIONS_TOKEN` reports the route that was actually bound — so a health check or an
> OpenAPI document built from the options names the path that exists.

The design specification, [docs/technical_specification.md](./docs/technical_specification.md) §4, covers the options in depth. It was written against v0.1.0, so where it differs from this README or the CHANGELOG, those are current.

---

## 🏭 Running in Production

This section lists the bounds the library applies, what happens when each one is reached, and what an instance does when a dependency fails. A default is the value in the code. A behaviour stated here is one that a test or a measurement pins, and the `Evidence` column of the second table says which; where nothing pins a behaviour, the row says "not measured".

### Limits

| Bound                                                                              | Default                             | When it is reached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxConnections`                                                                   | 10,000                              | A handshake past it is refused before `authenticate` is called: SSE answers `503`, WebSocket answers the generic `connect_error`. Connections of both transports count together. See [How many connections one instance holds](#how-many-connections-one-instance-holds).                                                                                                                                                                                                                                                        |
| `maxPendingHandshakes`                                                             | 1,000                               | A handshake that finds that many `authenticate` calls waiting is refused at once, and `authenticate` is not called. A call whose handshake was refused for taking too long keeps its place while it is still open. See [Authentication is bounded](#authentication-is-bounded).                                                                                                                                                                                                                                                  |
| `authenticateTimeoutMs`                                                            | 10,000 ms                           | A handshake whose `authenticate` has not settled by then is refused: `503` with the generic body on SSE, the generic `connect_error` on WebSocket. A read of the offline queue for a reconnect that carries `Last-Event-ID` is given up on after the same time. See [The offline-queue read on a reconnect](#the-offline-queue-read-on-a-reconnect).                                                                                                                                                                             |
| `hookTimeoutMs`                                                                    | 5,000 ms                            | A hook the library awaits that has not settled by then is given up on, and the failure is logged as `did not settle within N ms`. See [Hooks the library waits for](#hooks-the-library-waits-for).                                                                                                                                                                                                                                                                                                                               |
| `reauthenticationPolicy.revalidateTimeoutMs`, `reauthenticationPolicy.concurrency` | 10,000 ms; 8                        | A `revalidate` call that has not settled by then is treated as one that threw, and its connection is revoked. At most `concurrency` calls run at once.                                                                                                                                                                                                                                                                                                                                                                           |
| `sse.maxQueuedEvents`, `sse.maxQueuedBytes`                                        | 1,000 events; 2,097,152 bytes       | An event that would take the events queued for a connection past `sse.maxQueuedEvents` is not queued; that connection is closed with the reason `REALTIME_SLOW_CONSUMER` and the others are not affected. The queue's counter refuses an event that would take the bytes past `sse.maxQueuedBytes`, unless that event is the only one queued. With the defaults, a client that never reads is closed with the same reason. [A client that does not read](#a-client-that-does-not-read) states the cases this row does not cover. |
| `sse.stallHeartbeats`                                                              | 3                                   | A connection whose socket has taken nothing for that many heartbeats in a row, while the response holds bytes, is closed with the reason `REALTIME_SLOW_CONSUMER`.                                                                                                                                                                                                                                                                                                                                                               |
| `sse.replayBufferSize`, `sse.replayTtlMs`, `sse.replayMaxIdleUsers`                | 100 events; 300,000 ms; 1,000 users | A user's ring keeps the newest `replayBufferSize` events and drops the older ones. An entry is dropped `replayTtlMs` after its user's last connection closed. At most `replayMaxIdleUsers` such entries are kept, and the one that closed longest ago goes first. See [Replay is per instance, and bounded](#replay-is-per-instance-and-bounded).                                                                                                                                                                                |
| Length of a `Last-Event-ID` header or `lastEventId` query value                    | 256 characters                      | An id longer than that is treated as absent: no replay and no offline-queue read is made for it. An id of exactly 256 characters is used. A longer header with a valid query value falls back to the query value.                                                                                                                                                                                                                                                                                                                |

### Known limits

**A host gateway that declares no namespace is served on `websocket.namespace`.** When `websocket.namespace` is set, the library binds its own gateway to that namespace of the application's one Socket.IO server, and a gateway of your own that declares no namespace is bound to the same one, behind the library's authenticator. Two consequences follow. A broadcast from that gateway without a room reaches every authenticated library socket, whatever its tenant. Clients that connect to `/` reach no handler. Give every host gateway a namespace of its own (`@WebSocketGateway({ namespace: 'chat' })`); a host gateway that declares one is served as it is declared, on the same engine. Moving host gateways back to the root is planned for a later release, because it changes where host clients connect.

### When a dependency fails

| Situation                                                                                         | What the instance does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE pub/sub: the Redis server refuses the SUBSCRIBE at start (wrong password, missing permission) | `subscribe` rejects with `REALTIME_PUBSUB_UNAVAILABLE`, and the boot fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | tested                                                                                                                                                      |
| SSE pub/sub: Redis is unreachable at start                                                        | The boot completes without waiting for Redis, the instance is not subscribed, one warning line is logged for the outage, not one for each retry, and the instance subscribes when Redis comes up.                                                                                                                                                                                                                                                                                                                                         | tested                                                                                                                                                      |
| Socket.IO Redis adapter: Redis never answers at start                                             | Creating the Socket.IO server returns and the Redis adapter is registered, without waiting for Redis.                                                                                                                                                                                                                                                                                                                                                                                                                                     | tested with a client whose commands never settle                                                                                                            |
| SSE pub/sub: the publishing client's first connection is slow                                     | `subscribe` waits for it, 2,000 ms at most; after that the boot completes and the instance is not subscribed.                                                                                                                                                                                                                                                                                                                                                                                                                             | tested                                                                                                                                                      |
| SSE pub/sub, Redis lost while running: a publish                                                  | It is refused at once with `REALTIME_PUBSUB_UNAVAILABLE` and is never sent when the connection returns.                                                                                                                                                                                                                                                                                                                                                                                                                                   | tested                                                                                                                                                      |
| SSE pub/sub, Redis connected but not answering: a publish                                         | It rejects with `REALTIME_PUBSUB_UNAVAILABLE` after 2,000 ms. The rejection means the server did not confirm the publish in time, not that it was not delivered: the command was already written to the socket, so Redis can still process it when it answers and an emit can arrive after it was reported failed. The command stays queued in the client until the server answers or the connection drops; set `commandTimeout` on your ioredis client (for example `new Redis({ commandTimeout: 5000 })`) to reject the command itself. | tested on a controlled clock; measured on 1.2.16, against a `redis:7-alpine` container paused with `docker pause`: rejected after 2,001, 2,003 and 2,005 ms |
| SSE pub/sub, Redis lost while running: `disconnect` of a connection this instance does not hold   | `disconnect` rejects at once with `REALTIME_PUBSUB_UNAVAILABLE`. `emitToUser` for a user with no connection on this instance, with no offline queue configured, resolves at once.                                                                                                                                                                                                                                                                                                                                                         | tested                                                                                                                                                      |
| SSE pub/sub, Redis lost while running: the subscriber                                             | One warning line is logged for an outage while its reconnects fail (several attempts over 400 ms in the test), and a `Subscribed` line is logged again when Redis returns.                                                                                                                                                                                                                                                                                                                                                                | tested                                                                                                                                                      |
| Redis is paused when an SSE application closes                                                    | The close waits at most 2,000 ms for the subscriber's QUIT, then disconnects it. `app.close()` settled in 2,003 ms.                                                                                                                                                                                                                                                                                                                                                                                                                       | measured on 1.2.15, against a `redis:7-alpine` container paused with `docker pause`; the bound is also pinned on a controlled clock                         |
| Redis is paused when an application with both transports closes                                   | The adapter's subscriber and the pub/sub subscriber are each waited for at most 2,000 ms, one after the other. `app.close()` settled in 4,007 ms.                                                                                                                                                                                                                                                                                                                                                                                         | measured on 1.2.15, against a `redis:7-alpine` container paused with `docker pause`; the two bounds are also pinned on a controlled clock                   |
| The offline queue does not answer                                                                 | A reconnect that carries `Last-Event-ID` gets a `503` with the generic body after `authenticateTimeoutMs`, and nothing is registered. A queue whose first read rejects gives an empty gap instead, and the client gets its live events. At most 1,000 reads wait at once by default; the next is refused without a call to the store.                                                                                                                                                                                                     | tested                                                                                                                                                      |
| The authenticator does not answer                                                                 | Handshakes are refused after `authenticateTimeoutMs`; once `maxPendingHandshakes` calls wait, further handshakes are refused at once.                                                                                                                                                                                                                                                                                                                                                                                                     | tested                                                                                                                                                      |
| A consumer hook never settles                                                                     | The library gives up on it after `hookTimeoutMs`. On WebSocket an `onConnect` that never settles delays the announcement of the connection until then, and an `onDisconnect` that never settles still removes the connection while the other client stays connected. When an application closes, five SSE streams whose `onDisconnect` never settles are released after one hook timeout of a test clock.                                                                                                                                 | tested                                                                                                                                                      |
| Memory over a long soak; behaviour at `maxConnections` on a real host                             | not measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | not measured                                                                                                                                                |

### Shutdown order

The Socket.IO server closes first, then the adapter's `dispose()` runs, and `dispose()` closes the adapter's own Redis subscriber connection. The pub/sub subscriber is unsubscribed in the application shutdown hook. When both transports run, the two Redis subscribers are closed in two successive phases, each waited for at most 2,000 ms. [Shutdown](#shutdown) describes how a shutdown starts.

### Observability

Everything here is optional. The root and the shared runtime import none of `@bymax-one/nest-core`, `prom-client` or `@opentelemetry/api` statically, so an application that publishes no metrics installs none of them.

Importing `@bymax-one/nest-realtime/observability` needs `@bymax-one/nest-core` and `prom-client`; without them the import fails with the runtime's own `Cannot find module` error, which names the missing peer.

**Metrics.** Register `RealtimeMetrics` in a module of your application; `BymaxCoreModule` discovers it and calls it once at bootstrap with the registry its scrape endpoint serves. It injects what the realtime module exports, so nothing else is wired.

```typescript
import { Module } from '@nestjs/common'
import {
  RealtimeMetrics,
  RealtimePubSubHealthIndicator,
} from '@bymax-one/nest-realtime/observability'

@Module({ providers: [RealtimeMetrics, RealtimePubSubHealthIndicator] })
export class ObservabilityModule {}
```

| Metric                                     | Type    | Labels                                                     | Meaning                                                                                                                                                                                   |
| ------------------------------------------ | ------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bymax_realtime_connections`               | gauge   | `transport` = `sse`, `websocket`                           | Connections open on this instance now.                                                                                                                                                    |
| `bymax_realtime_connections_refused_total` | counter | `reason` = `limit`, `unauthorized`, `unavailable`, `error` | Handshakes refused since start; `error` is one that failed with an unexpected error (a 500); a connection that `onConnectFailure: 'close'` closes was admitted first, and is not counted. |
| `bymax_realtime_evictions_total`           | counter | `reason` = `per_user_cap`, `slow_consumer`, `revoked`      | Connections closed by the library or by a revocation.                                                                                                                                     |
| `bymax_realtime_events_emitted_total`      | counter | `transport` = `sse`, `websocket`                           | Emit calls handled on this instance, not deliveries: a call with no recipient counts, and under `'both'` each transport counts it.                                                        |
| `bymax_realtime_slow_consumer_drops_total` | counter | none                                                       | Connections cut for not reading what they were sent.                                                                                                                                      |

A label is one of the values listed and never an id, a tenant or a user. A revocation is counted on the instance that was asked to make it, once it has closed the connection or handed the request to the bus.

**Health.** `RealtimePubSubHealthIndicator` (name `realtime-pubsub`) reports `down` when the bus says it is not subscribed, so what other instances publish no longer reaches this one. It reads the bus's own state, sends nothing and returns no detail. A bus that does not report its state, such as the in-memory one, counts as up.

**Traces.** With `@opentelemetry/api` installed the library starts `realtime.handshake` around the admission and authentication of each connection (attribute `bymax.realtime.transport`, `sse` or `websocket`) and `realtime.reauthenticate` around each re-authentication cycle. A refused handshake ends its span with status ERROR and the library error code, never the message. With no SDK registered the API is a no-op, and without the package nothing is started.

**Log events.** Every `warn` and `error` line the library writes is an object, `{ event, message, ...fields }`, with the error that caused a failure, when there is one, under `err` as the error itself and never as text in `message`; so a structured logger writes each as a JSON field and Nest's default logger prints the object. The fields are counts, sizes, configured limits, transport names and a library-made connection id; a user id, a tenant id or a room is never in a message or a field, because the logger's own context carries identity. Lines that report that the library started stay plain strings. A logger that throws while the library writes an event is absorbed: the line is lost and the call that was logging goes on. A logger whose method returns a rejected promise is not, because Nest's `Logger` discards what the method returns, so the rejection is an unhandled rejection of your process, which ends a Node process with exit code 1 unless the application handles `unhandledRejection`; such a logger has to catch its own failures.

| Event                                  | Level       | When                                                                                | Fields                                                                   |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `REALTIME_REAUTH_CACHE_WEAKENS_POLICY` | warn        | At start-up, `reauthenticationPolicy.cacheTtlMs` is longer than the interval.       | `cacheTtlMs`, `intervalMs`                                               |
| `REALTIME_HANDSHAKE_FAILED`            | error       | A handshake failed with an error that is not a refusal.                             | `socketId` (WebSocket)                                                   |
| `REALTIME_HOOK_FAILED`                 | warn, error | A lifecycle hook threw or did not settle within `hookTimeoutMs`.                    | `hook` where known                                                       |
| `REALTIME_DELIVERY_FAILED`             | warn        | A delivery failed without failing its call.                                         | `connectionId` or `code`, `op`                                           |
| `REALTIME_SLOW_CONSUMER`               | warn        | A connection was cut for not reading what it was sent.                              | `connectionId`, `queuedEvents`, `queuedBytes`, `heldBytes`               |
| `REALTIME_DISCONNECT_FAILED`           | warn        | Closing a connection failed.                                                        | `connectionId`                                                           |
| `REALTIME_RECONNECTS_GIVEN_UP`         | warn        | Reconnects were given up on because the offline queue did not answer (windowed).    | `count`, `timeoutMs`, `maxPending`                                       |
| `REALTIME_OFFLINE_QUEUE_LIMIT`         | warn        | A read of the offline queue reached its event limit.                                | `limit`                                                                  |
| `REALTIME_OFFLINE_QUEUE_ACK_FAILED`    | warn        | Acknowledging the offline queue failed.                                             | none                                                                     |
| `REALTIME_PUBSUB_NOT_PROVIDED`         | warn        | In production, no `IRealtimePubSub` was provided: single instance only.             | none                                                                     |
| `REALTIME_PUBSUB_UNSUBSCRIBE_FAILED`   | warn        | Unsubscribing from the bus failed at shutdown.                                      | none                                                                     |
| `REALTIME_PUBSUB_DROPPED`              | warn        | The bus dropped messages it could not act on (windowed).                            | `count`, `last`                                                          |
| `REALTIME_PUBSUB_UNAVAILABLE`          | warn        | The bus refused or lost the subscription; remote events do not reach this instance. | none                                                                     |
| `REALTIME_CONNECTIONS_REFUSED`         | warn        | Connections were refused at `maxConnections` (windowed).                            | `count`, `maxConnections`                                                |
| `REALTIME_HANDSHAKES_REFUSED`          | warn        | Handshakes were refused because the authenticator was saturated or slow (windowed). | `saturated`, `timedOut`, `maxPendingHandshakes`, `authenticateTimeoutMs` |
| `REALTIME_REAUTH_FAILED`               | warn        | A re-authentication cycle, a check or its notification failed.                      | `connectionId` where known                                               |
| `REALTIME_REVOCATION_FAILED`           | warn        | A revocation failed and is retried on the next cycle.                               | `connectionId`                                                           |
| `REALTIME_ADAPTER_MISSING`             | error       | `RealtimeIoAdapter` is not the active WebSocket adapter.                            | none                                                                     |
| `REALTIME_ADAPTER_COMMAND_FAILED`      | warn        | A command of the Redis adapter's subscriber failed (once for each connection).      | none                                                                     |
| `REALTIME_COMPOSITE_PARTIAL_FAILURE`   | warn        | One of the two transports failed an emit under `transport: 'both'`.                 | `op`                                                                     |
| `REALTIME_SERVER_NOT_ATTACHED`         | warn        | An emit was made before the WebSocket server was attached (once).                   | `op`                                                                     |

### Before you deploy

- File-descriptor limit against `maxConnections`: [How many connections one instance holds](#how-many-connections-one-instance-holds).
- Proxy buffering for SSE: [docs/proxies-cheat-sheet.md](./docs/proxies-cheat-sheet.md).
- Sticky sessions with the polling fallback: [docs/architecture/scaling-cheatsheet.md](./docs/architecture/scaling-cheatsheet.md#sticky-sessions--mandatory-for-polling-fallback).
- Replay is per instance: [Replay is per instance, and bounded](#replay-is-per-instance-and-bounded).
- HTTPS and CORS: [Security Checklist](#security-checklist).

---

## 🏗️ Architecture

The package runs **inside** your NestJS application as a dynamic module — not as a separate realtime server:

```
┌────────────────────────────────────────────────────┐
│              Your NestJS Application               │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │         @bymax-one/nest-realtime             │  │
│  │                                              │  │
│  │   RealtimeService  ──→  ITransport           │  │
│  │         │                 ├── SseTransport   │  │
│  │         │                 ├── WebSocket…     │  │
│  │         │                 └── Composite…     │  │
│  │         ↓                                    │  │
│  │   ConnectionRegistry ←→ RoomRegistry         │  │
│  └────────┬──────────────┬──────────────┬───────┘  │
│           │              │              │          │
│   ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼───────┐  │
│   │ IConnection  │ │ IRealtime  │ │ IOffline    │  │
│   │ Authenticator│ │ PubSub     │ │ QueueStorage│  │
│   │   (yours)    │ │ (optional) │ │ (optional)  │  │
│   └──────────────┘ └────────────┘ └─────────────┘  │
└────────────────────────────────────────────────────┘
              │                        │
       SSE (HTTP stream)        WebSocket (Socket.IO)
              └────────→ Browser ←─────┘
```

### Cross-Instance Emit Flow

An emit delivers locally **and** publishes once. Every other instance's subscriber re-emits through local-only paths (`emitToUserLocal`, …), so a message is never republished and cannot loop. Connection revocation crosses instances as an `op: 'disconnect'` message on the same channel.

Sizing guidance and adapter trade-offs are in [docs/architecture/scaling-cheatsheet.md](./docs/architecture/scaling-cheatsheet.md).

---

## 🔐 Security Model

### Auth Inversion

This library **never** verifies a JWT, hashes a password, or imports an authentication package. It calls `IConnectionAuthenticator.authenticate()` once per connection and trusts the `AuthenticationResult` you return.

This is a **structural guarantee**, not a guideline: an ESLint rule fails the lint step on any string literal under `src/` that names `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport` or `passport-*`, so a literal specifier is refused in every form of `import` and `require`.

The consequence is worth stating plainly: a credential-handling vulnerability cannot originate in this package, because the code that would contain it does not exist here. It also means **you** are responsible for the bridge — vulnerabilities in a bridge implementation belong to that project, as [SECURITY.md](./SECURITY.md) records.

### Handshake Patterns

| Pattern             | Transport | Credential source              | Notes                                                             |
| ------------------- | --------- | ------------------------------ | ----------------------------------------------------------------- |
| **HttpOnly cookie** | SSE + WS  | `ctx.cookies`                  | Recommended. The only pattern where the browser sends it for you. |
| **One-time ticket** | SSE + WS  | `ctx.query['ticket']`          | Short-lived, single-use. The gateway normalizes it to one string. |
| **Bearer header**   | WS only   | `ctx.headers['authorization']` | `EventSource` cannot send custom headers — SSE must not use this. |

```typescript
export class TicketAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly tickets: TicketStore) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticket = ctx.query['ticket']
    if (!ticket || Array.isArray(ticket)) return null
    return this.tickets.consume(ticket) // null when expired or already used
  }
}
```

A complete `@bymax-one/nest-auth` bridge is in [docs/examples/nest-auth-bridge.md](./docs/examples/nest-auth-bridge.md); the per-transport handshake differences are in [docs/architecture/auth-handshake-differences.md](./docs/architecture/auth-handshake-differences.md).

### WebSocket origin

`websocket.cors` sets the CORS response headers on Socket.IO's HTTP responses, so a browser decides whether a page may read a long-polling response. It does not refuse a connection, and a WebSocket upgrade is not subject to CORS: a browser sends the `Origin` header with the upgrade and the server answers it whatever the origin is. A page on any origin can therefore open a WebSocket to your server, and the browser attaches the user's cookies to it when they are sent cross-site.

What the host does about it:

- Refuse an origin you do not list in your `IConnectionAuthenticator`. `ctx.headers.origin` carries it on the WebSocket handshake; return `null` and the connection is refused with `REALTIME_AUTH_FAILED`. The authenticator runs once per connection and sees the headers of the first request: on a connection that starts on long polling and then upgrades, that is the polling `GET`, and the `Origin` of the upgrade is never read. A browser always sends `Origin` on a WebSocket handshake, so an absent one there means a client that is not a browser; on a same-origin long-polling `GET` a browser sends none. A host that refuses an absent `Origin` therefore needs `transports: ['websocket']` on the client and a refusal of `transport=polling` at the proxy, or it refuses its own same-origin users; a host that allows an absent `Origin` has no origin check on a connection that starts on polling.
- Set the session cookie `SameSite=Lax` or `SameSite=Strict`, so a browser does not send it with a cross-site WebSocket.
- Prefer a short-lived ticket in the handshake to an ambient cookie.
- Serve `transports: ['websocket']` on the client and refuse the long-polling handshake (`transport=polling`) at your proxy if the authenticator is to require an `Origin`: only the websocket handshake guarantees a browser sent one.

### Re-Authentication

Long-lived connections outlive short-lived tokens. `reauthenticationPolicy` revalidates on an interval and either drops the connection or emits `connection:reauthentication-failed` and then drops it, depending on `onFailure`. The connection is dropped even when that event cannot be sent: the event is a notification, and the failure to send it is logged. Successful checks are cached for `cacheTtlMs` so a busy connection is not revalidated on every event.

`revalidate` is bounded. At most `concurrency` calls run at once, across every cycle (a revocation that does not settle in `revalidateTimeoutMs` is given up on the same way, and tried again on the next cycle), and a connection with a call in flight is not asked again until it settles, so one slow connection cannot hold up the revocation of the others. A call that has not settled in `revalidateTimeoutMs` is treated exactly as one that threw: the connection is **revoked** (the `AbortSignal` in the call's third argument is aborted so the work behind it can stop, and whatever the call returns later is ignored). The consequence is that an auth backend that is down, or slower than the timeout, revokes every connection due for revalidation in that cycle, and those clients reconnect and are refused at the handshake until the backend recovers. Set `revalidateTimeoutMs` above your backend's p99. `intervalSeconds`, `revalidateTimeoutMs` and `concurrency` must be integers of 1 or more and `cacheTtlMs` an integer of 0 or more, and the two that feed a timer have a ceiling, because Node runs any timer longer than 2,147,483,647 ms as 1 ms (`revalidateTimeoutMs` at most 2147483647, `intervalSeconds` at most 2147483); anything else stops the application at start-up with `REALTIME_INVALID_OPTIONS`.

### Security Checklist

When integrating `@bymax-one/nest-realtime` in production, verify each of the following:

- The SSE endpoint is served over HTTPS — `Last-Event-ID` replays past events to whoever reconnects
- `tenantId` is derived from the authenticated result, never from a query parameter or request body
- Tickets are single-use and short-lived; `consume()` must be atomic under concurrency
- `websocket.cors.origin` is an explicit allowlist, not `true`, in any browser-facing deployment
- `websocket.cors` does not refuse a WebSocket upgrade: your `IConnectionAuthenticator` checks `ctx.headers.origin` and refuses an origin it does not list (see [WebSocket origin](#websocket-origin))
- `websocket.cors` with `credentials: true` also sets `origin`: a block with no `origin` key leaves Socket.IO's default, which answers `*`, and browsers refuse `*` together with credentials. An `origin` must be a string, a `RegExp`, a function, a list of strings and `RegExp`s, or a boolean (`true` answers every origin); `null`, `undefined` (as when its environment variable is missing) and any other kind are refused at boot, as is a `cors` that is neither absent nor `null` and not an object. A list holds at most 1,000 entries and is copied once at boot, so changing it later has no effect. Each plain `RegExp`, alone or in a list, is replaced at boot by one with the same pattern and flags except `g`. A `RegExp` that is not plain (a subclass, one with a property of its own, one from another realm), has the `y` flag or has a source over 1,000 characters is refused at boot, because a copy would lose its behaviour, or, for `y`, match anywhere in the origin and not only at its start: use a function origin for custom matching, or an anchored pattern. The reads of the options trust the built-ins as they were when the library was imported, so a program that changes them has to do it before importing the library, and a `sticky` accessor missing at that moment refuses every `RegExp`. An option you left out is absent, whatever was planted on `Object.prototype`: a key found only on a prototype that has no prototype of its own (which is what the root prototype of a realm is, in this realm or another) is not read, while a key the object holds itself, or that your own class prototype defines, is, and the resolved options and their groups have no prototype. The same holds for the methods the library reads from the authenticator, the hook table and the pubsub, offline queue and presence objects you pass: a method of the object itself or of its class is yours, one found only on such a prototype is not. The fields of the result your authenticator returns and the options a `forRootAsync` registration resolves to follow the same rule. The options the WebSocket server passes to `cors`, engine.io and Socket.IO follow it as well: each name they read that you left out is an own key that holds `undefined`, so a planted one is not read when a request is served. That includes the cookie, per-message deflate and HTTP compression options; an object you nest inside them (the zlib options of per-message deflate) is yours. The WebSocket server refuses to start, answers every request with a 500 and closes an open connection that sends a packet while `Object.prototype` holds any string key outside the standard set, or any symbol key (apart from the non-enumerable `Symbol.for('$$jest-protect-from-deletion')` that Jest puts there) or while one of those names no longer holds what it held when the library loaded (`Object.prototype.hasOwnProperty = 1`, say), or while one of them was not the expected kind when the library was imported; the error says how many keys there are, not what they are. The 500 body is `{"code":"REALTIME_TRANSPORT_UNAVAILABLE","count":N}`, written as text, so a planted `toJSON` cannot shape it. A built-in that the options, their validation and the admission of a connection call, replaced after the library loaded, is counted the same way and refused by the WebSocket guard, by `validateOptions` and by admission, with `REALTIME_TRANSPORT_UNAVAILABLE` and a count; replace built-ins (a polyfill, a patch) before importing the library. If the clean realm the check compares with cannot be made (a wrong-typed value planted under a name `vm` reads as an option, before the library loads), the library still loads and the server refuses to run, with a count of one, on every use. A process whose `hasOwnProperty` or `toString` was replaced before the library loaded is refused by the options path of the modules with `REALTIME_INVALID_OPTIONS`, which also fails closed. A key planted as `toJSON` or `data` corrupts the packets the server sends, and the Redis adapter reads `packet.nsp` off an object a decoder made: neither crashes, both need a key planted on a running server, and the checks above refuse the connection and the requests that follow. If your application adds a name of its own to `Object.prototype`, remove it. A pattern runs as written, so how it behaves on a hostile origin (a catastrophic backtrack, say) is your own to judge: the library bounds its source and nothing else. A function is your own code: its answers are trusted like those of any other function you hand over. `methods`, `allowedHeaders` and `exposedHeaders` are each a string or a list of at most 1,000 strings, every entry a string (a header token), and are copied once at boot like the origin list; `maxAge` is a whole number of seconds, zero or more, read once and handed to Socket.IO as written (anything else is refused at boot, naming the type), so changing the list or the block afterwards reaches nothing. Any other key of the block reaches Socket.IO as written, and none of them decides which origin is allowed. `websocket.cors` is the WebSocket transport's alone: the SSE endpoint is a plain HTTP GET, and which origins may read its answer is your application's `app.enableCors`. The library adds no CORS header to the SSE endpoint, with a key planted or not, but Nest does: a `cors` key planted on `Object.prototype` before `NestFactory.create` makes Nest answer every route, the SSE endpoint included, with that block, and an SSE-only host does not refuse to start as the WebSocket and both-transport hosts do. Keep untrusted data off `Object.prototype` before the application is created. `credentials` must be a boolean
- `maxConnectionsPerUser` is left at its default of `5` (or set) for WebSocket if clients are untrusted — `0` makes it unlimited
- Reserved event names are not reused for application events (see the [catalog](#reserved-events))

---

## 🛡️ Security Table

| Layer                 | Implementation                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Credential validation | Delegated entirely to your `IConnectionAuthenticator`                                              |
| Auth library imports  | None: an ESLint rule fails lint on a string literal naming an auth package in `src`                |
| Tenant isolation      | Room-scoped (`tenant:{id}`), resolved from the authenticated result                                |
| Connection revocation | `disconnect(connectionId)`, cross-instance; rejects if it cannot reach it                          |
| Credential expiry     | Interval re-authentication; a failure drops the connection, after an event if `onFailure: 'event'` |
| Connection flooding   | FIFO eviction per user: oldest closed, new admitted, never a 429                                   |
| SSE transport headers | `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`                                |
| WebSocket origin      | `cors` sets response headers only; your authenticator checks `ctx.headers.origin` (see above)      |

---

## 🧱 Tech Stack

<p>
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/RxJS-7-B7178C?style=flat-square&logo=reactivex&logoColor=white" alt="RxJS" />
  <img src="https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Redis-optional-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest&logoColor=white" alt="Jest" />
</p>

---

## 🧪 Testing & Quality

A realtime channel fails in ways that are hard to reproduce — dropped streams, races between reconnect and revocation, one instance not seeing another's emit. The suite is built so those failures are caught by a test, not by a user.

- ✅ **100% coverage** — statements, branches, functions, and lines, enforced as a release gate
- ✅ **100% mutation score** — zero survivors, gated by [Stryker](https://stryker-mutator.io/) with a break threshold of 100
- ✅ **Unit, integration and end-to-end suites** — the end-to-end ones drive real Socket.IO connections in-process
- ✅ **Cross-instance e2e** — real Redis pub/sub fan-out between two live instances, not a mocked channel
- ✅ **Bundle-size gate** — the SSE-only React bundle is measured on every build and fails over budget

```bash
pnpm test          # unit + integration
pnpm test:e2e      # end-to-end (single instance, no Redis needed)
pnpm test:cov:all  # 100% coverage gate
pnpm mutation      # Stryker mutation testing
pnpm build && pnpm size
```

Cross-instance e2e needs a Redis instance:

```bash
REDIS_URL=redis://localhost:6379 pnpm test:e2e
```

> [!NOTE]
> Line coverage proves a line _executed_ under test; mutation testing proves a test _would fail_ if that line were wrong. The full methodology and per-area breakdown are in [docs/mutation_testing_results.md](./docs/mutation_testing_results.md).

---

## 📖 API Reference

### RealtimeService

The unified emit API. Identical on every transport.

| Method                                | Description                               |
| ------------------------------------- | ----------------------------------------- |
| `emitToUser(userId, event, data)`     | Deliver to every connection of one user   |
| `emitToTenant(tenantId, event, data)` | Deliver to every connection in a tenant   |
| `emitToRoom(roomId, event, data)`     | Deliver to an arbitrary room              |
| `broadcast(event, data)`              | Deliver to every connected client         |
| `joinRoom(connectionId, roomId)`      | Add a connection to a room                |
| `leaveRoom(connectionId, roomId)`     | Remove a connection from a room           |
| `disconnect(connectionId, reason?)`   | Revoke a connection, cross-instance aware |

All methods return `Promise<void>`.

**Revocation is never best-effort.** `disconnect(connectionId)` resolves once the connection was closed on this instance or the revocation was handed to the bus (`IRealtimePubSub`). It **rejects**, with `error.code` set to a `RealtimeErrorCode`, when it could not: `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses the publish (`RedisRealtimePubSub` refuses at once while its Redis client is not ready, and after 2,000 ms when the client is ready but the server does not answer), `REALTIME_TRANSPORT_UNAVAILABLE` when the WebSocket server is not attached or its fan-out throws. Branch on the code, not the message; the error is Nest's `ServiceUnavailableException` (HTTP `503`) with `code` set, so a controller that lets it escape answers `503` with the generic body (see "What a client is told"). `error.message` and `error.cause` are not enumerable, so `JSON.stringify(error)` carries the generic response and the `code` only; `error.stack` and `util.inspect(error)` still carry the text of the driver or the broker, which belongs in your server logs and nowhere a client reads. A rejection means the connection may still be connected, so retry.

**Emits are at-most-once.** `emitToUser`, `emitToTenant`, `emitToRoom` and `broadcast` **resolve even when the publish to the other instances failed**; that failure is logged with `REALTIME_PUBSUB_UNAVAILABLE` and passed to the `onDeliveryFailure` hook, which is where to count it. An offline queue that could not keep an event for a user who is offline here is reported the same way, since another instance may have delivered it live; a failure on one transport of `'both'` is only logged. An emit rejects only when the event has no delivery path left: for `emitToUser`, the user is offline here, the queue failed, and the bus failed or cannot reach another instance (the default in-memory bus); with `'both'`, a failure on both transports rejects with `REALTIME_TRANSPORT_UNAVAILABLE`. A rejected emit is not proof that no client received it, so retry only where a duplicate is acceptable.

`joinRoom` and `leaveRoom` act on a connection **this instance holds**; for any other id they resolve and change nothing. A failure of the transport that holds the connection rejects the call. Both refuse a room id that starts with `user:`, `tenant:` or `connection:`, the names the library composes, and one that is not a non-empty string, with `REALTIME_AUTH_FAILED`; any other name is free-form.

**An instance must hear the others.** With `RedisRealtimePubSub`, a subscription the server refuses (a wrong password, a missing permission) **fails the boot**: retrying cannot fix it, and an instance that never hears a revocation must not look healthy. A Redis that is only unreachable does not block the boot. The instance starts, logs once that it is not subscribed, and subscribes when a connection succeeds. Until then, whenever the subscriber connection drops, and whenever the Redis client that publishes cannot publish, `isPubSubReady()` is false. A client built with `lazyConnect` is connected by the adapter. Put it in your readiness probe:

```ts
import { Injectable } from '@nestjs/common'
import { HealthIndicatorService } from '@nestjs/terminus'
import { RealtimeService } from '@bymax-one/nest-realtime'

@Injectable()
export class RealtimeHealthIndicator {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly indicators: HealthIndicatorService,
  ) {}

  check(key = 'realtime') {
    const indicator = this.indicators.check(key)
    return this.realtime.isPubSubReady()
      ? indicator.up()
      : indicator.down({ reason: 'not subscribed to the realtime bus' })
  }
}
```

`isPubSubReady()` is true for a bus that reports no state, such as the default in-memory one, and with `transport: 'websocket'`, which does not use the bus.

### ConnectionRegistry

Read-side view of live connections — useful for admin endpoints and metrics. The class also has `register` and `unregister`; those are the transports' own bookkeeping, so do not call them (a record you add has no stream or socket behind it).

| Method                           | Returns                                          |
| -------------------------------- | ------------------------------------------------ |
| `byUser(userId, transport?)`     | `ConnectionRecord[]` for one user                |
| `byTenant(tenantId, transport?)` | `ConnectionRecord[]` for one tenant              |
| `allByTransport(transport)`      | `ConnectionRecord[]` on `'sse'` or `'websocket'` |
| `get(connectionId)`              | `ConnectionRecord \| undefined`                  |
| `count()` / `countUsers()`       | Live connection count / distinct user count      |

### Contracts

| Interface                   | Required | Purpose                                                                                                               |
| --------------------------- | :------: | --------------------------------------------------------------------------------------------------------------------- |
| `IConnectionAuthenticator`  |    ✅    | Validate a connection, return `userId` / `tenantId`                                                                   |
| `IRealtimePubSub`           |    —     | Cross-instance fan-out for SSE                                                                                        |
| `IOfflineQueueStorage`      |    —     | Hold events for disconnected users                                                                                    |
| `IPresenceStorage`          |    —     | Contract only: the library never calls it; your code stores presence and emits `presence:online` / `presence:offline` |
| `IConnectionLifecycleHooks` |    —     | Fire-and-forget connect / disconnect / error callbacks                                                                |
| `ITransport`                |    —     | Implemented by the library; the seam every transport shares                                                           |

Reference implementations shipped: `InMemoryPubSub` (default), `RedisRealtimePubSub`, `RedisOfflineQueue`.

`RedisOfflineQueue` takes `maxPerUser` (default 500) and `ttlSeconds` (default 3600), each an integer: `maxPerUser` from 1 to 100,000 and `ttlSeconds` from 1 to 2,147,483,647. A value outside that is refused when the queue is constructed, with `REALTIME_INVALID_OPTIONS`, because Redis would otherwise turn it into a silent loss: see the changelog entry for what each value did.

#### Identity must be present or absent, never blank

`userId` must be a non-empty string, and `tenantId` either absent or a non-empty string. A connection whose authenticator, or whose `tenantResolver`, yields a blank one is **refused at bootstrap** as a server fault, not a `401`: blank is not missing. Every connection carrying `''` lands under the same registry key and joins the same `user:` or `tenant:` room, and a later emit reaches all of them. Whitespace counts as blank.

To place a connection in no tenant, **omit `tenantId`**. The runtime also accepts `undefined` or `null`, but whether those type-check depends on the consumer's `tsconfig` (`exactOptionalPropertyTypes` rejects `undefined`, `strictNullChecks` rejects `null`), so omission is the only form that compiles everywhere.

`tenantResolver` cannot clear a tenant. It receives the authenticator's own result, the object it returned and not a copy, so everything on it works as it does for the authenticator's code. The library keeps its own record of `userId`, `tenantId`, `roles`, `rooms` and `metadata`, built by name before the resolver runs and read the way JavaScript reads a property, so a field that a class default, `Object.create` or an accessor on the prototype supplies counts. What a resolver writes to the result does not change that record, which is another object; `roles`, `rooms` and `metadata` are shared, so a write inside them changes what the library keeps. Resolution is `tenantResolver?.(auth) ?? tenantId`, where `tenantId` is what the result held before the resolver ran, so a resolver returning `undefined` or `null` means "no opinion" and the authenticator's tenant stays. Decide the absent case in the authenticator.

A resolver that returns a promise is refused as a blank tenant, and the promise's rejection is handled so it cannot end the process. That handling reaches a native promise from any realm, a subclass, a promise with a `then` of its own, and a proxy whose `get` trap binds the promise's methods. It cannot reach a proxy with no traps, a proxy whose `catch` trap throws, or a promise whose species lookup throws, which is a `constructor` that is neither an object nor `undefined`, a `Symbol.species` that is neither a constructor nor `null` or `undefined`, or a getter for either that throws: `then` and `catch` run that lookup before attaching a handler, so such a promise's rejection is left to the process. A thenable that is not a promise is never asked for its `then`. Return a value from a resolver, not a promise.

#### Carrying handshake context into the hooks

`AuthenticationResult.metadata` is a free-form bag the library carries verbatim: it reaches
`ConnectionEventMeta.metadata` in the three hooks that receive that type — `onConnect`,
`onDisconnect` and `onReauthenticationFailed` — and is handed back to `revalidate` as part of
the original result. It is the only channel that crosses that boundary — `authenticate` sees
the request headers but no `connectionId` yet, and those hooks see the `connectionId` but not
the headers.

`onError` takes a narrower payload (`connectionId?`, `error`, `transport`) with neither `roles` nor `metadata`, because it can fire before authentication resolves.

```typescript
class TracingAuthenticator implements IConnectionAuthenticator {
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const claims = await verify(ctx.cookies['access_token'])
    if (!claims) return null
    // ctx.headers keys are lowercased; this is the only place the headers are visible.
    return { userId: claims.sub, metadata: { traceparent: ctx.headers['traceparent'] } }
  }
}

const hooks: IConnectionLifecycleHooks = {
  onConnect: (meta) => tracer.recordConnection(meta.connectionId, meta.metadata?.['traceparent']),
}
```

Like `roles`, it is a **connect-time snapshot**: a `revalidate` that keeps the connection alive
does not refresh it. The library never reads a key.

#### Joining rooms at admission

`AuthenticationResult.rooms` lists extra rooms (a workspace, a project) that the library joins
beside `user:` and `tenant:`, **before** the connection is announced:

```typescript
class WorkspaceAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly sessions: SessionStore) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const session = await this.sessions.find(ctx.cookies['sid'])
    if (!session) return null
    return { userId: session.userId, rooms: [`workspace:${session.workspaceId}`] }
  }
}
```

Scope a connection here, not by calling `joinRoom` from `onConnect`. On **SSE** the connection is live before `onConnect` runs and the hook is not awaited, so an event published to the room in that window is missed (room events have no replay), and a hook that throws is only logged as a warning, leaving the connection live and unscoped. On **WebSocket** the hook is awaited before `connection:established`, so no window is observable once the client is ready; `rooms` is still the right place. Neither hook behaviour changes.

A name must be a non-blank string of at most `ADMISSION_ROOM_LIMITS.MAX_ROOM_NAME_LENGTH`
characters and must not start with `user:`, `tenant:` or `connection:`; at most
`ADMISSION_ROOM_LIMITS.MAX_ROOMS` entries; duplicates join once. A result that breaks a rule
is refused like a blank `userId` — a server fault (500 on SSE, a generic `connect_error` on
WebSocket), not a 401 — and nothing is registered. The two limits are bounds against abuse, not
measurements, and they apply to this field only: `joinRoom` is not held to them.

The rooms are fixed at admission and handed back to `revalidate` in the original result. A
different set returned later is not re-synchronized; use `joinRoom` and `leaveRoom` for changes
during the connection.

#### Client address versus peer address

`authenticate` receives two addresses. On SSE `ip` is the address your application's
`trust proxy` setting produced, validated: `X-Forwarded-For` is never read directly, a header text
that is not an address is never returned, and `ip` is `''` when no channel carries an address.
Without `trust proxy` it is the peer. Only `remoteAddress` can be trusted without knowing that
setting:

| Field           | SSE                                                   | WebSocket           | Forgeable by the client                          |
| --------------- | ----------------------------------------------------- | ------------------- | ------------------------------------------------ |
| `ip`            | `req.ip`, which follows the app's `trust proxy` value | `handshake.address` | Only as far as `trust proxy` believes the header |
| `remoteAddress` | `req.socket.remoteAddress`                            | `handshake.address` | No                                               |

`remoteAddress` is the TCP peer, read from the socket and never from a header. Behind a reverse
proxy it is the proxy's address. Use it to decide whether a forwarded header such as
`X-Forwarded-Host` may be believed: read it only when `remoteAddress` is one of your proxies. It is
`undefined` when the socket reports no address, and an IPv4 peer can arrive in its IPv4-mapped form
(`::ffff:10.0.0.1`), which is passed through as reported.

`userAgent` is the raw `User-Agent` header, or `undefined` when the client sent none. Any client can
set it to anything, so it suits a log line and not a decision about who may connect.

### Rooms

| Room ID                | Used for                                        | Auto-joined                   |
| ---------------------- | ----------------------------------------------- | ----------------------------- |
| `user:{userId}`        | Every connection belonging to one user          | ✅ Always                     |
| `tenant:{tenantId}`    | Every connection in a tenant                    | ✅ When `tenantId` is present |
| `resource:{type}:{id}` | Per-resource events, e.g. `resource:invoice:42` | Manual — call `joinRoom`      |

```typescript
import { composeRoomId } from '@bymax-one/nest-realtime'

composeRoomId('USER', userId) // → "user:u_abc"
composeRoomId('TENANT', tenantId) // → "tenant:t_acme"
composeRoomId('RESOURCE', 'invoice', invoiceId) // → "resource:invoice:42"
```

`composeRoomId` joins its parts with `:` and escapes nothing, so `('a:b', 'c')` and `('a', 'b:c')` both give `resource:a:b:c` and land in the same room. Encode a part that comes from outside your code with `encodeURIComponent`, which escapes `:` and is sound for this separator only: `composeRoomId('RESOURCE', encodeURIComponent(type), encodeURIComponent(id))`.

A `resource:` room is not tenant-scoped: two tenants using the same type and id share it. When ids are only unique within a tenant, pass the tenant as its own encoded part rather than gluing it to the id with a separator that ids may contain, such as `-`.

`joinRoom` and `leaveRoom` refuse a room id that starts with `user:`, `tenant:` or `connection:`, and all three of `joinRoom`, `leaveRoom` and `emitToRoom` refuse an id that is not a non-empty string (an array, a `Set`, an object, a number, `null`), so a client-supplied value cannot put a connection in another user's or tenant's room. Each refusal is `REALTIME_AUTH_FAILED`. `emitToRoom` does not refuse the prefixes: it can send to such a name, which only reaches that user's or tenant's own connections, so authorise who may emit before you pass it a client-supplied id.

#### Role-scoped delivery

There is no `emitToRole`. Roles are the consumer's authorization vocabulary, not
the transport's — the library carries them through without interpreting them (see
[Auth Inversion](#auth-inversion)). To deliver to a subset of connections by role,
build a room for it in `onConnect` (a room that must hold from the first event belongs in
[`rooms`](#joining-rooms-at-admission) instead), where `ConnectionEventMeta.roles` carries the
snapshot the authenticator produced:

```typescript
import { ModuleRef } from '@nestjs/core'
import { BymaxRealtimeModule, RealtimeService } from '@bymax-one/nest-realtime'

BymaxRealtimeModule.forRootAsync({
  transport: 'sse',
  inject: [ModuleRef],
  useFactory: (moduleRef: ModuleRef) => ({
    transport: 'sse' as const,
    authenticator: new CookieAuthenticator(),
    hooks: {
      onConnect: async (meta) => {
        if (!meta.roles?.includes('admin')) return
        // Resolved lazily: the hook runs per connection, long after bootstrap, so
        // `RealtimeService` — provided by this very module — cannot be injected
        // into the factory that configures it.
        const realtime = moduleRef.get(RealtimeService)
        await realtime.joinRoom(meta.connectionId, 'role:admin')
      },
    },
  }),
})
```

Then deliver to exactly those connections from any provider that injects
`RealtimeService`:

```typescript
await this.realtime.emitToRoom('role:admin', 'audit.log', entry)
```

`meta.roles` is a snapshot taken at connect time; a later `revalidate` that keeps
the connection alive does not refresh it. When a role can be revoked mid-session,
make `revalidate` return `false` so the connection is torn down and re-established
with the new roles.

> [!NOTE]
> Match roles by exact membership. `roles?.some((r) => r.includes('admin'))` admits `administrator` and `superadmin`, which fails open as an authorization leak.

### Reserved Events

These names belong to the library. Do not reuse them for application events. They are exported from `/shared` as `RESERVED_EVENT_NAMES` and `PRESENCE_EVENT_NAMES` (type `PresenceEventName`).

**Emitted today**

| Event                                | Meaning                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `connection:established`             | Handshake accepted (suppress via `emitConnectionEvent`) |
| `connection:reauthentication-failed` | Credentials no longer valid                             |

**Reserved, not emitted by the library.** An application may emit them itself; the library never does. The default SSE client subscribes to all of them except `error`. The browser dispatches a server-sent `error` event to the same handler as its own connection failures, so do not emit `error` over SSE: the client treats it as a dropped connection.

| Event                                  | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `connection:credential-expiring`       | Credential nearing expiry                                            |
| `room:joined` / `room:left`            | Room membership changed                                              |
| `error`                                | Transport-level error                                                |
| `presence:online` / `presence:offline` | Presence changed; emitted by your code, `IPresenceStorage` is a seam |

> [!NOTE]
> The SSE heartbeat is a `: keepalive` **comment line**, not a named event. It never appears in the `Last-Event-ID` id-space and never reaches a client listener.

### Error Codes

| Code                               | Status                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REALTIME_INVALID_OPTIONS`         | Raised at bootstrap for an invalid option                                                                                                                                                                                                |
| `REALTIME_NO_AUTHENTICATOR`        | Raised at bootstrap when the authenticator is missing or invalid                                                                                                                                                                         |
| `REALTIME_AUTH_FAILED`             | Raised when authentication is refused: the SSE 401 body and the WebSocket handshake refusal                                                                                                                                              |
| `REALTIME_REAUTHENTICATION_FAILED` | Raised when a revalidation fails                                                                                                                                                                                                         |
| `REALTIME_SLOW_CONSUMER`           | Raised as the reason an SSE connection is closed because its client is not reading                                                                                                                                                       |
| `REALTIME_TOO_MANY_CONNECTIONS`    | Raised as the reason an evicted connection is closed                                                                                                                                                                                     |
| `REALTIME_INVALID_TICKET`          | Reserved, never raised today: a ticket store is yours to write                                                                                                                                                                           |
| `REALTIME_PUBSUB_UNAVAILABLE`      | Raised as the rejection of a disconnect when the bus refuses the revocation; an emit's publish failure is logged and passed to the delivery-failure hook                                                                                 |
| `REALTIME_TRANSPORT_UNAVAILABLE`   | Raised as the rejection of a disconnect when the WebSocket transport fails or has no server attached, and of an emit that has no delivery path left. Also what a stream or handshake that arrives during shutdown is refused with, below |
| `REALTIME_REDIS_ADAPTER_FAILED`    | Raised at bootstrap when the Redis adapter is configured and cannot be installed                                                                                                                                                         |
| `REALTIME_PAYLOAD_TOO_LARGE`       | Reserved, never raised today                                                                                                                                                                                                             |
| `REALTIME_REPLAY_BUFFER_MISS`      | Reserved, never raised today                                                                                                                                                                                                             |

### What a client is told

The code travels on the error you catch; what reaches a client is decided by the status below, and it carries none of the text an operator reads.

| Failure                                                                                                       | SSE (HTTP)                                                         | WebSocket (`connect_error`)                                   | A call you make (`emitToUser`, `disconnect`, ...)                                |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `authenticate` returns nothing                                                                                | `401`, `REALTIME_AUTH_FAILED`                                      | message `REALTIME_AUTH_FAILED`, `data.code` the same          |                                                                                  |
| `authenticate` is unavailable: it timed out, or `maxPendingHandshakes` calls are already waiting              | `503`, generic body                                                | generic message, `data.code` `REALTIME_TRANSPORT_UNAVAILABLE` |                                                                                  |
| The instance is full (`maxConnections`)                                                                       | `503`, generic body                                                | generic message, `data.code` `REALTIME_TRANSPORT_UNAVAILABLE` |                                                                                  |
| The offline queue did not answer, or its reads are all taken                                                  | `503`, generic body                                                | not read on this transport                                    |                                                                                  |
| Shutdown has begun                                                                                            | `503`, message `REALTIME_TRANSPORT_UNAVAILABLE`                    | message and `data.code` `REALTIME_TRANSPORT_UNAVAILABLE`      |                                                                                  |
| `authenticate` throws anything else, or returns a blank identity or rooms that break the rules                | `500`, generic body (an `HttpException` you throw passes as it is) | generic message, no `data.code`                               |                                                                                  |
| The call has no path left: an emit with no delivery path, a revocation the bus refuses, a server not attached | n/a                                                                | n/a                                                           | rejects with `ServiceUnavailableException` (`503`), `error.code` the stable code |

The rejection of a call is Nest's own `ServiceUnavailableException`, so a controller that lets it escape answers `503` with the body `{"statusCode":503,"message":"Service Unavailable"}`. The library's message, which names the failed call, and the `cause`, which can hold a driver's text with a host and credentials, are on the instance for your logs and never in the response. Branch on `error.code`, not on the message.

Nest's default exception filter does not log an `HttpException`, so a `503` from one of these calls leaves no line in your log, where a plain `Error` was logged with its stack. To keep a record, catch `ServiceUnavailableException` in an exception filter of your own and log `exception.code`, `exception.message` and `exception.cause`, as you would for any other `HttpException` you want to see. With `@bymax-one/nest-core` 1.6.10 and an `IUnexpectedErrorSink` bound, such a `503` reaches the sink with its `cause`, once for each status and code in each `envelope.serverErrorWindowMs` window (60 s by default), so the outage is recorded there without a filter of your own; the cause can carry a host and a port, so redact it in your logger.

**An authenticator that wants a `503` throws `ServiceUnavailableException`.** On SSE an `HttpException` thrown from `authenticate` is sent as it is, so `throw new ServiceUnavailableException()` answers `503`; any other error answers a generic `500`. On WebSocket the handshake carries no HTTP status: an authenticator's own exception is answered with the generic message and no `data.code`. Only the library's own unavailable refusals carry `REALTIME_TRANSPORT_UNAVAILABLE`, which a client can treat as retryable.

### Shutdown

From the `onModuleDestroy` phase on, which runs ahead of every `beforeApplicationShutdown`, a new SSE stream gets a 503 whose message is `REALTIME_TRANSPORT_UNAVAILABLE` and a new WebSocket handshake gets a `connect_error` whose `data.code` is that code. A slow `onModuleDestroy` in a module nearer the root than the realtime module still runs first, and until it returns a connection is accepted.

A client that stopped reading holds its socket open after the library has ended its stream, and Node's HTTP server waits for it: `app.close()` took 6,004 ms with such clients and 3 ms with `forceCloseConnections: true`. Create the application with `NestFactory.create(AppModule, { forceCloseConnections: true })`, or give the process a termination grace of at least 7 seconds.

### Types and constants

Every name below is exported; the subpath says where to import it from. A type is erased at run time, a constant is a value.

**Options.** `BymaxRealtimeModuleOptions` is the configuration of `forRoot`, and `BymaxRealtimeModuleAsyncOptions` that of `forRootAsync` (`useFactory`, `useClass`, `useExisting`, `inject`, `imports`, `sseEndpoint` and `extraProviders`, the providers to register beside the module, for instance an authenticator class that Nest manages). `SseOptions` and `WebSocketOptions` are the `sse` and `websocket` groups, `ReauthenticationPolicy` is `reauthenticationPolicy`, and `CorsConfig` is the CORS configuration of the WebSocket transport. `RedisOfflineQueueOptions` and `RedisRealtimePubSubOptions` configure the two Redis implementations that ship with the package.

**What a hook or an authenticator receives.** `AuthenticatorCallOptions` is what `authenticate` and `revalidate` are handed besides their subject. `DeliveryFailure` is what `onDeliveryFailure` receives when a delivery path failed without failing the call that depended on it. `PublicConnectionMeta` is the public-facing metadata of one connection.

**Events and rooms** (from `@bymax-one/nest-realtime/shared`). `RealtimeEvent` is the shape of an event over a transport (`id`, `type` and `data`) and `ReservedEventName` the union of the names the library reserves. `ROOM_PREFIXES` is the table of canonical room prefixes and `RoomPrefix` the union of its values. `TransportMode` is `'sse' | 'websocket' | 'both'`. `REALTIME_ERROR_CODES` is the table of the stable error codes, such as `REALTIME_AUTH_FAILED`.

**Queues and the bus.** `OfflineQueuedEvent` is one event held in a user's offline queue, and `RealtimePubSubMessage` is one message that crosses instances.

**Members of the contracts you implement.**

- `IOfflineQueueStorage`: `append` stores an event for a user, `retrieveSince` reads the ones after an id, and `acknowledge` marks events delivered up to an id, which an implementation may purge or keep.
- `IPresenceStorage`: `setOnline` and `setOffline` record a connection, `isOnline` answers for a user, `listOnlineByTenant` lists a tenant's online users and `countOnline` counts everyone.
- `IRealtimePubSub`: `publish` sends to the other instances, `subscribe` receives, and the optional `isSubscribed` says whether this instance is subscribed now. A bus that cannot be unsubscribed once subscribed omits it and counts as subscribed; the health indicator reads it.
- `ITransport`: `kind` names the transport, `'sse'` or `'websocket'`; the optional `onModuleInit`, `beforeApplicationShutdown` and `onApplicationShutdown` are called by Nest on bootstrap and on shutdown, the second before the HTTP server closes.

### DI Tokens

`REALTIME_OPTIONS_TOKEN` · `REALTIME_TRANSPORT_TOKEN` · `REALTIME_AUTHENTICATOR_TOKEN` · `REALTIME_PUBSUB_TOKEN` · `REALTIME_OFFLINE_QUEUE_TOKEN` · `REALTIME_PRESENCE_TOKEN` · `REALTIME_HOOKS_TOKEN` · `REALTIME_INSTANCE_ID_TOKEN`

### React Hooks

| Hook                             | Returns                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `useRealtime(options)`           | `{ transport, connected, events, lastEvent, error, reconnectAttempts, reconnect, emit }` — opens the connection                             |
| `useRealtimeContext()`           | The same value, from the nearest `<RealtimeProvider>` — throws when used outside one                                                        |
| `useRealtimeConnection(options)` | `{ connected, error, reconnectAttempts, reconnect }` — status only, no events array                                                         |
| `usePresence()`                  | `UsePresenceReturn`: `{ onlineUserIds, isOnline(userId), count }` — reads `presence:*` events from the provider; your server must emit them |

`RealtimeProvider` takes a single `options` prop of type `UseRealtimeOptions`:

| Option               | Type                             | Default       | Notes                                               |
| -------------------- | -------------------------------- | ------------- | --------------------------------------------------- |
| `url`                | `string`                         | — (required)  | `ws://` or `wss://` selects WebSocket automatically |
| `transport`          | `'auto' \| 'sse' \| 'websocket'` | `'auto'`      | Overrides URL-scheme detection                      |
| `eventNames`         | `readonly string[]`              | —             | **SSE only** — application event names to subscribe |
| `withCredentials`    | `boolean`                        | `false`       | **SSE only** — send cookies cross-origin            |
| `auth`               | `{ ticket?, token? }`            | —             | **WebSocket only** — handshake credentials          |
| `path`               | `string`                         | `/socket.io`  | **WebSocket only** — Socket.IO path                 |
| `reconnectInitialMs` | `number`                         | `1000`        | **SSE only** — initial backoff                      |
| `reconnectMaxMs`     | `number`                         | `30000`       | **SSE only** — backoff ceiling                      |
| `maxAttempts`        | `number`                         | — (unlimited) | **SSE only** — give up and close after N failures   |

> [!NOTE]
> `emit` is WebSocket-exclusive — SSE is server → client only — and the server ignores what it sends: `RealtimeGateway` registers no message handlers, so receiving client events needs a gateway of your own. `reconnectAttempts` is always `0` on WebSocket, where Socket.IO owns the retry policy and exposes no count.

---

## 🚫 What This Library Does NOT Do

- **Authenticate.** It holds no credential logic. The strength of your realtime auth is the strength of the `IConnectionAuthenticator` you plug in.
- **Guarantee delivery.** Emits are at-most-once, with no acknowledgement. `Last-Event-ID` replay and the offline queue are SSE-only and bounded.
- **Track presence.** `IPresenceStorage` is a seam the library never calls, and `presence:*` events are emitted by your code.
- **Receive client messages.** `RealtimeGateway` registers no message handlers, so a WebSocket client's `emit` is ignored unless you write a gateway.
- **Route by role.** There is no `emitToRole`; build a room from `ConnectionEventMeta.roles` (see [Role-scoped delivery](#role-scoped-delivery)).
- **Configure your proxy.** SSE needs response compression and proxy buffering off and an idle timeout above `sse.heartbeatMs`; the library sends `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`. WebSocket with the polling fallback needs sticky sessions. See [docs/proxies-cheat-sheet.md](./docs/proxies-cheat-sheet.md).
- **Run a separate server.** It runs inside your NestJS application.

---

## 🤝 Contributing

Please open an issue to discuss substantial changes before a pull request. Clone the repository, run `pnpm install`, and keep the full gate green:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public issue. Instead, email us at **support@bymax.one** with details. We take security seriously and will respond promptly. Full policy and scope: [SECURITY.md](./SECURITY.md).

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
