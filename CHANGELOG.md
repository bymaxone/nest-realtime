# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.5] - 2026-11-01

### Added

- **`ConnectionAuthContext.remoteAddress`, the TCP peer of the connection.** It is read from the
  socket (`req.socket.remoteAddress` on SSE, `handshake.address` on WebSocket), never from a header,
  so a client cannot forge it. It is distinct from `ip`, which on SSE comes from `X-Forwarded-For`.
  An authenticator behind a reverse proxy can check it against its trusted proxies before believing
  a forwarded header such as `X-Forwarded-Host`. It is `undefined` when the socket reports no
  address. `SseRequest` gains an optional `socket` for it. Nothing existing changes.

### Internal

- The `internal` bundle budget in `pnpm size` is raised to make room for the line that reads the
  peer address.

## [1.2.4] - 2026-11-01

### Fixed

- **A rejection that is not an `Error` no longer makes the handler reporting it fail.** Handlers
  that log a failure read `.message` from whatever was thrown, so a promise that rejected with
  `null` or `undefined`, or with an object that has no prototype, made the `catch` itself throw. In
  a fire-and-forget `.catch` that surfaced as an unhandled rejection. They now describe the reason
  through one function that never throws, and a test fails if a source file goes back to the old
  patterns. The text logged for an `Error` or a string reason is unchanged; a plain object with a
  string `message` now logs that message instead of `[object Object]`.

### Documentation

- A local benchmark (`pnpm benchmark`, in `scripts/benchmark/`, not a CI gate) measures connect
  latency, fan-out latency for 1, 100 and 1000 clients, cross-instance latency through Redis, memory
  per idle connection and Redis connections per instance, and writes its tables as Markdown. The
  first results, with the machine, versions and run-to-run noise, are in
  `docs/benchmark_results_2026-10-31.md`.

## [1.2.3] - 2026-10-31

**Apply before upgrading, if you set `websocket.redisAdapter`:** make sure `@socket.io/redis-adapter`
is installed and that `pubClient` is an ioredis client. 1.2.2 and earlier logged one error and served a single
instance when the adapter could not be installed, and every ESM consumer was in that state, so
WebSocket events did not cross instances. The boot now fails with `REALTIME_REDIS_ADAPTER_FAILED`
instead. A Redis that is merely unreachable does not fail the boot.

### Fixed

- **The WebSocket Redis adapter now installs in the ES module build.** The adapter loaded
  `@socket.io/redis-adapter` with a bare `require`, which an ES module does not have, so for every
  consumer importing the package as ESM the load threw, one error line was logged, and the server
  stayed single-instance: an emit on one instance never reached a client on another. Measured on the
  published bundle with two instances and a real Redis, 0 of 5000 messages crossed; with the adapter
  installed, 5000 of 5000 did. CommonJS consumers were not affected. The ESM bundle now declares a
  `require` that resolves from the package, and still loads when a consumer's bundler re-bundles it
  into CommonJS, where `import.meta.url` is undefined. `pnpm size` fails when an ESM bundle calls a
  `require` it does not declare, and `pnpm check:runtime` boots the packed tarball in ESM, in
  CommonJS and re-bundled into CommonJS, and asserts the adapter registers in each.

- **A WebSocket authenticator that rejects with a value that is not an `Error` no longer leaves the
  socket connected.** The catch in `handleConnection` read `.message` from whatever was thrown, so a
  rejection with `null` or `undefined` made the catch itself throw before `socket.disconnect(true)`
  ran. The reason is now logged as `String(reason)` when it is not an `Error`, and the socket is
  always closed. The handshake middleware already logged it this way; this is the path that runs when
  the gateway is used without it.

## [1.2.2] - 2026-10-31

### Fixed

