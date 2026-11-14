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

One package, four entry points — import only what your app needs:

| Subpath       | Import                               | Purpose                                        |                           Dependencies                            |
| ------------- | ------------------------------------ | ---------------------------------------------- | :---------------------------------------------------------------: |
| **Server**    | `@bymax-one/nest-realtime`           | NestJS module for SSE, services, contracts     |                          NestJS 11, rxjs                          |
| **WebSocket** | `@bymax-one/nest-realtime/websocket` | NestJS module for `'websocket'` and `'both'`   | + `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` |
| **Shared**    | `@bymax-one/nest-realtime/shared`    | Types, room prefixes, event names, error codes |                               None                                |
| **React**     | `@bymax-one/nest-realtime/react`     | Hooks & `RealtimeProvider`                     |                             React 19                              |

```
       shared (zero deps)
      ↗        ↑        ↖
 server    websocket    react
```

`/websocket` also exports `RealtimeGateway`, `WebSocketTransport` and `CompositeTransport`. They are exported for the module's own wiring and for tests: applications register `BymaxRealtimeWebSocketModule` and install `RealtimeIoAdapter`, and do not construct them.

**The `websocket` subpath exists so the server one costs nothing extra.** Everything that touches `@nestjs/websockets`, `@nestjs/platform-socket.io` and `socket.io` is reachable only through it, so an SSE application never installs the Socket.IO stack. Importing it is what opts in.

The package also exposes `@bymax-one/nest-realtime/internal`. It is **not public API** and carries no compatibility promise — it is the shared runtime the two server subpaths import so that a service registered through one and injected through the other is the same class. Import the four above; nothing you need is only there.

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

This is the only interface you are required to provide. The library calls it once per connection and never inspects the credential itself.

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

