# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] — 2026-08-06

**Runtime change.** `dist/` differs from `1.0.5`: the source carries new mutation-suppression
comments, and this package's bundler preserves comments.

### Documentation

- The mutation badge said **99.27%**; the measured score is **100.00%**.

### Tests

- The SSE stream teardown is pinned: unsubscribing the outer stream leaves the merged subject
  unobserved. RxJS reaches that through the subscriber linkage even without the explicit
  `inner.unsubscribe()`, which the report records — the behaviour is worth pinning whichever way
  it is achieved.

## [1.0.5] - 2026-08-04

### Security

- The Redis credentials are no longer disclosed when the adapters that hold a client are
  serialized. `RedisOfflineQueue` and `RedisRealtimePubSub` kept their ioredis instances
  in TypeScript `private` properties, which are erased at runtime and leave enumerable
  own properties, and an ioredis instance carries `options.password` as a plain field.
  `JSON.stringify`, object spread and `util.inspect` therefore reached the password —
  and, because both adapters are referenced from the module options, so did anything that
  serialized those. Both clients and the lazily created subscriber connection move to
  ECMAScript private fields.

Reading on purpose is unchanged and no public type or export moved.

## [1.0.4] - 2026-08-02

### Fixed

- **The published declarations required `@types/express`, which the package does
  not depend on.** `dist/internal/index.d.ts` imported `Request` and `Response`
  from `express`, so a consumer compiling with `skipLibCheck: false` failed with
  `TS2307: Cannot find module 'express'` on the root and `./websocket` subpaths.
  `express` is not a dependency, nor a peer, nor an optional peer, so there was no
  supported way to satisfy it.

  The SSE endpoint reads three fields from the request — `headers`, `ip`, `query` —
  and does two things to the response: sets the anti-buffering headers, and writes
  the keepalive comment. Those are now described by `SseRequest` and
  `SseResponse`, structural contracts an `express.Request` satisfies without being
  named by it. The same shape is what a Fastify request
  provides, so the endpoint no longer assumes a platform it never required.

  Runtime is unaffected: no bundle ever imported `express`, and the only change to
  the built JavaScript is two JSDoc lines.

### Changed

- **`pnpm check:surface` now also checks what the published declarations import.**
  Every module a `.d.ts` names has to be a declared peer, `./internal` included —
  the root's declarations re-export from it, so an undeclared import there reaches
  the consumer's compiler just the same. `tsc` could not see this (it only checks
  what this repository references) and neither could `attw` (it checks that
  declarations resolve, not what they contain).

## [1.0.3] - 2026-08-02

### Fixed

- **`transport: 'websocket'` and `'both'` could not resolve a single provider.**
  Registering `BymaxRealtimeWebSocketModule` and then injecting anything the
  package root exports — `RealtimeService`, `ConnectionRegistry`, or any of the
  eight injection tokens — failed with `UnknownElementException` at bootstrap.
  SSE through the root module was unaffected.

  Each entry point is a separate bundle, so the services and `Symbol` tokens both
  of them reached by a relative path were copied into each. A copied class is a
  different injection token, and the container held one set while the consumer
  imported the other. The shared runtime now lives in one bundle that both entry
  points import by package specifier, which gives it a single identity in
  CommonJS as well as ESM — code splitting could not, since esbuild splits ESM
  only.

### Added

- **`pnpm check:surface`** compares every name each subpath exports, read from the
  built `.d.ts`, against a checked-in snapshot, and fails on additions as well as
  removals. A type exported for consumers and referenced nowhere internally is
  invisible to `tsc`, to `attw` and to the README snippets, so it can vanish from
  a barrel with every other gate green.

- **`pnpm check:runtime`** packs the tarball, lays it out the way npm would, and
  boots NestJS against it in ESM and in CommonJS, resolving every exported token
  from every transport mode. It runs in `prepublishOnly` and in CI. Every other
  gate reads the source or the type declarations, so a defect in how the entry
  points are bundled was invisible to all of them.

- **`pnpm size` now checks bundle boundaries structurally**: the root and shared
  bundles must contain no static reference to the Socket.IO stack, and the root
  and WebSocket bundles must _import_ the shared runtime rather than inline it.

## [1.0.2] - 2026-08-02

### Fixed