- **A refused WebSocket handshake is now a `connect_error` with a code, not a connect followed by a
  silent disconnect.** The gateway authenticated in `handleConnection`, after Socket.IO had already
  accepted the socket, so a client saw `connect` and then a bare `disconnect` with no reason it could
  act on. Authentication now runs in a Socket.IO middleware on the handshake: a `null` result fails the
  connection with `connect_error` carrying `err.data.code === 'REALTIME_AUTH_FAILED'`, and an
  authenticator that throws fails it with a generic `Internal Server Error` that never carries the
  thrown message. `authenticate()` still runs once per connection. **Apply note:** a client that
  treated any `disconnect` as a refusal must now listen for `connect_error`
  (`socket.on('connect_error', (err) => err.data?.code)`); `socket.active` is `false` after a
  refusal, so Socket.IO does not reconnect on its own.

- **An SSE refusal that needs I/O is now a `401`, not a `200` followed by an error event.** The
  SSE route returned the handler's promise and authenticated inside it. In an application with an
  interceptor registered (a logging interceptor, for one), Nest commits `200 text/event-stream` from
  a timer on the next macrotask, without waiting for that promise, so an authenticator that awaited
  real I/O (a revocation or session lookup, a Redis read) before refusing lost the race. The client
  had already received a `200`, then got
  `event: error` with `REALTIME_AUTH_FAILED` and a closed stream, which a browser `EventSource`
  treats as reconnectable and retries in a loop, while access logs recorded a `200` for refused
  credentials. A refusal reached synchronously, or within microtasks (no cookie, a forged or expired
  token checked in memory), got its `401`, and so did a late one in an application with no
  interceptor. No connection was ever registered, so nothing was exposed.

  Authentication now runs in a guard on the SSE route, which Nest awaits before the route and before
  the stream starts, and the handler takes its result, so `authenticate()` still runs once per
  connection. A refusal answers `401` (`REALTIME_AUTH_FAILED`), a blank identity `500` and an
  authenticator that throws a `5xx`, whatever the authenticator awaited and whether or not an
  interceptor is registered. Fixes
  [#161](https://github.com/bymaxone/nest-realtime/issues/161).

  The library also no longer lets an error's message reach the stream. Nest 11.2.3 writes the
  message of an error raised after the stream has started into the `event: error` frame, so a
  rejected connection registration, or a failure of another dependency after authentication, could
  put text such as `connect ECONNREFUSED 10.20.30.40:6379` in front of the client. Any error that
  is not an HTTP exception is now logged server-side and sent as a generic 500; an HTTP exception
  an authenticator throws on purpose (a rate limit, say) is sent unchanged.

  **Apply to a consumer.** Nothing to change. If you worked around the old behaviour by treating
  an `error` event with `REALTIME_AUTH_FAILED` on a `200` stream as a refusal, that workaround can go:
  the refusal is now the HTTP status, and `EventSource` stops on a `401` instead of reconnecting.
  A test that asserted `200` for a refused connection should assert `401`.

### Changed

- **`RealtimeGateway` now logs an error at start-up when the WebSocket adapter in use is not
  `RealtimeIoAdapter`.** Under any other adapter the `websocket.*` options (`cors`, `namespace`,
  `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize`, `redisAdapter`) are dropped, and the
  gateway's own CORS is `origin: false`, so a browser on another origin cannot connect. Nothing
  reported this before. The message names the options it found and the fix,
  `app.useWebSocketAdapter(new RealtimeIoAdapter(app))` in `main.ts`. It is a log line, not an
  exception: an application that works today (same-origin, or Socket.IO's own defaults) keeps booting.

### Internal

- `check:published` compiles every README snippet, not only the ones that import the package, through
  the TypeScript API, so a parse-level elision in one snippet no longer hides the semantic errors in
  the others. The names a snippet uses without declaring them are typed in
  `scripts/readme-prelude.d.ts`, so a wrong method, option or destructured field is an error instead
  of a call on `any`.
- `check:published` accepts a dot inside a relative module name (`./app.module`), which the path
  allowlist added with the relative-import resolution rejected; `..` segments are still refused.
- `check:published` resolves a relative import in a README snippet to the snippet that exports the
  imported names, and fails one that no snippet exports and no stub under `scripts/readme-modules/`
  types, instead of ignoring it as an unresolved module that makes the names `any`.
- `check:published` tolerates a parse error in a README snippet only where the syntax tree shows a
  bare `...` standing in for an argument, element or property, at that exact line and column, so a
  real syntax error elsewhere in a snippet is no longer ignored.

### Documentation

- **README:** a new step 7, "Add WebSocket", shows the complete working setup: the module from
  `/websocket`, `RealtimeIoAdapter` in `main.ts` and `redisAdapter`. The README never named
  `BymaxRealtimeWebSocketModule` or `RealtimeIoAdapter` before, and the sentence saying the Redis
  adapter "is registered for you" omitted that this only happens once the adapter is installed.
  Also documented: the error codes that are reserved and never raised today (`REALTIME_INVALID_TICKET`,
  `REALTIME_PUBSUB_UNAVAILABLE`, `REALTIME_PAYLOAD_TOO_LARGE`, `REALTIME_REPLAY_BUFFER_MISS`) in a
  status table; that presence is a contract and the server must emit `presence:*`; that the server
  ignores events a WebSocket client sends; the per-entry-point option types, `PRESENCE_EVENT_NAMES`
  and `UsePresenceReturn`; and that `RealtimeGateway`, `WebSocketTransport` and `CompositeTransport`
  are exported for the module's own wiring.
  A Troubleshooting entry quotes the start-up error verbatim, and a test fails if the README and the
  message differ.
- `ConnectionRegistry.register` and `unregister` are tagged `@internal`: they are the transports'
  own bookkeeping, and a record added by an application is counted by the lookups (an `sse` one also
  suppresses offline-queue appends for that user) while nothing can be delivered to it.
- **README:** the Testing section no longer states a test count and a mutant count, which had
  drifted from the suite (626 tests in 37 suites against 663 in 43; only the end-to-end count was
  still right). It keeps the claims a gate enforces: 100% coverage and a mutation break threshold
  of 100.

### Tests

- `RealtimeIoAdapter` marks the servers and namespaces it creates, and `RealtimeGateway` checks
  them in `afterInit`; both are covered, with the case of a server from another adapter.
- A spec parses the README and asserts it against the code: the `sse` and `reauthenticationPolicy`
  defaults in the Configuration table, the error codes, the DI tokens and the reserved event names.
  A default or a name that changes in code without the README now fails the suite.

## [1.2.1] - 2026-10-30

**This version carries two behavioural breaks, both under Security below.** An authenticator that
returns a blank identity is now refused, and `tenantResolver` now runs on WebSocket connections.
Neither is a compile error: both change what a running backend does, so read "⚠️ Apply to a consumer"
before upgrading. Each closes a defect in which connections shared one delivery bucket or
were routed to a tenant that differed by transport.

### Security

- **BREAKING (bootstrap-time): a blank identity is refused on both transports.** An authenticator
  that returns `''` or a whitespace-only `userId`, or a present-but-blank `tenantId`, now fails the
  connection. Such a value used to be indexed under an empty key and
  joined to the room `user:` or `tenant:`, so every such connection shared one bucket and received
  every emit addressed to it for the life of the subscription. An absent `tenantId` stays valid and
  means no tenant.
- **BREAKING (behavioural): `tenantResolver` now runs on WebSocket connections**, as it already
  did on SSE. It was read on the SSE path and ignored on the WebSocket path, so one user opening
  both transports could be routed to two different tenants by the same configuration. Resolution
  goes through one shared function, so a connection carries the same tenant on either transport,
  and `null` is treated as absent. An application that relied on the resolver not running on
  WebSocket was relying on that defect.
- Reauthentication now covers WebSocket connections, which previously kept delivering after their
  credentials were revoked. Its failure meta reports the real `conn.transport` instead of a fixed
  `'sse'`.

### Changed

- `tenantResolver` may return `string | undefined | null`. Not breaking: a resolver typed
  `() => string | undefined` still satisfies the wider signature.

### Fixed

- `RealtimeIoAdapter` renamed its private logger field from `logger` to `adapterLogger`, so it cannot
  collide with a member of the same name on the `IoAdapter` base class; behaviour is unchanged.

### ⚠️ Apply to a consumer

- **Blank identity.** Make `authenticate()` return a non-empty `userId`, or `null` to reject the
  connection. Omit `tenantId` for a connection that belongs to no tenant; do not return `''`. A
  blank identity answers HTTP 500 with a generic body on SSE, and is disconnected on WebSocket;
  both log the reason server-side, so a claim that can be blank (an unset `sub` or `tid`) shows up
  as a failed connection rather than a shared room.
- **`tenantResolver` is honoured on WebSocket.** It now also receives WebSocket connections, and
  it gets the `AuthenticationResult`, not the transport. A resolver that was only correct for SSE must be made
  correct for both; returning `undefined` or `null` keeps `auth.tenantId`.
- **Reauthentication disconnects WebSocket connections.** They are now checked as well. If
  `revalidate()` can return `false` for a credential that is still acceptable, those sockets are
  now disconnected on the next cycle.

### Documentation

- The README separates the authenticator path from the `tenantResolver` path for an absent tenant,
  and lists which reserved events the library emits and which it only reserves.
- `IPresenceStorage` is documented as a contract the application drives; the library does not
  emit `presence:*` events.
- `SECURITY.md` states that only the latest minor line (1.2.x) receives security fixes; its table listed
  `0.1.x`.
- The architecture notes, the auth patterns and the nest-auth bridge example match the code: `authorization`
  is dropped on SSE, `auth.token` and `auth.ticket` reach the authenticator through the header and
  `ctx.query.ticket`, `RealtimeIoAdapter` is imported from `/websocket`, and `cacheTtlMs` only matters when it
  exceeds `intervalSeconds`.

## [1.2.0] - 2026-08-29

**Shipped as a minor, and two entries below are strictly speaking breaking.** Both are called
out as such rather than hidden: removing the `service` option is a compile error for anyone who
passed it, and the new required key on `ConnectionEventMeta` is a compile error for anyone who
_constructs_ one. Neither changes runtime behaviour for any working configuration — `service`
was never read by anything, and reading the meta (what a hook does) is unaffected. The precedent
is 1.1.1, which added a required `roles` key to the same type and shipped as a patch. The third
item, the new bootstrap throw on a disagreeing SSE endpoint, replaces a silent misconfiguration
with a loud one: an application it stops was already serving a route other than the one it
configured.

### Changed

- **BREAKING: `forRootAsync` binds the SSE route from the registration, and no longer ignores
  the endpoint it was given.** `sse.endpoint` coming back from the factory could never move the
  route — controllers are registered at decoration time, long before a factory runs — so the
  async path bound a hardcoded `/events` and discarded the configured value in silence. The
  README said the endpoint was "configurable via `sse.endpoint`" with no caveat, so a consumer
  reading it would document, monitor and point a client at a path that did not exist. Found
  while answering a consumer's question about documenting the SSE endpoint in OpenAPI, not by a
  test: every gate was green, because nothing asserted the two agreed.

  The route is now declared as `sseEndpoint` on the `forRootAsync` options, next to `transport`
  and for the same reason. **The default is unchanged (`/events`)**, so an application that
  never set an endpoint keeps the route it has. Two behaviours change:

  - A factory that resolves an `sse.endpoint` disagreeing with the bound route now **throws at
    bootstrap** instead of serving a different path than the one configured. Comparison is on
    the normalized path, since `@Sse()` resolves `events` and `/events` identically.
  - `REALTIME_OPTIONS_TOKEN` now reports the endpoint that was actually bound. It previously
    carried the `forRoot` default (`/realtime/sse`) while the route was `/events`, so anything
    reading the configuration back — a health check, an OpenAPI document — was told the wrong
    path.

  `sseEndpoint` on a `transport: 'websocket'` registration is rejected outright: that mode
  registers no SSE controller, so the option could only be decorative, which is the failure
  this option exists to remove.

- **BREAKING: the `service` module option is removed.** It was accepted by the type and read
  nowhere — no reference in `src/` outside its own declaration, and none in the built bundle.
  The README claimed it "identifies the emitting service in event metadata", but `RealtimeEvent`
  carries `id`, `type` and `data` and nothing else, so passing it was inert. Removed rather than
  implemented: putting a service name on every event changes the wire shape for every client to
  serve a need nobody has stated. Consumers passing it should delete the key; nothing else
  changes, because nothing ever read it.

### Fixed

- **`AuthenticationResult.metadata` now reaches the lifecycle hooks.** The field was documented
  as "free-form extras for downstream code" and was dropped at the boundary: `ConnectionRecord`
  narrowed `originalAuth` to `userId`/`tenantId`/`roles`, and `ConnectionEventMeta` carried no
  bag at all. It is now threaded through all five meta construction sites — SSE and WebSocket
  `onConnect`/`onDisconnect` plus `onReauthenticationFailed` — and handed back to `revalidate`
  as part of the original result.

  This closes a real gap rather than a cosmetic one. `authenticate` sees the request headers but
  has no `connectionId` yet (the connection does not exist), and the hooks have the
  `connectionId` but never see the headers, so there was no way to correlate a connection with
  anything read off the handshake — a `traceparent`, an `x-request-id`. `metadata` is that
  channel, and it is the reason the field was declared in the first place.

  **This adds a required key** to `ConnectionEventMeta`, exactly as `roles` did in 1.1.1.
  Reading the meta is unaffected, which is what a hook does; code that _constructs_ one
  (typically a test fixture) must now supply `metadata`. `undefined` stays meaningful — an
  authenticator that returns no bag is not one that returns an empty object. Like `roles`, it is
  a connect-time snapshot that `revalidate` does not refresh, and the library never reads a key.

### Documentation

- The configuration table dropped the `service` row, and the `forRootAsync` endpoint rule is
  documented where the endpoint is configured rather than left to be discovered at runtime.
- The Contracts section gains a subsection on carrying handshake context into the hooks through
  `metadata`, with the tracing example that motivated it.

### Internal

- `normalizeEndpointPath` extracted from `createSseController`, which is now one of two callers:
  binding an endpoint and comparing two endpoints have to agree on what a path means.

## [1.1.2] - 2026-08-21

**Documentation-only.** `dist/` is byte-identical to `1.1.1` — verified by diffing the
build against the published tarball, not asserted. No runtime path, exported type or
public surface changed. The release exists because `README.md` ships inside the package
and renders on npm, so a documentation defect there reaches consumers exactly as a code
one does.

### Documentation

- **The role-scoped room snippet led a careful consumer into a wall.** It called
  `moduleRef.get()` inside the `onConnect` hook, which is correct and runs — and which
  means unit-testing that hook requires faking `ModuleRef`, in practice
  `as unknown as ModuleRef`. That is a suppression many codebases block outright, so the
  documented pattern was unusable for anyone whose policy forbids the cast. Found by a
  consumer adopting `1.1.1`, not by us; "it works" was true and was the reason it
  survived review.

  The README now also documents the testable shape: give the hook the two capabilities
  it uses, `RoomJoiner` and `ServiceResolver`. `ModuleRef` and `RealtimeService` satisfy
  them structurally, so production passes the real objects and a test passes plain ones,
  with no cast at either end. Both snippets are compiled and executed by
  `realtime.module.documented-patterns.spec.ts` rather than left as prose.

- **Role matching is exact membership.** `roles?.includes('admin')` on a
  `readonly string[]` compares whole elements. Reaching for
  `roles?.some((r) => r.includes('admin'))` — for case-insensitivity, say — admits
  `administrator`, `admin-readonly` and `superadmin`. That failure is an authorization
  leak, it fails open, and it appears only for role names nobody declared.

## [1.1.1] - 2026-08-21

### Added

- **`ConnectionEventMeta` now carries `roles`.** `IConnectionAuthenticator.authenticate` returns
  `roles` and `ConnectionRecord.originalAuth` stores them, but the meta the lifecycle hooks
  receive dropped them — so a host authenticating by role could not act on the role at
  `onConnect`, the one point that has a `connectionId` and knows the connection is new. With no
  role-scoped fan-out and a registry indexed by id, userId and tenantId, a room is the only
  mechanism for "these connections and not those", and a room could not be built on a value that
  never arrived. Threaded through all five meta construction sites — SSE and WebSocket
  `onConnect`/`onDisconnect` plus `onReauthenticationFailed` — because roles present at connect
  and absent at disconnect would be a field that lies by omission exactly when a host cleans up.

  **This adds a required key.** Reading the meta is unaffected, which is what a hook does; code
  that _constructs_ a `ConnectionEventMeta` (typically a test fixture) must now supply `roles`.
  `undefined` stays meaningful for an authenticator that returns none.

  Roles are carried, never interpreted: there is deliberately no `emitToRole`. Indexing a
  fan-out on a role would put the consumer's authorization vocabulary into the transport's API,
  and `meta.roles` is a connect-time snapshot — a role-indexed emit would look authoritative
  while reading state that can go stale. Room-plus-`onConnect` leaves that decision with the
  host. The pattern is documented in the README and covered by an executable test.

### Fixed

- **`forRootAsync` rejected typed factories and abstract `inject` tokens.** `useFactory` was an
  arrow-property signature, so `strictFunctionTypes` checked it contravariantly and rejected
  every factory whose parameters carried real provider types — including the
  `useFactory: (cfg: ConfigService) => ...` example in this module's own JSDoc, which had never
  typechecked for a consumer. Method shorthand is bivariant, which is what makes `inject` usable.
  Separately, `inject` accepted only `Type<unknown>`, a non-abstract constructor type, which
  excluded Nest's own abstract tokens — `ModuleRef` among them, and therefore the documented
  role-scoped room pattern. Widened with `Abstract<unknown>`.

### Documentation

- The README's Rooms section gains a **role-scoped delivery** subsection: how to build a
  role room in `onConnect`, why there is no `emitToRole`, and the snapshot semantics of
  `meta.roles` — a `revalidate` that keeps a connection alive does not refresh it.
- The `[Unreleased]` compare link pointed at `v1.0.5`, left behind when 1.1.0 shipped, so it
  showed the whole 1.1.0 release as unreleased.

### Tests

- The documented role-scoped room pattern is now an executable test rather than prose
  (`realtime.module.documented-patterns.spec.ts`): it boots the module exactly as the README
  shows and asserts both halves — the admin connection reaches `role:admin`, and a `viewer` and
  a roles-`undefined` connection reach nothing. `pnpm typecheck` covers it, so reverting either
  option-type change fails there.

## [1.1.0] - 2026-08-11

### Changed

- **Peer dependency `ioredis` moved to `^6.0.0`** (from `^5.0.0`). The ecosystem migrates to
  ioredis 6 in lockstep because `@bymax-one/nest-queue` now requires it and an app installs a
  single ioredis; ioredis 6 keeps `replyMapping: "legacy"` by default, so reply shapes are
  unchanged and this library — which only takes an injected client — needs no runtime change.
  `ioredis` remains an optional peer.

### Internal

- Stryker gate raised to 100: `thresholds.high`/`low`/`break` are now `100` (the score is already
  100% with 0 survivors), tightening the mutation floor from 95.

## [1.0.6] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.5` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

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

[Unreleased]: https://github.com/bymaxone/nest-realtime/compare/v1.2.5...HEAD
[1.2.5]: https://github.com/bymaxone/nest-realtime/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/bymaxone/nest-realtime/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/bymaxone/nest-realtime/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/bymaxone/nest-realtime/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/bymaxone/nest-realtime/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-realtime/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/bymaxone/nest-realtime/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/bymaxone/nest-realtime/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bymaxone/nest-realtime/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-realtime/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-realtime/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/bymaxone/nest-realtime/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-realtime/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/bymaxone/nest-realtime/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-realtime/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-realtime/releases/tag/v1.0.0
