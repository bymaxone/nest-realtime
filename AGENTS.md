# @bymax-one/nest-realtime — Architectural Reference

> See [CLAUDE.md](./CLAUDE.md) for critical rules and the verification checklist. This file documents architectural decisions, patterns, and invariants.

---

## Code Review Rules

<!-- shared:begin -->
<!--
  CANONICAL COPY: bymaxone/.github → agents/code-review-rules.md
  Do not edit this block in a consuming repository. It is replaced wholesale by
  the `agents-sync` reusable workflow, so a local edit is reverted on the next
  run. Change it here, cut a release, and every repository is offered the update.

  Repository-specific rules go OUTSIDE this block, below the closing marker.
-->

These rules hold in every Bymax repository. What is specific to this one is written after this
block, and the two are read together.

The pipeline already enforces formatting, linting, dependency policy, coverage and — where the
repository has one — the mutation gate. Do not spend a review on a **violation** of one of those: it
is a red check, not a comment. What follows is what CI cannot see.

**A change to the enforcing configuration is the opposite case, and it is in scope.** Every gate runs
the configuration from the branch under review — that branch's lint config, its coverage thresholds,
its mutation thresholds. So a pull request that deletes a rule, lowers a threshold or widens an
ignore glob turns the check **green**, because a gate reports on the rules it was handed. For those
diffs the review is the only independent check there is, and a weakened gate needs the same
justification a suppression does.

### A finding names what it read

Every factual claim in a review — about a library's API, about this repository's history, about what
a file contains — has to come from something read in the tree under review, and the finding should
say which. A claim assembled from recollection is likely to describe a previous version of whatever
it is about.

**Safe path**, by the kind of claim:

| Claim about                         | Read this                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| A library's API **shape**           | `node_modules/<pkg>/dist/**/*.d.ts` in this tree                               |
| A library's **runtime behaviour**   | that version's changelog entry, its documentation, or a test that exercises it |
| Commit authorship, dates or history | `git log --format='%an <%ae> / %cn <%ce>' <sha>`                               |
| What a file contains                | the file at the revision under review, not an earlier one                      |

The first two rows are separate on purpose, and the rule below says why: a field can stay optional
in the published type while becoming mandatory in behaviour. A `.d.ts` settles what a signature
accepts and nothing about what the implementation does with it, so a behavioural claim resting on
one is unfounded.

Weight the checking by what acting on the finding would cost. A comment that asks for a reworded
sentence is cheap to be wrong about; one that asks for history to be rewritten, a merge reverted, or
a release pulled is not — verify that class before raising it, and raise it at the severity the
evidence supports rather than the severity the consequence would deserve if true.

### A dependency upgrade migrates every call site, not only the ones that fail to compile

When an upgrade tightens a contract, the compiler catches only the call sites whose **shape**
changed. A field that stays optional in the published type while becoming mandatory in behaviour
compiles, passes the unit suite, and fails in production.

A `@bymax-one/*` version number carries **no compatibility information** while the libraries are
pre-stable: breaking changes ship in minor and patch releases by explicit policy, so `^` and `~`
protect against nothing. The migration note under **Apply to a derived backend** in the library's own
changelog is the compatibility contract.

**Safe path:** read **every** changelog entry from the version being replaced up to the proposed
one, not only the proposed one's, and check every call site they name — not only the ones the
compiler rejected. Upgrades routinely skip releases, and the entry that matters is often not the
last one: adopting `@bymax-one/nest-cache` 1.1.0 → 1.2.1 skipped 1.2.0, where a namespace-validation
security fix lives; 1.2.1's own entry is a field rename. Diff the `.d.ts` of the **previously adopted** version against
the **proposed** one — `npm pack` both, and name the two versions. Reaching for "the installed
declarations" is the trap: in a checkout of the branch under review the installed tree is already
the new version, so that diff compares a release with itself and shows nothing.

### Settled decisions are not review findings

Both are settled deliberately, and reopening either costs a round trip and changes nothing:

- **Do not propose a major version bump** for a breaking change in a `@bymax-one/*` library, and do
  not assert that this ecosystem follows strict SemVer. Until an API is declared stable, breaking
  changes ship in minor and patch releases; the migration note carries the compatibility information
  the number does not. If a document claims strict SemVer, the finding is that the claim is wrong —
  not that the version should be raised.
- **Do not propose pinning `bymaxone/.github` reusable workflows to a commit SHA.** They are
  referenced by the `@v1` alias on purpose: a fix has to land once and reach every repository, the
  tag is immutable and the alias moves only on a release, and pinning was measured to cost ~58
  dependency pull requests to propagate one change. Third-party actions are the opposite case and
  **are** pinned by SHA.

