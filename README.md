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
- **🪶 Nothing in your bundle you didn't ask for** — `"dependencies": {}` on the server, and `socket.io-client` is reached through `await import()` so an SSE-only frontend ships **2.26 KB brotli** instead of ~80 KB.

```
pnpm add @bymax-one/nest-realtime
```

---

## 🔥 Features

### 📡 Transports

- ✅ **SSE (default)** — native browser reconnect, `Last-Event-ID` replay, `: keepalive` heartbeat tuned for real proxies
- ✅ **WebSocket (opt-in)** — Socket.IO gateway behind the `/websocket` subpath, with full-duplex `emit`; an SSE app never installs it
- ✅ **Composite mode** — `transport: 'both'`, also on the `/websocket` subpath, fans a single emit out to clients on either transport
- ✅ **Unified contract** — every transport implements `ITransport`, so `RealtimeService` never branches

### 🔐 Security & Auth

- ✅ **Auth inversion** — the consumer plugs `IConnectionAuthenticator`; the library owns no credentials
- ✅ **Zero auth imports** — `src/` contains no reference to `@nestjs/jwt`, `passport-*`, or any auth package, verified in CI
- ✅ **Three handshake patterns** — HttpOnly cookie (SSE-safe), one-time ticket, and bearer header (WebSocket only)
- ✅ **Periodic re-authentication** — revalidate credentials on an interval, with a positive-result cache
- ✅ **Tenant from the token, never the body** — `tenantId` comes from the authenticated result via `tenantResolver`

### 🏢 Multi-Tenant & Delivery

- ✅ **Room conventions** — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`, with the first two auto-joined
- ✅ **Offline queue** — `IOfflineQueueStorage` holds events for absent users and flushes them on reconnect
- ✅ **Replay buffer** — per-user ring buffer answers `Last-Event-ID` after a dropped SSE stream
- ✅ **FIFO connection limits** — the oldest connection is evicted, so a new tab never gets a 429
- ✅ **Presence** — optional `IPresenceStorage` powers `presence:online` / `presence:offline`

### 🧩 Developer Experience

- ✅ **4 subpath exports** — server, WebSocket, shared types, and React; tree-shakeable, ESM + CJS dual output
- ✅ **Dynamic module** — `forRoot()` and `forRootAsync()` with `useFactory` / `useClass` / `useExisting`
- ✅ **Strict TypeScript, zero `any`** — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on
- ✅ **Horizontal scaling** — `IRealtimePubSub` for SSE fan-out, `@socket.io/redis-adapter` for WebSocket
- ✅ **Bundle gate in CI** — the SSE-only React bundle is measured on every build and fails over budget

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

The `shared` subpath carries no Node or NestJS import, so the same event names and error codes are used on both sides of the wire without duplicating a constant.

**The `websocket` subpath exists so the server one costs nothing extra.** Everything that touches `@nestjs/websockets`, `@nestjs/platform-socket.io` and `socket.io` is reachable only through it, so an application on SSE — the default transport — never installs the Socket.IO stack. Importing it is what opts in, in the install as much as in the configuration.

The package also exposes `@bymax-one/nest-realtime/internal`. It is **not public API** and carries no compatibility promise — it is the shared runtime the two server subpaths import so that a service registered through one and injected through the other is the same class. Import the four above; nothing you need is only there.

---

> [!TIP]
> Prefer to learn from a working app? See the [nest-realtime-example](https://github.com/bymaxone/nest-realtime-example) — a NestJS + React project wired with this library.

## 🚀 Quick Start

### 1. Install

```bash
# Using pnpm (recommended)
pnpm add @bymax-one/nest-realtime

# Using npm
npm install @bymax-one/nest-realtime