WebSocket lives behind its own subpath, so an SSE application never installs the Socket.IO stack. Install its peers (see [Install](#1-install)), then do two things: register `BymaxRealtimeWebSocketModule` from `/websocket` instead of `BymaxRealtimeModule`, and install `RealtimeIoAdapter` in `main.ts`.

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
> The `main.ts` line is not optional. `RealtimeIoAdapter` is what applies `websocket.cors`, `namespace`, `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize` and `redisAdapter`. Without it those options are ignored, the gateway's own CORS stays closed (`origin: false`) so a browser on another origin cannot connect, and the module logs this error once at start-up:

```
RealtimeIoAdapter is not the active WebSocket adapter, so the websocket options are ignored and the gateway CORS stays closed (origin: false): browsers on another origin cannot connect. Add app.useWebSocketAdapter(new RealtimeIoAdapter(app)) in main.ts, importing it from '@bymax-one/nest-realtime/websocket'.
```

With `redisAdapter`, the adapter registers `@socket.io/redis-adapter` and calls `pubClient.duplicate()` for the subscriber; the library never opens its own Redis connection. If it cannot be installed (the package is missing, the client has no `duplicate()`), the boot fails with `REALTIME_REDIS_ADAPTER_FAILED` instead of serving a single instance; a Redis that is merely unreachable does not fail the boot. Socket.IO's polling fallback needs sticky sessions even then — see [docs/architecture/scaling-cheatsheet.md](./docs/architecture/scaling-cheatsheet.md). On the frontend, a `ws://` or `wss://` `url` selects WebSocket in `RealtimeProvider`. Replay through `Last-Event-ID` and the offline queue are SSE features: a WebSocket connection has neither.

---

## ⚙️ Configuration

All options are passed to `forRoot()` / `forRootAsync()`. Only `transport` and `authenticator` are required.

| Group                      | Key Options                                                                                                                                                                                                       | Default                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **transport**              | `'sse'` \| `'websocket'` \| `'both'`                                                                                                                                                                              | — (**required**)                                                                       |
| **authenticator**          | `IConnectionAuthenticator`                                                                                                                                                                                        | — (**required**)                                                                       |
| **tenantResolver**         | `(auth) => string \| undefined \| null` — derives `tenantId` from the auth result, on **both** transports; `undefined` and `null` mean "no opinion" and fall back                                                 | `auth.tenantId`                                                                        |
| **hooks**                  | `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed`, `onDeliveryFailure` (fire-and-forget)                                                                                                         | —                                                                                      |
| **hookTimeoutMs**          | How long the library waits for a hook it awaits (`onDisconnect` on both transports, WebSocket `onConnect`) before giving up on it; integer from 1 to 2147483647                                                   | `5000`                                                                                 |
| **authenticateTimeoutMs**  | How long a handshake waits for `authenticate` before it is refused (SSE `503`, WebSocket the generic error); integer from 1 to 2147483647                                                                         | `10000`                                                                                |
| **maxPendingHandshakes**   | How many calls to `authenticate` may be waiting at once, across both transports; over it a handshake is refused at once without calling it; integer >= 1                                                          | `1000`                                                                                 |
| **maxConnections**         | How many connections one instance holds, both transports together; a handshake past it is refused before `authenticate` is called (SSE `503`, WebSocket the generic error); integer >= 1, no way to switch it off | `10000`                                                                                |
| **pubsub**                 | `IRealtimePubSub` — cross-instance fan-out for SSE                                                                                                                                                                | `InMemoryPubSub`                                                                       |
| **offlineQueue**           | `IOfflineQueueStorage` — events held while a user is away                                                                                                                                                         | — (disabled)                                                                           |
| **presence**               | `IPresenceStorage` — contract for your own presence tracking; the library never calls it                                                                                                                          | — (disabled)                                                                           |
| **sse**                    | `endpoint`, `heartbeatMs`, `replayBufferSize`, `replayTtlMs`, `replayMaxIdleUsers`, `maxConnectionsPerUser`, `emitConnectionEvent`, `maxQueuedBytes`, `maxQueuedEvents`, `stallHeartbeats`                        | `/realtime/sse`, `30000`, `100`, `300000`, `1000`, `5`, `true`, `2097152`, `1000`, `3` |
| **websocket**              | `namespace`, `cors`, `maxHttpBufferSize`, `pingIntervalMs`, `pingTimeoutMs`, `maxConnectionsPerUser`, `emitConnectionEvent`, `redisAdapter`                                                                       | `'/'`, — (Socket.IO defaults), `5` for `maxConnectionsPerUser`                         |
| **reauthenticationPolicy** | `intervalSeconds`, `onFailure` (`'disconnect'` \| `'event'`), `cacheTtlMs`, `revalidateTimeoutMs`, `concurrency`                                                                                                  | `300`, `'disconnect'`, `60000`, `10000`, `8`                                           |

`sse.heartbeatMs` must be between 5,000 and 90,000 ms. Any other value, including `NaN` and a non-number, stops the application at start-up with `REALTIME_INVALID_OPTIONS`. `websocket.pingIntervalMs` and `websocket.pingTimeoutMs` must be integers from 1 to 2147483647 (Socket.IO runs both as timers, and Node runs a longer one as 1 ms). `sse.replayTtlMs` must be an integer from 1 to 2147483647 and `sse.replayMaxIdleUsers` an integer of 1 or more. `sse.maxQueuedBytes`, `sse.maxQueuedEvents` and `sse.stallHeartbeats` must be integers of 0 or more, and `0` switches that bound off.

#### Replay is per instance, and bounded

`Last-Event-ID` replay answers a client that reconnects **to the same instance**: the ring buffer is in that process's memory, and event ids are minted per instance, so replaying "after id N" from another instance's ring could skip or repeat events. Without sticky routing, a client that reconnects to a different instance gets the offline queue (when configured), not replay. The buffer keeps the events of users that have a connection on the instance or had one lately, and nothing for anyone else: a user that never connected there is not buffered, however many events are emitted to them. When a user's last connection closes the entry is kept for `sse.replayTtlMs` (default 300,000 ms), and no more than `sse.replayMaxIdleUsers` (default 1,000) such idle entries are kept at once, the one that closed longest ago going first. The ring of a user with a connection open is never evicted, and expiry is checked when the buffer is used, so there is no timer. The most it holds is (connections open + `replayMaxIdleUsers`) x `replayBufferSize` x the size of an event: with the defaults, 2,000 connected users and 1,000 idle ones, each ring full of 1 KB events, that is (2,000 + 1,000) x 100 x 1 KB, about 300 MB. Lower `replayBufferSize` or `replayMaxIdleUsers` to hold less.

#### Authentication is bounded

`authenticate` is called for every handshake, on both transports, and it is bounded two ways. A call that has not settled in `authenticateTimeoutMs` (default 10,000 ms) is given up on: the client is refused, with a `503` and the generic body on SSE and the generic `connect_error` on WebSocket, and the `AbortSignal` in the call's second argument is aborted so that a `fetch` or a query behind it can stop. At most `maxPendingHandshakes` (default 1,000) calls are waiting at once, across both transports, and a call keeps its place until it actually settles, not until the client was refused: an authenticator that never answers fills the limit, and every further handshake is then refused at once, without calling it, so a dependency that is down is not given a new call for every handshake. A consumer that honours the signal frees its place at once. The consequence is intended: a backend that stays slow keeps the limit full for as long as it stays slow, and new clients get a `503` until it answers or its calls end. Neither refusal is logged for each request: one line for each ten seconds says how many handshakes were refused and why, with nothing of the requests in it.

#### Hooks the library waits for

A hook is a notification: its failure is logged and nothing else changes. Three hooks are awaited by the library, and each is given up on after `hookTimeoutMs` (default 5,000 ms; an integer from 1 to 2147483647, checked at start-up): `onDisconnect` on both transports and `onConnect` on WebSocket, which is awaited before the connection is announced. A hook that has not settled by then is logged as `did not settle within N ms` and abandoned, whatever it returns later. The other hooks are not waited for and have no limit. On SSE the client is cut first and `onDisconnect` runs after, so a slow hook cannot keep a connection open; on shutdown every connection is closed at once, so a hook that never settles delays closing the application by about one `hookTimeoutMs`, not by one per connection. A hook that needs longer than the timeout must hand its work off and return.

#### How many connections one instance holds

`maxConnectionsPerUser` bounds one user; it does not bound an instance. `maxConnections` (default `10000`, an integer of 1 or more, with no value that switches it off) bounds the whole instance, counting the connections of both transports together and the handshakes admitted and not yet registered. A handshake that arrives when the instance already holds that many is refused before `authenticate` is called, so a flood of them costs the instance no call to your backend: a `503` with the generic body on SSE (no `Retry-After` is sent), the generic `connect_error` on WebSocket. The refusals are logged once for each ten seconds with a count, and nothing of the request is in the line. A place held for a handshake is given back when its connection is registered, or when its request or socket closes, whichever comes first, and in any case after `authenticateTimeoutMs` plus 5,000 ms, at the next handshake that asks for room, so a client that leaves half way, even on a framework that reports no close, does not use up the limit.

The place is given back on the response's `close` as Express reports it, and on the Node response behind a Fastify reply (`reply.raw`) or on the socket when that is where a framework reports it. This is tested on Express, over real HTTP; the Fastify reply shape is handled and unit-tested, and checked against a real Fastify server, but there is no Nest-on-Fastify test in this repository.

Set it **below the process's file-descriptor limit, less headroom**. Each connection holds a descriptor, and so do the listening socket, the files the process has open, and every connection to Redis, a database or another service. A limit of 10,000 on a process allowed 1,024 descriptors (the common default of `ulimit -n`) would run out of descriptors long before it refused anyone. Worked example: with `ulimit -n 65536` and about 500 descriptors for everything that is not a client connection, set `maxConnections` to 60,000 or less; with `ulimit -n 1024`, either raise the limit or set `maxConnections` to 800 or less. Check what the process really has with `cat /proc/<pid>/limits` or `ulimit -n` inside the container, since a container or a service manager often sets a different number from your shell.

The limit has a cost, and it is not a defence by itself. It trades a process that runs out of descriptors and stops serving, for one that refuses new connections while it is full: the clients it already has are served. Because it cannot evict, anyone who fills it, with many users or with a token minted for each request, keeps real clients out until their sockets close. Limits for each address, the rate of new connections and the number of connections at the proxy or the edge stay the controls that stop that, and this option is the last bound behind them.

#### A client that does not read

An SSE response writes one event at a time and waits for the client to read before the next, so everything behind that wait is held in server memory. Each connection is bounded: when the events and bytes sent to it and not yet taken by its socket pass `sse.maxQueuedEvents` or `sse.maxQueuedBytes` (an event that is alone in the queue is always taken, however large), or no byte has left the process for `sse.stallHeartbeats` heartbeats in a row while the response holds bytes, the connection is closed with the reason `REALTIME_SLOW_CONSUMER` and a warning is logged. Only that connection is closed; the client reconnects and `Last-Event-ID` replays what it missed. A connection whose response has no socket to measure is not bounded.

> [!NOTE]
> `maxConnectionsPerUser` defaults to `5` on both transports: a user's sixth connection closes their oldest, which is sent a disconnect. `0` switches the cap off. The cap is per user and does not bound the connections of an instance: many users, or a token minted per request, are bounded by your proxy or the process's file-descriptor limit, not by this option.

The options are typed per entry point: `SseRealtimeModuleOptions` and `SseRealtimeModuleAsyncOptions` fix `transport: 'sse'`, and `WebSocketRealtimeModuleOptions` and `WebSocketRealtimeModuleAsyncOptions` (from `/websocket`) fix `'websocket' | 'both'`. `forRootAsync` takes `useFactory`, `useClass` (a `BymaxRealtimeModuleOptionsFactory`) or `useExisting`.

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

### Re-Authentication

Long-lived connections outlive short-lived tokens. `reauthenticationPolicy` revalidates on an interval and either drops the connection or emits `connection:reauthentication-failed` and then drops it, depending on `onFailure`. The connection is dropped even when that event cannot be sent: the event is a notification, and the failure to send it is logged. Successful checks are cached for `cacheTtlMs` so a busy connection is not revalidated on every event.

`revalidate` is bounded. At most `concurrency` calls run at once, across every cycle (a revocation that does not settle in `revalidateTimeoutMs` is given up on the same way, and tried again on the next cycle), and a connection with a call in flight is not asked again until it settles, so one slow connection cannot hold up the revocation of the others. A call that has not settled in `revalidateTimeoutMs` is treated exactly as one that threw: the connection is **revoked** (the `AbortSignal` in the call's third argument is aborted so the work behind it can stop, and whatever the call returns later is ignored). The consequence is that an auth backend that is down, or slower than the timeout, revokes every connection due for revalidation in that cycle, and those clients reconnect and are refused at the handshake until the backend recovers. Set `revalidateTimeoutMs` above your backend's p99. `intervalSeconds`, `revalidateTimeoutMs` and `concurrency` must be integers of 1 or more and `cacheTtlMs` an integer of 0 or more, and the two that feed a timer have a ceiling, because Node runs any timer longer than 2,147,483,647 ms as 1 ms (`revalidateTimeoutMs` at most 2147483647, `intervalSeconds` at most 2147483); anything else stops the application at start-up with `REALTIME_INVALID_OPTIONS`.

### Security Checklist

When integrating `@bymax-one/nest-realtime` in production, verify each of the following:

- The SSE endpoint is served over HTTPS — `Last-Event-ID` replays past events to whoever reconnects
- `tenantId` is derived from the authenticated result, never from a query parameter or request body
- Tickets are single-use and short-lived; `consume()` must be atomic under concurrency
- `websocket.cors.origin` is an explicit allowlist, not `true`, in any browser-facing deployment
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
| WebSocket origin      | Explicit `cors` config passed straight to Socket.IO                                                |

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

**Revocation is never best-effort.** `disconnect(connectionId)` resolves once the connection was closed on this instance or the revocation was handed to the bus (`IRealtimePubSub`). It **rejects**, with `error.code` set to a `RealtimeErrorCode`, when it could not: `REALTIME_PUBSUB_UNAVAILABLE` when the bus refuses the publish (`RedisRealtimePubSub` refuses at once while its Redis client is not ready), `REALTIME_TRANSPORT_UNAVAILABLE` when the WebSocket server is not attached or its fan-out throws. Branch on the code, not the message; the error is a plain `Error`, not a class for `instanceof`. A rejection means the connection may still be connected, so retry.

**Emits are at-most-once.** `emitToUser`, `emitToTenant`, `emitToRoom` and `broadcast` **resolve even when the publish to the other instances failed**; that failure is logged with `REALTIME_PUBSUB_UNAVAILABLE` and passed to the `onDeliveryFailure` hook, which is where to count it. An offline queue that could not keep an event for a user who is offline here is reported the same way, since another instance may have delivered it live; a failure on one transport of `'both'` is only logged. An emit rejects only when the event has no delivery path left: for `emitToUser`, the user is offline here, the queue failed, and the bus failed or cannot reach another instance (the default in-memory bus); with `'both'`, a failure on both transports rejects with `REALTIME_TRANSPORT_UNAVAILABLE`. A rejected emit is not proof that no client received it, so retry only where a duplicate is acceptable.

`joinRoom` and `leaveRoom` act on a connection **this instance holds**; for any other id they resolve and change nothing. A failure of the transport that holds the connection rejects the call.

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

#### Identity must be present or absent, never blank

`userId` must be a non-empty string, and `tenantId` either absent or a non-empty string. A connection whose authenticator, or whose `tenantResolver`, yields a blank one is **refused at bootstrap** as a server fault, not a `401`: blank is not missing. Every connection carrying `''` lands under the same registry key and joins the same `user:` or `tenant:` room, and a later emit reaches all of them. Whitespace counts as blank.

To place a connection in no tenant, **omit `tenantId`**. The runtime also accepts `undefined` or `null`, but whether those type-check depends on the consumer's `tsconfig` (`exactOptionalPropertyTypes` rejects `undefined`, `strictNullChecks` rejects `null`), so omission is the only form that compiles everywhere.

`tenantResolver` cannot clear a tenant. Resolution is `tenantResolver?.(auth) ?? auth.tenantId`, so a resolver returning `undefined` or `null` means "no opinion" and the authenticator's tenant stays. Decide the absent case in the authenticator.

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
measurements, and they apply to this field only: `joinRoom` stays free-form.

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

Never pass client-supplied input to `joinRoom` or `emitToRoom` as a room id without checking that it cannot start with `user:` or `tenant:`. `joinRoom` is not guarded (only the `rooms` field is validated), and joining `tenant:<other>` receives that tenant's events.

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

### Shutdown

From the `onModuleDestroy` phase on, which runs ahead of every `beforeApplicationShutdown`, a new SSE stream gets a 503 whose message is `REALTIME_TRANSPORT_UNAVAILABLE` and a new WebSocket handshake gets a `connect_error` whose `data.code` is that code. A slow `onModuleDestroy` in a module nearer the root than the realtime module still runs first, and until it returns a connection is accepted.

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