**Safe path:** if you believe a settled decision is now wrong, say so as a question in the pull
request rather than as a finding.

### Suppressions are refusals, not exceptions

`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` in any form,
`as unknown as` laundering a real type error, `istanbul ignore`, and in Rust `#[allow(...)]` over a
lint gate or `unsafe` without a `// SAFETY:` comment are blocking findings.

Anything a configured gate already reports belongs to the gate, not to a review: where a repository
lints `no-explicit-any` as an error — most do — an `as any` is a red check, and raising it here only
duplicates it. Check the repository's lint configuration before reporting a suppression rather than
assuming the list is exhaustive in either direction.

A failing gate means the code is wrong, the type is wrong, or the rule is wrong. **Safe path:** fix
whichever it is. Changing a rule's configuration with a stated reason is legitimate; scattering
per-call-site silencers is not.

### Comments state constraints, never history

A comment must read as true for whoever opens the file next. Flag any comment that narrates what a
previous version did, names a phase, task, ticket or review round, or explains a change rather than
the code. **Safe path:** state the constraint that still holds, and let `git log` carry the history.

### Size and layering

Functions over **50 lines** and nesting deeper than four levels are findings in the repository's own
source and test directories. Every non-trivial source file opens with a header stating its purpose
and its layer, and every exported symbol carries a doc comment.

**The 800-line file limit applies to what a change introduces, not to what it inherits.** A
repository that already carries a file past the line — a generator, a long end-to-end suite — would
otherwise produce a finding on every pull request touching three lines of it, which the author
cannot act on and did not cause. Raise it for a **new** file over the limit, or when a change pushes
a file past it or materially grows one already over.

Markdown, generated output and lockfiles are **out of scope**: a changelog is an append-only log that
only grows, a lockfile is generated, and neither has layers. Reporting their length is a false
positive on every dependency bump and every release note.

**Safe path:** extract by responsibility rather than by line count — the limit is a symptom, and one
file doing two jobs is the defect.

### No placeholders for empty directories

`.gitkeep`, `.keep` and pre-created empty directory skeletons do not belong in the tree. A directory
exists when there is a real file to put in it. **Safe path:** document the intended structure in a
plan or README, and let the first real file create the path.

### Language and attribution

Everything published is English — source, comments, tests, commit messages, pull request titles and
bodies, `README.md`, `CHANGELOG.md` and everything under `.github/`. Bymax projects keep `docs/` in
**Portuguese** by explicit decision; do not report Portuguese there as a finding.

No commit, pull request, comment or code may attribute authorship to an AI assistant or coding tool,
in any form. **This governs text a change introduces** — a trailer, a "generated with" line, a
signature in a comment or a description.

Git's own author and committer fields are set by the contributor's git configuration rather than by
anything in the diff. Before reporting one as a violation, read it:
`git log -1 --format='%an <%ae> / %cn <%ce>' <sha>`. The claim is trivially checkable and expensive
to act on — it asks for history to be rewritten.

<!-- shared:end -->

## Where this repository narrows a shared rule

Only what a reviewer of **these** diffs gets wrong. Each of the following is a case where the
type, the name or the obvious reading says one thing and the runtime does another — the shape a
reviewer cannot catch by reading carefully, which is the criterion for earning a place here.

### The root bundle must not reach the Socket.IO stack

`@nestjs/websockets`, `@nestjs/platform-socket.io` and `socket.io` are **optional** peers, so an SSE
application does not install them. A static import in the root entry fails while the module file is
still loading — before any `try`/`catch` or capability guard can run — and the package becomes
unimportable for every SSE consumer, not just degraded. Everything touching that stack lives under
`src/websocket/`, the only graph the `./websocket` entry reaches.

**Safe path:** the gate runs on the built artifact, not the source tree — `pnpm size` fails when any
of the three tokens appears in `dist/server/*` or `dist/internal/*`.

### Entry points share one runtime through `./internal`, never a relative path

Each entry is a separate bundle, so a module two of them reach relatively is **copied** into each —
and a copied class or `Symbol` is a different injection token. Registering a module from one entry
and injecting its services from another then fails at runtime with `UnknownElementException` while
the source suite, the type tests and `attw` all stay green. Code splitting cannot substitute:
esbuild splits ESM only, and this package ships CommonJS too.

**Safe path:** anything under `src/websocket/` that needs shared code imports
`@bymax-one/nest-realtime/internal`. `pnpm check:runtime` is the only gate that boots NestJS against
the packed tarball in both module systems and can see this defect.

### `forRootAsync` takes the SSE route from `sseEndpoint`, not from the factory