- **The package could not be imported by an SSE application at all.** The root
  entry statically imported `@nestjs/websockets` and `@nestjs/platform-socket.io`,
  both declared **optional** peers. A consumer who installed only the required
  peers — which is what the manifest asks for, and what an application on SSE, the
  default transport, would do — got `ERR_MODULE_NOT_FOUND` on
  `import '@bymax-one/nest-realtime'`, in ESM and CommonJS alike.

  The library already carried an `assertWsPeerDeps()` guard written to produce a
  clear message for exactly this case. It was unreachable: the static import
  failed while the module file was still loading, before any function ran.

### Changed

- **WebSocket moved to its own entry point, `@bymax-one/nest-realtime/websocket`.**
  It exports `BymaxRealtimeWebSocketModule`, which serves `transport: 'websocket'`
  and `'both'`, together with `WebSocketTransport`, `RealtimeGateway`,
  `RealtimeIoAdapter` and `CompositeTransport` — all removed from the package root.

  `BymaxRealtimeModule` at the root now serves `'sse'` only, and nothing reachable
  from it imports the Socket.IO stack. That is what makes "opt-in" true of the
  install and not only of the configuration: an SSE application resolves 22
  packages where it previously needed 45.

  `transport` is narrowed per module rather than validated at runtime, so asking
  the root module for `'websocket'` does not compile. Asking anyway — through a
  cast, or from JavaScript — is refused with an error naming the entry point that
  serves it.

- **The single-instance warning no longer fires for `transport: 'websocket'`.**
  `IRealtimePubSub` is read by the SSE transport and its subscriber and by nothing
  else, so telling a WebSocket-only application to provide one named the wrong
  mechanism — it scales horizontally through `websocket.redisAdapter`. `'sse'` and
  `'both'` still warn.

- **`transport` is required on `forRootAsync`.** It was an optional hint, and
  omitting it took a path that registered every transport and resolved the active
  one at runtime, which booted Socket.IO regardless of the configured mode. That
  path is gone. Providers and controllers are fixed at decoration time, long
  before a factory runs, so the transport has to be declared for the module to
  register the right ones.

- The error raised when an async factory returns nothing now names the method it
  called (`createRealtimeOptions`) instead of describing it.

## [1.0.1] - 2026-08-02

### Fixed

- **The npm package page showed no documentation.** `1.0.0` reached the registry
  with an empty `readme` field, so the page rendered nothing — even though
  `README.md` was present in the tarball all along. Every package here published
  under pnpm 11 has an empty `readme`; every one published under pnpm 10, which
  delegated to the npm CLI, carries it. The same split appears in `_npmVersion`,
  present only on the publishes the npm CLI performed. The release workflow now
  calls `npm publish` directly, and this release is what carries the README to
  the registry.
- **`keywords` were missing from the manifest**, so the package was
  undiscoverable by search on npm. Fourteen added, covering the transports,
  the pub/sub and presence concepts, and the React subpath.

### Removed

- **The Roadmap section of the README.** It described work that is not shipping
  and dates the moment it is written; the issues board is where direction
  belongs. `README.md` ships in the package, so the section was on the npm page
  too.

## [1.0.0] - 2026-08-02

First published release.

### Added

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

- **Peer floors declared above their published advisories.** Ranges drafted for
  this package admitted versions carrying published advisories, and were
  corrected before anything was published — so no released version ever carried
  a permissive range:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | Floor      |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |
  | `socket.io`      | [GHSA-25hc-qcg6-38wj](https://github.com/advisories/GHSA-25hc-qcg6-38wj) — an unhandled `error` event crashes the process                   | `>= 3.0.0, < 4.6.2`           | `^4.6.2`   |

  A peer range is a statement about which versions this library supports. A
  floor below a published advisory tells a consumer that a vulnerable install is
  a supported one, and nothing in their tooling contradicts it — the install
  resolves cleanly and silently.

  `@nestjs/platform-socket.io` and `@nestjs/websockets` keep `^11.0.0`: neither
  has a published advisory, and narrowing a range without a cause only costs
  compatibility.

  The `socket.io` floor was found by the scheduled `peer-advisory-drift` check
  rather than by the manual sweep that raised the NestJS floors — that sweep
  asked about NestJS and never put the same question to the other ten peers.

[Unreleased]: https://github.com/bymaxone/nest-realtime/compare/v1.0.5...HEAD
[1.0.6]: https://github.com/bymaxone/nest-realtime/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-realtime/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/bymaxone/nest-realtime/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-realtime/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-realtime/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-realtime/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-realtime/releases/tag/v1.0.0