# Using yarn
yarn add @bymax-one/nest-realtime
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
> Returning `null` rejects the connection — throwing is not required. See [Auth Inversion](#-security-model) for the ticket and bearer patterns.

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

For WebSocket, pass an ioredis client to `websocket.redisAdapter.pubClient` and `@socket.io/redis-adapter` is registered for you.

---

## ⚙️ Configuration

All options are passed to `forRoot()` / `forRootAsync()`. Only `transport` and `authenticator` are required.

| Group                      | Key Options                                                                                                                                 | Default                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **transport**              | `'sse'` \| `'websocket'` \| `'both'`                                                                                                        | — (**required**)                             |
| **authenticator**          | `IConnectionAuthenticator`                                                                                                                  | — (**required**)                             |
| **tenantResolver**         | `(auth) => string \| undefined` — derives `tenantId` from the auth result                                                                   | `auth.tenantId`                              |
| **hooks**                  | `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed` (fire-and-forget)                                                        | —                                            |
| **pubsub**                 | `IRealtimePubSub` — cross-instance fan-out for SSE                                                                                          | `InMemoryPubSub`                             |
| **offlineQueue**           | `IOfflineQueueStorage` — events held while a user is away                                                                                   | — (disabled)                                 |
| **presence**               | `IPresenceStorage` — online-user tracking                                                                                                   | — (disabled)                                 |
| **sse**                    | `endpoint`, `heartbeatMs`, `replayBufferSize`, `maxConnectionsPerUser`, `emitConnectionEvent`                                               | `/realtime/sse`, `30000`, `100`, `5`, `true` |
| **websocket**              | `namespace`, `cors`, `maxHttpBufferSize`, `pingIntervalMs`, `pingTimeoutMs`, `maxConnectionsPerUser`, `emitConnectionEvent`, `redisAdapter` | `'/'`, — (Socket.IO defaults)                |
| **reauthenticationPolicy** | `intervalSeconds`, `onFailure` (`'disconnect'` \| `'event'`), `cacheTtlMs`                                                                  | `300`, `'disconnect'`, `60000`               |

> [!NOTE]
> `websocket.maxConnectionsPerUser` is **opt-in** and unlimited unless set to a positive number, while `sse.maxConnectionsPerUser` defaults to `5`. The two transports differ here on purpose: an SSE stream holds an HTTP connection open, a Socket.IO client multiplexes.

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

The full reference, including `forRootAsync` with `useFactory` / `useClass` / `useExisting`, is in [docs/technical_specification.md](./docs/technical_specification.md) §4.

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

### Design Principles

| Principle                 | Description                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **🔌 Interface-Driven**   | Authentication, pub/sub, offline queue, and presence are contracts you implement — Redis reference implementations ship, none are forced |
| **🔀 Transport-Agnostic** | `RealtimeService` talks to `ITransport`; adding or swapping a transport never touches application code                                   |
| **🛡️ Auth Inversion**     | The library holds no credential logic, so an auth vulnerability cannot originate here                                                    |
| **🪶 Zero Runtime Deps**  | `"dependencies": {}` — every dependency is a peer, and optional ones are marked in `peerDependenciesMeta`                                |
| **🌳 Tree-Shakeable**     | `sideEffects: false`, subpath exports, and a dynamic `import()` that keeps `socket.io-client` out of the SSE bundle                      |

### Cross-Instance Emit Flow

An emit delivers locally **and** publishes once. Every other instance's subscriber re-emits through local-only paths (`emitToUserLocal`, …), so a message is never republished and cannot loop. Connection revocation crosses instances as an `op: 'disconnect'` message on the same channel.

Sizing guidance and adapter trade-offs are in [docs/architecture/scaling-cheatsheet.md](./docs/architecture/scaling-cheatsheet.md).

---

## 🔐 Security Model

### Auth Inversion

This library **never** verifies a JWT, hashes a password, or imports an authentication package. It calls `IConnectionAuthenticator.authenticate()` once per connection and trusts the `AuthenticationResult` you return.

This is a **structural guarantee**, not a guideline — `src/` is audited in CI for any reference to `@bymax-one/nest-auth`, `@nestjs/jwt`, or `passport-*`:

```bash
grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/   # must return zero
```

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

Long-lived connections outlive short-lived tokens. `reauthenticationPolicy` revalidates on an interval and either drops the connection or emits `connection:reauthentication-failed`, depending on `onFailure`. Successful checks are cached for `cacheTtlMs` so a busy connection is not revalidated on every event.

### Security Checklist

When integrating `@bymax-one/nest-realtime` in production, verify each of the following:

- The SSE endpoint is served over HTTPS — `Last-Event-ID` replays past events to whoever reconnects
- `tenantId` is derived from the authenticated result, never from a query parameter or request body
- Tickets are single-use and short-lived; `consume()` must be atomic under concurrency
- `websocket.cors.origin` is an explicit allowlist, not `true`, in any browser-facing deployment
- `maxConnectionsPerUser` is set for WebSocket if clients are untrusted — it is unlimited by default
- Reserved event names are not reused for application events (see the [catalog](#reserved-events))

---

## 🛡️ Security Table

| Layer                 | Implementation                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| Credential validation | Delegated entirely to consumer-supplied `IConnectionAuthenticator`             |
| Auth library imports  | None — enforced by a CI grep over `src/`                                       |
| Tenant isolation      | Room-scoped (`tenant:{id}`), resolved from the authenticated result            |
| Connection revocation | `disconnect(connectionId)`, propagated cross-instance via `op: 'disconnect'`   |
| Credential expiry     | Interval re-authentication with `disconnect` or event on failure               |
| Connection flooding   | FIFO eviction per user — oldest closed, new admitted, never a 429              |
| SSE transport headers | `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` by default |
| WebSocket origin      | Explicit `cors` config passed straight to Socket.IO                            |

> [!IMPORTANT]
> This package holds **zero credential logic**. That is its central security property — and it means the strength of your realtime auth is exactly the strength of the authenticator you plug in.

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
- ✅ **100.00% mutation score** — 655 killed and 7 timed out, zero survivors, verified with [Stryker](https://stryker-mutator.io/) (break threshold 100)
- ✅ **626 tests** — 593 unit and integration across 37 suites, plus 33 end-to-end across 6
- ✅ **Cross-instance e2e** — real Redis pub/sub fan-out between two live instances, not a mocked channel
- ✅ **Bundle-size gate** — the SSE-only React bundle is measured on every build and fails over budget

```bash
pnpm test          # unit + integration
pnpm test:e2e      # end-to-end (single instance, no Redis needed)
pnpm test:cov:all  # 100% coverage gate
pnpm mutation      # Stryker mutation testing (~15-25 min)
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

### ConnectionRegistry

Read-side view of live connections — useful for admin endpoints and metrics.

| Method                           | Returns                                          |
| -------------------------------- | ------------------------------------------------ |
| `byUser(userId, transport?)`     | `ConnectionRecord[]` for one user                |
| `byTenant(tenantId, transport?)` | `ConnectionRecord[]` for one tenant              |
| `allByTransport(transport)`      | `ConnectionRecord[]` on `'sse'` or `'websocket'` |
| `get(connectionId)`              | `ConnectionRecord \| undefined`                  |
| `count()` / `countUsers()`       | Live connection count / distinct user count      |

### Contracts

| Interface                   | Required | Purpose                                                     |
| --------------------------- | :------: | ----------------------------------------------------------- |
| `IConnectionAuthenticator`  |    ✅    | Validate a connection, return `userId` / `tenantId`         |
| `IRealtimePubSub`           |    —     | Cross-instance fan-out for SSE                              |
| `IOfflineQueueStorage`      |    —     | Hold events for disconnected users                          |
| `IPresenceStorage`          |    —     | Track who is online                                         |
| `IConnectionLifecycleHooks` |    —     | Fire-and-forget connect / disconnect / error callbacks      |
| `ITransport`                |    —     | Implemented by the library; the seam every transport shares |

Reference implementations shipped: `InMemoryPubSub` (default), `RedisRealtimePubSub`, `RedisOfflineQueue`.

#### Carrying handshake context into the hooks

`AuthenticationResult.metadata` is a free-form bag the library carries verbatim: it reaches
`ConnectionEventMeta.metadata` in every lifecycle hook and is handed back to `revalidate` as
part of the original result. It is the only channel that crosses that boundary —
`authenticate` sees the request headers but no `connectionId` yet, and the hooks see the
`connectionId` but not the headers.

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

#### Role-scoped delivery

There is no `emitToRole`. Roles are the consumer's authorization vocabulary, not
the transport's — the library carries them through without interpreting them (see
[Auth Inversion](#auth-inversion)). To deliver to a subset of connections by role,
build a room for it in `onConnect`, where `ConnectionEventMeta.roles` carries the
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

##### Make the hook testable: depend on the capability, not the injector

The snippet above works, and it still walks a careful consumer into a wall: a
`moduleRef.get()` call inside the hook means unit-testing that hook requires
faking `ModuleRef`, which in practice means `as unknown as ModuleRef` — a
suppression many codebases block outright.

Give the hook the two capabilities it actually uses instead. `ModuleRef` and
`RealtimeService` satisfy these shapes **structurally**, so the module passes the
real objects and a test passes plain ones, with no cast at either end:

```typescript
interface RoomJoiner {
  joinRoom(connectionId: string, roomId: string): Promise<void>
}

interface ServiceResolver {
  get(token: typeof RealtimeService): RoomJoiner
}

function joinRoleRoom(resolver: ServiceResolver, role: string, roomId: string) {
  return async (meta: ConnectionEventMeta): Promise<void> => {
    if (!meta.roles?.includes(role)) return
    await resolver.get(RealtimeService).joinRoom(meta.connectionId, roomId)
  }
}
```

Wire it with the real injector:

```typescript
inject: [ModuleRef],
useFactory: (moduleRef: ModuleRef) => ({
  transport: 'sse' as const,
  authenticator: new CookieAuthenticator(),
  hooks: { onConnect: joinRoleRoom(moduleRef, 'admin', 'role:admin') },
}),
```

and test it without booting NestJS:

```typescript
const joinRoom = jest.fn()
const onConnect = joinRoleRoom({ get: () => ({ joinRoom }) }, 'admin', 'role:admin')
```

> [!NOTE]
> Match roles by exact membership. `roles?.includes('admin')` on a `readonly string[]`
> compares whole elements; reaching for `roles?.some((r) => r.includes('admin'))` —
> for case-insensitivity, say — admits `administrator`, `admin-readonly` and
> `superadmin`. That failure is an authorization leak, it fails open, and it only
> shows up for role names nobody declared.

### Reserved Events

Emitted by the library. Do not reuse these names for application events.

| Event                                  | Meaning                                                 |
| -------------------------------------- | ------------------------------------------------------- |
| `connection:established`               | Handshake accepted (suppress via `emitConnectionEvent`) |
| `connection:reauthentication-failed`   | Credentials no longer valid                             |
| `connection:credential-expiring`       | Credential nearing expiry                               |
| `room:joined` / `room:left`            | Room membership changed                                 |
| `error`                                | Transport-level error                                   |
| `presence:online` / `presence:offline` | Presence changed (requires `IPresenceStorage`)          |

> [!NOTE]
> The SSE heartbeat is a `: keepalive` **comment line**, not a named event. It never appears in the `Last-Event-ID` id-space and never reaches a client listener.

### Error Codes

`REALTIME_INVALID_OPTIONS` · `REALTIME_NO_AUTHENTICATOR` · `REALTIME_AUTH_FAILED` · `REALTIME_REAUTHENTICATION_FAILED` · `REALTIME_TOO_MANY_CONNECTIONS` · `REALTIME_INVALID_TICKET` · `REALTIME_PUBSUB_UNAVAILABLE` · `REALTIME_PAYLOAD_TOO_LARGE` · `REALTIME_REPLAY_BUFFER_MISS`

### DI Tokens

`REALTIME_OPTIONS_TOKEN` · `REALTIME_TRANSPORT_TOKEN` · `REALTIME_AUTHENTICATOR_TOKEN` · `REALTIME_PUBSUB_TOKEN` · `REALTIME_OFFLINE_QUEUE_TOKEN` · `REALTIME_PRESENCE_TOKEN` · `REALTIME_HOOKS_TOKEN` · `REALTIME_INSTANCE_ID_TOKEN`

### React Hooks

| Hook                             | Returns                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `useRealtime(options)`           | `{ transport, connected, events, lastEvent, error, reconnectAttempts, reconnect, emit }` — opens the connection |
| `useRealtimeContext()`           | The same value, from the nearest `<RealtimeProvider>` — throws when used outside one                            |
| `useRealtimeConnection(options)` | `{ connected, error, reconnectAttempts, reconnect }` — status only, no events array                             |
| `usePresence()`                  | `{ onlineUserIds, isOnline(userId), count }` — reads presence events from the provider                          |

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
> `emit` is WebSocket-exclusive — SSE is server → client only. `reconnectAttempts` is always `0` on WebSocket, where Socket.IO owns the retry policy and exposes no count.

---

## 🚧 Deployment Notes

SSE connections are long-lived HTTP responses, and several common proxy defaults break them silently:

| Concern                  | Fix                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Response compression** | Disable on the SSE endpoint — `Content-Encoding: gzip` buffers the body and defeats streaming          |
| **Proxy buffering**      | Nginx `proxy_buffering off`. The library already sends `X-Accel-Buffering: no`                         |
| **CDN caching**          | `Cache-Control: no-cache, no-transform` — set by the library on the SSE response                       |
| **Idle timeout**         | Must exceed `sse.heartbeatMs` (default 30 s). AWS ALB's 60 s default is compatible                     |
| **WebSocket + polling**  | Enable sticky sessions. The Redis adapter syncs messages between instances, but not handshake affinity |

Platform-specific configuration is in [docs/proxies-cheat-sheet.md](./docs/proxies-cheat-sheet.md).

---

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss substantial changes before submitting a pull request.

```bash
# Clone the repository
git clone https://github.com/bymaxone/nest-realtime.git
cd nest-realtime

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm typecheck
```

Every change must keep the full gate green:

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