NestJS registers controllers at decoration time, before any factory runs, so an `sse.endpoint`
resolved by the factory cannot move the route. It is declared as `sseEndpoint` on the registration
instead, defaulting to `/events` — which is **not** the `forRoot` default of `/realtime/sse`. A
factory resolving a disagreeing `sse.endpoint` is rejected at bootstrap rather than silently served
elsewhere, and `REALTIME_OPTIONS_TOKEN` reports the route actually bound.

### `onError` does not receive `ConnectionEventMeta`

It takes `connectionId?`, `error`, `transport` and nothing else — no `roles`, no `metadata` — because
it can fire before authentication resolves, which is also why its `connectionId` is optional. Reading
the other three hooks and generalising is the trap. Pinned by a test, so widening the payload fails
there rather than silently contradicting the documentation.

### `ConnectionRegistry` is per-process

`count()` and `countUsers()` are **per-pod gauges, never cluster totals** — the registry is an
in-memory map per instance. A readiness check or a metric that reads either as a fleet-wide number
is wrong on every deployment with more than one replica.

### `REALTIME_INSTANCE_ID_TOKEN` is not a stable pod identity

It is a `randomUUID()` minted per module instantiation. It changes on every restart, and two
registrations in one process get two different values. It reads like a pod id and is not one — use
the platform's own identifier when a stable series is needed.

### `pnpm mutation` can report a stale score

`stryker.config.json` sets `incremental: true`, so it reuses stored verdicts and will re-report a
cached result for a mutant whose covering tests were just rewritten. **`pnpm mutation:full` is the
one that measures**; it clears the baseline first.

Moving or splitting a spec is **not** a pure refactor here. The Stryker runner sets `rootDir: 'src'`,
and `perTest` coverage attribution comes from its `roots` — so a move can change which tests are
credited with covering a mutant without changing a line of source, and the mutants lose their killers
silently while every other gate stays green. The `tests per mutant` figure in the report is the tell.

---

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

---

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

`roles` and `metadata` from the `AuthenticationResult` are stored on `ConnectionRecord.originalAuth`
and surface on `ConnectionEventMeta` in the three hooks that receive that type — `onConnect`,
`onDisconnect` and `onReauthenticationFailed`. `onError` takes a narrower payload
(`connectionId?`, `error`, `transport`) and carries neither, because it can fire before
authentication resolves. Both are **connect-time snapshots** —
a `revalidate` that keeps the connection alive does not refresh either, and the library never reads
a key of `metadata`. That bag is the only channel from the handshake into the hooks: `authenticate`
sees the request headers but has no `connectionId` yet, and the hooks have the `connectionId` but
never see the headers.

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

Configuration: `stryker.config.json` — thresholds `high: 100, low: 100, break: 100`.

Two scripts, and the difference matters. `pnpm mutation:full` clears `reports/stryker-incremental.json` first and measures cold (~15 min) — **use it whenever the answer matters**. `pnpm mutation` (and a bare `npx stryker run`) is incremental: it reuses stored verdicts, finishes in minutes, and can report a stale score for a mutant whose covering tests were just rewritten.

Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs, and only when a changed path matches `mutation-source-globs` in `ci.yml`. When nothing matches, the job skips its steps and still reports success — a green `CI passed` is not by itself evidence the gate ran. The weekly cold run lives in `mutation-full.yml`.

Moving a spec helper is not a pure refactor. The Stryker runner sets `rootDir: 'src'`, so anything a spec imports from outside `jest.stryker.config.ts`'s `roots` leaves `perTest` coverage analysis and its mutants survive, silently, with every other gate green. The `tests per mutant` figure in the report is the tell: a drop after a test-only change means attribution broke, not that the suite got smaller.

Critical paths held to 100%:

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

---

## Invariants Checklist

Before marking any change complete:

- [ ] `grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/` → zero
- [ ] `grep -E "^import.*socket.io-client" dist/react/index.mjs` → zero (after `pnpm build`)
- [ ] `pnpm typecheck && pnpm lint` → clean
- [ ] `pnpm test:cov` → 100% line/branch on every modified file
- [ ] `pnpm build && pnpm size` → all budgets and bundle boundaries green
- [ ] `pnpm check:surface` → no export added or removed without updating the snapshot,
      and no declaration imports a package the manifest does not declare
- [ ] `pnpm check:runtime` → a consumer boots NestJS against the tarball in ESM and CJS
- [ ] Nothing under `src/websocket/` imports `src/server/` relatively — shared code
      comes from `@bymax-one/nest-realtime/internal`, or the bundles duplicate it
- [ ] `package.json` `"dependencies": {}` — no direct deps added
- [ ] No `.gitkeep` / placeholder files
- [ ] All comments and identifiers in English; no Phase/Task references in committed files
