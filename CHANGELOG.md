# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Dual-format `exports` map** — every condition pointed at `./dist/*/index.d.ts`,
  so a CommonJS consumer was handed ESM declarations (`attw`: _Masquerading as
  ESM_), and there was no `main`/`types`/`typesVersions` for resolvers that do not
  read the map at all (_Resolution failed_). `types` is now declared per condition
  — `import` to `.d.ts`, `require` to `.d.cts` — with top-level `main`/`module`/
  `types` and `typesVersions` for the `shared` and `react` subpaths. The build
  already emitted `.d.cts`; only the manifest was wrong. `attw --pack` goes from
  3 failures to **16/16** on the strict profile.
- **`ioredis` type import** — `RedisRealtimePubSubOptions.client` and
  `RedisOfflineQueueOptions.client` were typed through `import type Redis from
'ioredis'`. A default import of a CommonJS module resolves to the module
  namespace under `node16`/`nodenext`, so a consumer compiling with
  `skipLibCheck: false` got `TS2709: Cannot use namespace 'Redis' as a type`. The
  named import (`import type { Redis }`) is what the rest of this codebase already
  used, and what a consumer can actually compile against.
- **SSE controller DI** — the dynamic SSE controller now injects `SseSubscriptionHandler` by explicit token. The bundle is built by esbuild/tsup, which does not emit `design:paramtypes` decorator metadata, so the previous reflected-type constructor param resolved to `undefined` at runtime and broke SSE subscriptions in consumer apps.
- **Cross-instance pub/sub DI** — `RealtimePubSubSubscriber` now injects `SseTransport` by explicit token, for the same missing-metadata reason; without it the pub/sub subscriber failed to construct and cross-instance fan-out never started.
- **`websocket.namespace` option** — the configured namespace is now applied. `RealtimeIoAdapter` overrides `create()` to bind the gateway to `server.of(namespace)`; previously the option was documented and typed but never wired.
- **Namespace socket lookups** — per-socket operations (`joinRoom` / `leaveRoom` / `disconnect`) now resolve the socket map from either a root `Server` (`.sockets.sockets`) or a `Namespace` (`.sockets`), so they work when `websocket.namespace` is set.

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. A floor
  below a published advisory tells a consumer that a vulnerable install is a
  supported one, and nothing in their tooling contradicts it — the install resolves
  cleanly and silently. Corrected before the first publish, so no released version
  ever carried the permissive range. No runtime behaviour changed.

  `@nestjs/platform-socket.io` and `@nestjs/websockets` keep `^11.0.0`: neither has
  a published advisory, and narrowing a range without a cause only costs
  compatibility.

- **`socket.io` peer floor raised to `^4.6.2`.** The declared `^4.0.0` admitted
  versions carrying a moderate advisory first patched in 4.6.2. The matching
  devDependency moved with it, so this repository cannot develop against a
  version it tells consumers not to install.

  Found by the scheduled `peer-advisory-drift` check rather than by the manual
  sweep that raised the NestJS floors — that sweep asked about NestJS and never
  put the same question to the other ten peers.

## [0.1.0] - 2026-06-30

### Added

- Initial release
- **Dual-transport architecture** — SSE (default) and WebSocket (opt-in) via the `ITransport` abstraction; `CompositeTransport` for `transport: 'both'` migration mode
- **`RealtimeService`** — unified server-side API: `emitToUser`, `emitToTenant`, `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, `disconnect`; cross-instance variants via `*Local` methods
- **`IConnectionAuthenticator`** — plug-and-play auth contract; the library never imports a concrete auth library (auth inversion); supports cookie HttpOnly, ticket, and bearer patterns
- **`EventReplayBuffer`** — per-user ring buffer for `Last-Event-ID` seamless SSE reconnect
- **`IRealtimePubSub`** — cross-instance pub/sub abstraction; `InMemoryPubSub` default; `RedisRealtimePubSub` reference implementation (requires `ioredis`)
- **`IOfflineQueueStorage`** — events delivered while a user is offline; `RedisOfflineQueue` reference implementation
- **`IPresenceStorage`** — optional online-user tracking
- **Lifecycle hooks** — `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed` (fire-and-forget)
- **Re-authentication policy** — periodic credential revalidation with a positive cache
- **Heartbeat keepalive** — `: keepalive` SSE comment line tuned for real-world proxies (Nginx, Cloudflare, AWS ALB)
- **`@socket.io/redis-adapter` integration** — WebSocket horizontal scaling via the `websocket.redisAdapter` option
- **Multi-tenant room conventions** — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`; auto-join on connect
- **`forRoot` + `forRootAsync`** — synchronous and asynchronous dynamic-module configuration
- **Frontend React subpath (`./react`)** — `useRealtime` (auto-detects SSE vs WebSocket), `useRealtimeConnection`, `usePresence`, `RealtimeProvider`, `useRealtimeContext`
- **`socket.io-client` dynamic import** — kept out of the SSE-only static bundle (SSE-only bundle ≤ 4 KiB brotli)
- **Zero direct dependencies** — everything via peer deps (`rxjs` always required; WebSocket / Redis / React optional)
- **FIFO connection eviction** — exceeding `maxConnectionsPerUser` closes the oldest connection (`REALTIME_TOO_MANY_CONNECTIONS`); the new connection is always admitted

### Security

- **Auth inversion** — the library never imports `@bymax-one/nest-auth`, `@nestjs/jwt`, or any auth concrete; consumers own the auth implementation via `IConnectionAuthenticator`
- **Tenant isolation** — enforced server-side via the room registry; `emitToTenant` and `emitToRoom` scope delivery to the caller-specified room only

[Unreleased]: https://github.com/bymaxone/nest-realtime/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bymaxone/nest-realtime/releases/tag/v0.1.0
