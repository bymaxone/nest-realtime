# Phase 4 — WebSocket Transport

> **Status**: ✅ Done · **Progress**: 12 / 12 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 5
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md) § 6

---

## Context

Phases 1–3 deliver a production-ready SSE transport (single-instance, then horizontally scaled via `IRealtimePubSub`). This phase adds the **opt-in WebSocket transport** so a consumer can switch to `transport: 'websocket'` or run `transport: 'both'` (SSE + WebSocket simultaneously) during a migration.

It delivers four building blocks: `WebSocketTransport` (an `ITransport` implementation over Socket.IO), `RealtimeGateway` (a `@WebSocketGateway()` that authenticates the handshake through the injected `IConnectionAuthenticator` and manages the connection lifecycle), `RealtimeIoAdapter` (a NestJS `IoAdapter` that applies the configured namespace/cors/ping options and wires `@socket.io/redis-adapter` for cross-instance fan-out), and `CompositeTransport` (fans every emit out to both SSE and WebSocket). The module's `forRoot`/`forRootAsync` learn to resolve all three transport modes, the server barrel exports the new public surface, and the whole thing is covered by unit specs plus `socket.io-client` end-to-end specs.

This is the second HIGH-complexity phase. The WebSocket handshake auth differs from SSE (cookies still work, but the `Authorization: Bearer` header and Socket.IO's dedicated `auth` field are also viable), the Socket.IO Redis adapter has its own scaling semantics (and a mandatory sticky-session caveat), and `CompositeTransport` must fan out without duplicating delivery. When the phase is done, all three modes work and `RealtimeService.emitToUser(...)` reaches clients connected on whichever transport(s) are active.

---

## Rules-of-phase

1. **Auth inversion is a structural rule, not guidance.** There must be **NO** reference to `JwtService`, `JwtPayload`, `@nestjs/jwt`, `passport-*`, or `@bymax-one/nest-auth` in any file under `src/` — neither the gateway, the transport, nor anything else. Authentication flows **only** through the injected `IConnectionAuthenticator`. Concrete-auth references are allowed **only** in `docs/` (bridge examples) and in tests (mocks).
2. **SSE-first, WebSocket opt-in.** `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, and `@socket.io/redis-adapter` are **optional** peer deps. Use `import type` for Socket.IO types and a lazy `require`/dynamic `import` for `@socket.io/redis-adapter`, so an SSE-only install typechecks, builds, and runs without those packages present.
3. **`ITransport.kind` is `'sse' | 'websocket'`** (the per-transport mechanism id) and is distinct from the module-level `TransportMode` (`'sse' | 'websocket' | 'both'`). `CompositeTransport.kind` reports the **dominant** transport `'sse'` — never `'both'` (which is not a valid `ITransport.kind`).
4. **WebSocket cross-instance fan-out is the Socket.IO Redis adapter — NOT `IRealtimePubSub`.** The WebSocket `emitTo*` methods must **not** call `pubsub.publish`; `@socket.io/redis-adapter` synchronizes WS messages across nodes. (`IRealtimePubSub` remains the SSE scaling primitive from Phase 3.)
5. **Sticky sessions are mandatory for a horizontally-scaled WebSocket with the polling fallback enabled** — the adapter fans out messages but does not remove the load balancer's session-affinity requirement. This is **documented** (scaling cheatsheet / README), not enforced by the lib.
6. **Room convention is first-class.** On connect (any transport) the lib auto-joins `user:{userId}` always and `tenant:{tenantId}` when a tenant resolves. `ROOM_PREFIXES` / `composeRoomId` are single-sourced in `src/shared/` and re-exported from the server index; do not redefine them.
7. **`maxConnectionsPerUser` is enforced via FIFO eviction.** When a user exceeds the cap, **evict the user's OLDEST connection** (close it with reason `REALTIME_TOO_MANY_CONNECTIONS`) and **admit the new one**. Never reject the new connection with HTTP 429.
8. **Reserved events stay reserved.** `connection:established`, `connection:reauthentication-failed`, `error`, etc. (§13) are owned by the lib. Socket.IO's `ping`/`pong`/`disconnect` are internal protocol events, not catalog events. The SSE heartbeat is a raw `: keepalive\n\n` **comment** written to the response stream — not a `MessageEvent` and not a reserved named event.
9. **100% line/branch coverage per implemented file** (Bymax library standard). Mutation testing is a pre-release gate (Stryker `break = 95`, high 99 / low 95) focused on the phase's critical paths: `websocket.transport.ts`, `realtime.gateway.ts`, `composite.transport.ts`.
10. **Server bundle budget: `dist/server/index.mjs` ≤ 18 KB brotli.** The gateway glue adds ~3 KB; `socket.io` and `@nestjs/websockets` stay external (never bundled).
11. **English-only, timeless comments.** No `Phase N`/`Task`/roadmap references in any committed file (code, config, or docs). A reference to a spec/plan **section** (`spec §6.2`, `plan §5.3`) is fine; a reference to a plan **stage** is not. Verify each library/SDK against its current official docs (context7) before coding — Socket.IO, `@nestjs/websockets`, `@socket.io/redis-adapter`.
12. **No `.gitkeep`/placeholder files and no empty-directory scaffolding.** Directories emerge from real files: `test/e2e/` is created when the first e2e spec lands. Functions ≤ 50 lines, files ≤ 800; TS strict (no `any`); `@fileoverview` + `@layer` header per file. Conventional Commits, no `Co-Authored-By` trailer.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 6.2 `WebSocketTransport`, § 6.3 `CompositeTransport`, § 5.1 `ITransport`, § 8.1–8.2 auth patterns, § 9.2/9.4 rooms & multi-tenant (WS), § 11.4–11.5 Socket.IO Redis adapter & sticky sessions, § 13 event catalog, § 14 error catalog, § 3.2/3.3 subpath exports, § 4.1/4.6 options & injection tokens.
- [`docs/development_plan.md`](../development_plan.md) — § 5 (Phase 4 detail: §5.1 transport, §5.2 gateway, §5.3 IO adapter, §5.4 composite, §5.5 handshake docs, §5.6 e2e, §5.7 validation), § 1.7 Done criteria, § 1.11 attention points.
- `/bymax-workflow:standards` skill — universal coding rules (TypeScript track: strict types, English-only timeless comments, typed errors, layered architecture, Conventional Commits).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 4.1 | `WebSocketTransport` — `ITransport` over Socket.IO | ✅ Done | P1 | M | 1.9, 1.11 |
| 4.2 | `RealtimeGateway` — `@WebSocketGateway()` lifecycle + auth | ✅ Done | P1 | M | 4.1, 2.1 |
| 4.3 | WebSocket handshake auth — 3 patterns unified | ✅ Done | P1 | S | 4.2, 2.2 |
| 4.4 | `@socket.io/redis-adapter` via `RealtimeIoAdapter` | ✅ Done | P1 | M | 4.2 |
| 4.5 | `CompositeTransport` — `transport: 'both'` | ✅ Done | P1 | M | 1.12, 4.1 |
| 4.6 | Module wiring — sse/websocket/both + barrel exports | ✅ Done | P1 | M | 4.1, 4.2, 4.4, 4.5 |
| 4.7 | Auth handshake differences — docs + extraction spec | ✅ Done | P2 | S | 4.3 |
| 4.8 | Tests — `WebSocketTransport` unit + `socket.io-client` e2e | ✅ Done | P1 | L | 4.1, 4.2 |
| 4.9 | Tests — `RealtimeGateway` lifecycle + auth-fail paths | ✅ Done | P1 | L | 4.2, 4.3 |
| 4.10 | Tests — `CompositeTransport` fan-out + tolerance | ✅ Done | P1 | M | 4.5 |
| 4.11 | Tests — Redis adapter unit + cross-instance smoke | ✅ Done | P2 | M | 4.4 |
| 4.12 | Phase validation + 3-mode smoke | ✅ Done | P1 | S | 4.1…4.11 |

---

## Tasks

### Task 4.1 — `WebSocketTransport` — `ITransport` over Socket.IO

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.9, 1.11

#### Description

Implement the `ITransport` contract over a Socket.IO `Server`. Emits use `server.to(room).emit(event, data)`. The transport also owns connection registration (`registerSocket` / `unregisterSocket`) — auto-joining the canonical rooms, recording metadata in `ConnectionRegistry` (with `subject: null`, since WS connections do not use an RxJS `Subject`), and firing lifecycle hooks.

#### Acceptance criteria

- [ ] Implements `ITransport` with `readonly kind = 'websocket' as const`.
- [ ] Uses a **type-only** import of `socket.io` (`import type { Server, Socket }`) — no runtime import, so an SSE-only install typechecks without `socket.io` present.
- [ ] `setServer(server)` stores the instance (called by the gateway's `afterInit`); emit methods are safe no-ops while the server is unset.
- [ ] `emitToUser` / `emitToTenant` / `emitToRoom` call `server.to(room).emit(event, data)`; `broadcast` calls `server.emit(event, data)`.
- [ ] WS emit methods do **NOT** call `pubsub.publish` — cross-instance fan-out is handled by `@socket.io/redis-adapter` (see rule 4).
- [ ] `registerSocket(socket, auth)` registers in `ConnectionRegistry` (`subject: null`), auto-joins `user:{id}` and, when a tenant resolves, `tenant:{id}` (both the real Socket.IO room and the internal `RoomRegistry`), then fires `hooks.onConnect`.
- [ ] `unregisterSocket(connectionId, reason?)` unregisters, leaves all rooms, and fires `hooks.onDisconnect` with a computed `durationMs`.
- [ ] `joinRoom` / `leaveRoom` update **both** the Socket.IO room (authoritative) and the internal `RoomRegistry` (best-effort, for auditing).
- [ ] `disconnect(connectionId)` force-closes the socket via the Socket.IO API.
- [ ] `pnpm typecheck` passes. (The dedicated spec lands in Task 4.8, where 100% line/branch coverage is enforced.)

#### Files to create / modify

- `src/server/transports/websocket/websocket.transport.ts`

#### Agent prompt

````
You are a senior NestJS realtime/transport engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — a dual-transport realtime push library for NestJS
(SSE by default, WebSocket opt-in), with framework-agnostic auth via dependency inversion.
Subpaths: `.` (server), `./shared` (zero-dep types/constants), `./react` (React 19 hooks).
Published to npm; parity with the sibling `@bymax-one/*` libs.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.1 of 12 (FIRST).

PRECONDITIONS
- Phase 1 shipped the `ITransport` interface (Task 1.9), `ConnectionRegistry` + `RoomRegistry`
  (Task 1.11), `ROOM_PREFIXES`/`composeRoomId` in `src/shared/`, and the injection tokens.
- `socket.io` is an OPTIONAL peer dep — it may not be installed in an SSE-only environment.

REQUIRED READING (only these sections — do not load the whole spec/plan):
- `docs/development_plan.md` § 5.1 ("`WebSocketTransport`" — the full skeleton, constructor
  injections, registerSocket/unregisterSocket, emit/join/leave/disconnect bodies).
- `docs/technical_specification.md` § 6.2 ("`WebSocketTransport` — opt-in") and § 5.1 ("ITransport").
- `docs/technical_specification.md` § 9.2 ("Automatic rooms") for the auto-join convention.

TASK
Create `src/server/transports/websocket/websocket.transport.ts` implementing `ITransport` over
a Socket.IO `Server`, following the plan §5.1 skeleton.

DELIVERABLES
1. An `@Injectable()` `WebSocketTransport implements ITransport` with `readonly kind = 'websocket'`.
   - `import type { Server, Socket } from 'socket.io'` (TYPE-ONLY).
   - A private `server: Server | null = null` and `setServer(server: Server): void`.
   - Constructor injects `ConnectionRegistry`, `RoomRegistry`, the authenticator
     (`REALTIME_AUTHENTICATOR_TOKEN`), and the lifecycle hooks (`REALTIME_HOOKS_TOKEN`) per §5.1.
     Expose `authenticator(): IConnectionAuthenticator` returning the injected authenticator
     (the gateway uses it to authenticate the handshake).
2. `registerSocket(socket, auth)`:
   ```typescript
   this.connections.register({
     connectionId: socket.id,
     userId: auth.userId,
     tenantId: auth.tenantId,
     transport: 'websocket',
     ip: socket.handshake.address,
     userAgent: socket.handshake.headers['user-agent'],
     connectedAt: new Date(),
     subject: null,           // WebSocket connections do not use an RxJS Subject
     originalAuth: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
   })
   await socket.join(`${ROOM_PREFIXES.USER}:${auth.userId}`)
   if (auth.tenantId) await socket.join(`${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)
   this.rooms.join(socket.id, `${ROOM_PREFIXES.USER}:${auth.userId}`)
   if (auth.tenantId) this.rooms.join(socket.id, `${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)
   await this.hooks.onConnect?.({ connectionId: socket.id, userId, tenantId, transport: 'websocket', ip, userAgent, connectedAt })
   ```
3. `unregisterSocket(connectionId, reason?)` — unregister from the registry, `rooms.leaveAll(id)`,
   and fire `hooks.onDisconnect` with `durationMs = Date.now() - record.connectedAt.getTime()`.
4. Emit methods (NO `pubsub.publish` — the Socket.IO Redis adapter does cross-instance fan-out):
   ```typescript
   async emitToUser(userId, event, data)   { this.server?.to(`${ROOM_PREFIXES.USER}:${userId}`).emit(event, data) }
   async emitToTenant(tenantId, event, data){ this.server?.to(`${ROOM_PREFIXES.TENANT}:${tenantId}`).emit(event, data) }
   async emitToRoom(roomId, event, data)    { this.server?.to(roomId).emit(event, data) }
   async broadcast(event, data)             { this.server?.emit(event, data) }
   ```
5. `joinRoom`/`leaveRoom` — look the socket up via `this.server?.sockets.sockets.get(connectionId)`;
   when present, call `socket.join`/`socket.leave` AND mirror into `this.rooms`.
6. `disconnect(connectionId)` — `this.server?.sockets.sockets.get(connectionId)?.disconnect(true)`.

Constraints:
- Type-only Socket.IO import; the file must typecheck with `socket.io` absent.
- Do NOT import `@nestjs/jwt`, `passport-*`, or `@bymax-one/nest-auth` (auth inversion).
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; TS strict (no `any`); English/timeless.
- JSDoc on `setServer`, `registerSocket`, `unregisterSocket` (explain WS fan-out via the adapter).

Verification:
- `pnpm typecheck` — expected: clean.
- `grep -rE "from '@nestjs/jwt|from 'passport|from '@bymax-one/nest-auth" src/server/transports/websocket/` — expected: no output.
- `grep -n "pubsub.publish" src/server/transports/websocket/websocket.transport.ts` — expected: no output (WS does not publish).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.2 — `RealtimeGateway` — `@WebSocketGateway()` lifecycle + auth

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 4.1, 2.1

#### Description

Implement the NestJS gateway that manages the WebSocket handshake and connection lifecycle. It builds a transport-agnostic `ConnectionAuthContext` from the handshake (cookies, headers, query, ip, user-agent), authenticates through the injected `IConnectionAuthenticator`, registers the socket via `WebSocketTransport`, and emits `connection:established`. Auth inversion is reaffirmed: the gateway never imports a concrete auth library.

#### Acceptance criteria

- [ ] `@WebSocketGateway()` gateway implements `OnGatewayInit`, `OnGatewayConnection`, `OnGatewayDisconnect`.
- [ ] Authentication flows **only** through the injected `IConnectionAuthenticator` — NO import of `@nestjs/jwt`, `passport-*`, or `@bymax-one/nest-auth`.
- [ ] `afterInit(server)` calls `transport.setServer(server)`.
- [ ] `handleConnection` builds the `ConnectionAuthContext`: `cookies` via `parseCookieHeader`, lower-cased/normalized `headers`, `query`, `ip = socket.handshake.address`, `userAgent`, `transport: 'websocket'`.
- [ ] Invalid auth (`authenticate` returns `null`) → `socket.disconnect(true)` (maps to `REALTIME_AUTH_FAILED`); no registration.
- [ ] Valid auth → `transport.registerSocket(socket, auth)`, then `socket.emit('connection:established', { connectionId, traits })` as the first event — unless `sse.emitConnectionEvent === false`.
- [ ] `handleDisconnect(socket)` calls `transport.unregisterSocket(socket.id, reason)`.
- [ ] `pnpm typecheck` passes; auth-inversion grep returns zero. (Unit spec + 100% coverage land in Task 4.9.)

#### Files to create / modify

- `src/server/transports/websocket/realtime.gateway.ts`

#### Agent prompt

````
You are a senior NestJS realtime/gateway engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion. Subpaths `.`/`./shared`/`./react`.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.2 of 12.

PRECONDITIONS
- Task 4.1 shipped `WebSocketTransport` (with `setServer`, `authenticator()`, `registerSocket`,
  `unregisterSocket`). Phase 1/2 shipped `parseCookieHeader`, `RESERVED_EVENT_NAMES`, the options token,
  and `IConnectionAuthenticator` (Task 2.1 refactored the SSE auth path).

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.2 ("`RealtimeGateway`" — the full skeleton incl. `normalizeHeaders`).
- `docs/technical_specification.md` § 6.2 (gateway lifecycle), § 8.1 (the 3 auth patterns),
  § 13 (the `connection:established` reserved event + payload `{ connectionId, traits }`).

AUTH INVERSION (reaffirmed): the gateway authenticates ONLY through the injected
`IConnectionAuthenticator`. There must be NO reference to `JwtService`/`JwtPayload`/`@nestjs/jwt`/
`passport-*`/`@bymax-one/nest-auth` in this file nor any other file of `src/`.

TASK
Create `src/server/transports/websocket/realtime.gateway.ts` per the plan §5.2 skeleton.

DELIVERABLES
1. A `@WebSocketGateway({ cors: { origin: true, credentials: true } })` class implementing the
   three lifecycle interfaces, with `@WebSocketServer() server!: Server` (type-only `socket.io` import).
   Constructor injects `WebSocketTransport` and the options (`REALTIME_OPTIONS_TOKEN`).
   NOTE: `@WebSocketGateway` args are evaluated at class-decoration time, so the configured
   `websocket.namespace`/`cors`/`ping*` are applied by `RealtimeIoAdapter` (Task 4.4), not here.
2. `afterInit(server)` → `this.transport.setServer(server)`.
3. `handleConnection(socket)`:
   ```typescript
   const ctx = {
     cookies: parseCookieHeader(socket.handshake.headers.cookie ?? ''),
     headers: this.normalizeHeaders(socket.handshake.headers),
     query: socket.handshake.query as Record<string, string | undefined>,
     ip: socket.handshake.address,
     userAgent: socket.handshake.headers['user-agent'],
     transport: 'websocket' as const,
   }
   const auth = await this.transport.authenticator().authenticate(ctx)
   if (!auth) { socket.disconnect(true); return }
   await this.transport.registerSocket(socket, auth)
   if (this.options.sse?.emitConnectionEvent !== false) {
     socket.emit(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED, {
       connectionId: socket.id,
       traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
     })
   }
   ```
   (Use the canonical reserved-event constant from `src/shared/` — re-exported via the server index.)
4. `handleDisconnect(socket)` → `await this.transport.unregisterSocket(socket.id, 'CLIENT_DISCONNECT')`.
5. A private `normalizeHeaders(input)` that lower-cases keys and joins array header values with ','.

Constraints:
- Auth inversion (no concrete auth imports). Type-only Socket.IO import.
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; TS strict; English/timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `grep -rE "from '@nestjs/jwt|from 'passport|from '@bymax-one/nest-auth" src/server/transports/websocket/realtime.gateway.ts` — expected: no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.3 — WebSocket handshake auth — 3 patterns unified

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.2, 2.2

#### Description

Ensure the three auth patterns (cookie, ticket, bearer) all reach the authenticator through the unified `ConnectionAuthContext` on the WebSocket handshake. Unlike SSE (where `EventSource` strips custom headers), the WebSocket handshake carries the full header set and Socket.IO exposes a dedicated `auth` field — so the Bearer pattern is viable. The gateway merges Socket.IO's convenience fields (`socket.handshake.auth.token`, `socket.handshake.auth.ticket`) into the context.

#### Acceptance criteria

- [ ] `docs/architecture/websocket-handshake.md` created, documenting the three patterns specifically for WebSocket (HttpOnly cookie; ticket via query or `auth.ticket`; Bearer via header or `auth.token`).
- [ ] `RealtimeGateway.handleConnection` merges `socket.handshake.auth.token` into `ctx.headers['authorization'] = 'Bearer <token>'` and surfaces `socket.handshake.auth.ticket` into `ctx.query.ticket`.
- [ ] All three patterns reach the authenticator through the single `ConnectionAuthContext` shape — the authenticator decides which credential to use.
- [ ] The merge is null-safe (absent `auth` object does not throw).
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/transports/websocket/realtime.gateway.ts` (extend `handleConnection`)
- `docs/architecture/websocket-handshake.md`

#### Agent prompt

````
You are a senior NestJS realtime/security engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.3 of 12.

PRECONDITIONS
- Task 4.2 shipped `RealtimeGateway.handleConnection` building a `ConnectionAuthContext`.
- Task 2.2 shipped `IConnectionAuthenticator` reference patterns (cookie, ticket) and the
  example `@bymax-one/nest-auth` bridge (in docs, not in lib code).

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.5 ("Auth handshake differences").
- `docs/technical_specification.md` § 8.1 ("Three supported patterns") and § 8.2 ("Pattern comparison").

TASK
Unify the three auth patterns on the WebSocket handshake so each reaches the authenticator
through the single `ConnectionAuthContext`.

DELIVERABLES
1. Extend `handleConnection` to merge Socket.IO's dedicated `auth` field BEFORE authenticating:
   ```typescript
   const handshakeAuth = socket.handshake.auth as { token?: string; ticket?: string } | undefined
   if (handshakeAuth?.token) ctx.headers['authorization'] = `Bearer ${handshakeAuth.token}`
   if (handshakeAuth?.ticket) ctx.query.ticket = handshakeAuth.ticket
   ```
   (Merge is null-safe; the existing header/query/cookie context is preserved.)
2. `docs/architecture/websocket-handshake.md` documenting the three patterns FOR WEBSOCKET:
   - HttpOnly Cookie — same as SSE; works same-origin or with CORS `credentials`.
   - Ticket — query string `?ticket=xyz` OR (preferred for Socket.IO clients) `io(url, { auth: { ticket } })`.
   - Bearer header — `Authorization: Bearer xyz` via `extraHeaders`, OR (preferred) `io(url, { auth: { token } })`,
     which the gateway normalizes into the `authorization` header. Explain WHY Bearer works on WS but not SSE
     (EventSource strips custom headers; the WS handshake does not).

Constraints:
- Auth inversion — no concrete auth imports; the gateway only shapes the context.
- English/timeless docs (reference spec §8.1/§8.2 by section, not by plan stage).

Verification:
- `pnpm typecheck` — expected: clean.
- `ls docs/architecture/websocket-handshake.md` — expected: present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.4 — `@socket.io/redis-adapter` via `RealtimeIoAdapter`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 4.2

#### Description

Provide a custom NestJS `IoAdapter` that (a) applies the configured `websocket` options (`cors`, `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize`, namespace) to the Socket.IO server it creates, and (b) registers `@socket.io/redis-adapter` when `websocket.redisAdapter.pubClient` is provided — giving transparent cross-instance fan-out for the WebSocket transport. The adapter package is loaded lazily so it stays an optional peer dep.

#### Acceptance criteria

- [ ] `src/server/transports/websocket/realtime-io-adapter.ts` exports `RealtimeIoAdapter extends IoAdapter`; `createIOServer` applies `cors`, `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize` from the `websocket` options (with the documented defaults).
- [ ] When `websocket.redisAdapter.pubClient` is provided, `@socket.io/redis-adapter`'s `createAdapter` is installed; `pubClient.duplicate()` creates the subscriber client.
- [ ] `@socket.io/redis-adapter` is loaded lazily (dynamic `require`/`import`) so it stays an optional peer dep — its absence does not crash the lib.
- [ ] Failure to load/install the adapter is logged (error/warn) and tolerated — the lib degrades to single-instance and never throws.
- [ ] `docs/architecture/scaling-cheatsheet.md` created with the transport → fan-out table (SSE: `IRealtimePubSub`; WS: `@socket.io/redis-adapter`; both: each transport scales independently) plus the mandatory sticky-sessions caveat for polling fallback.
- [ ] `pnpm typecheck` passes. (Unit + cross-instance smoke specs land in Task 4.11.)

#### Files to create / modify

- `src/server/transports/websocket/realtime-io-adapter.ts`
- `docs/architecture/scaling-cheatsheet.md`

#### Agent prompt

````
You are a senior NestJS realtime/scaling engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.4 of 12.

PRECONDITIONS
- Tasks 4.1/4.2 shipped `WebSocketTransport` + `RealtimeGateway`. The `websocket` options
  (`namespace`, `cors`, `pingIntervalMs`, `pingTimeoutMs`, `maxHttpBufferSize`, `redisAdapter.pubClient`)
  are defined in `BymaxRealtimeModuleOptions`. `@socket.io/redis-adapter` and `ioredis` are OPTIONAL peer deps.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.3 ("`@socket.io/redis-adapter` integration" — the `RealtimeIoAdapter` skeleton).
- `docs/technical_specification.md` § 11.4 ("For WebSocket — `@socket.io/redis-adapter`"), § 11.5
  ("Sticky sessions vs the Redis adapter"), § 4.1/4.2 (the `websocket` options + defaults).

Before coding, verify the current `@nestjs/platform-socket.io` `IoAdapter` API and the
`@socket.io/redis-adapter` `createAdapter` signature against their official docs (context7).

TASK
Create `src/server/transports/websocket/realtime-io-adapter.ts` per plan §5.3, plus the scaling
cheatsheet doc.

DELIVERABLES
1. `RealtimeIoAdapter extends IoAdapter`:
   - Constructor `(app: INestApplicationContext)` resolves `this.options = app.get(REALTIME_OPTIONS_TOKEN)`.
   - `override createIOServer(port, opts?)`:
     ```typescript
     const wsOpts = this.options.websocket ?? {}
     const merged = {
       ...opts,
       cors: wsOpts.cors ?? opts?.cors,
       pingInterval: wsOpts.pingIntervalMs ?? 25_000,
       pingTimeout: wsOpts.pingTimeoutMs ?? 20_000,
       maxHttpBufferSize: wsOpts.maxHttpBufferSize ?? 1_000_000,
     }
     const server = super.createIOServer(port, merged) as { adapter: (a: unknown) => void }
     if (wsOpts.redisAdapter?.pubClient) this.installRedisAdapter(server, wsOpts.redisAdapter.pubClient)
     return server
     ```
   - Private `installRedisAdapter(server, pubClient)`: lazy-load `@socket.io/redis-adapter`
     (`require`/dynamic import), `const sub = pubClient.duplicate()`,
     `server.adapter(createAdapter(pubClient, sub))`; wrap in try/catch — log on failure, never throw.
   - Document the `main.ts` usage in a JSDoc block:
     `app.useWebSocketAdapter(new RealtimeIoAdapter(app))`.
2. `docs/architecture/scaling-cheatsheet.md` with:
   | Transport | Cross-instance fan-out |
   |---|---|
   | SSE only | `IRealtimePubSub` (e.g. a Redis-backed implementation) |
   | WS only | `@socket.io/redis-adapter` (preferred) |
   | Both | each transport scales independently (SSE via `IRealtimePubSub`, WS via the adapter) |
   …plus a callout: sticky sessions are MANDATORY for scaled WebSocket when the polling fallback
   is enabled; the adapter fans out messages but does not remove the affinity requirement (§11.5).

Constraints:
- `@socket.io/redis-adapter` MUST be lazily loaded (optional peer dep) — absence does not crash.
- Auth inversion (no concrete auth imports). `@fileoverview` + `@layer` header; functions ≤ 50 lines;
  TS strict; English/timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `grep -n "require('@socket.io/redis-adapter')\|import('@socket.io/redis-adapter')" src/server/transports/websocket/realtime-io-adapter.ts` — expected: a lazy load (not a top-level import).
- `ls docs/architecture/scaling-cheatsheet.md` — expected: present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.5 — `CompositeTransport` — `transport: 'both'`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.12, 4.1

#### Description

When `transport: 'both'`, deliver a `CompositeTransport` that fans every emit out to both the SSE and WebSocket transports in parallel. Emits use `Promise.allSettled` so a failure in one transport is logged and does not abort the other; `joinRoom`/`leaveRoom`/`disconnect` try both tolerantly (only the transport owning the connection succeeds). There is no double-delivery: each connection lives on exactly one transport.

#### Acceptance criteria

- [ ] `src/server/transports/composite/composite.transport.ts` implements `ITransport` with `readonly kind = 'sse' as const` (dominant transport — distinct from the module-level `TransportMode` `'both'`).
- [ ] `emitToUser` / `emitToTenant` / `emitToRoom` / `broadcast` fan out to both SSE and WS; a rejection in one transport is logged (warn) and does not abort the other (`Promise.allSettled`).
- [ ] `joinRoom` / `leaveRoom` / `disconnect` try both transports tolerantly — only the owning transport succeeds; the other's rejection is swallowed.
- [ ] No double-delivery: a room-scoped emit reaches each connection exactly once (each connection is on one transport).
- [ ] `pnpm typecheck` passes. (Spec + 100% coverage land in Task 4.10.)

#### Files to create / modify

- `src/server/transports/composite/composite.transport.ts`

#### Agent prompt

````
You are a senior NestJS realtime/transport engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.5 of 12.

PRECONDITIONS
- Task 1.12 shipped `SseTransport`; Task 4.1 shipped `WebSocketTransport`. Both implement `ITransport`.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.4 ("`CompositeTransport` — mode 'both'" — the skeleton + `fanOut` helper).
- `docs/technical_specification.md` § 6.3 ("`CompositeTransport`") — note the `kind = 'sse'` rationale.

TASK
Create `src/server/transports/composite/composite.transport.ts` per plan §5.4.

DELIVERABLES
1. `@Injectable()` `CompositeTransport implements ITransport`:
   - `readonly kind = 'sse' as const` — the composite reports the dominant transport; `ITransport.kind`
     is `'sse' | 'websocket'`, so `'both'` (the module-level `TransportMode`) is NOT a valid `kind`.
   - Constructor injects `SseTransport` and `WebSocketTransport`.
2. Emit methods delegate to a private `fanOut(op, ...tasks)` that runs `Promise.allSettled` over the
   two transport calls and logs each rejection as `warn` (`"Composite <op> partially failed: <message>"`),
   without aborting the other:
   ```typescript
   async emitToUser(userId, event, data) {
     await this.fanOut('emitToUser',
       () => this.sse.emitToUser(userId, event, data),
       () => this.ws.emitToUser(userId, event, data))
   }
   // identical shape for emitToTenant / emitToRoom / broadcast
   ```
3. `joinRoom`/`leaveRoom`/`disconnect` — `Promise.all` over both transports, each `.catch(() => undefined)`
   (only the transport owning the connection succeeds; the other's failure is expected and swallowed).

Constraints:
- `kind` MUST be `'sse'` (never `'both'`). No double-delivery — do not iterate connections here;
  rely on each transport's own room membership.
- `@fileoverview` + `@layer` header; functions ≤ 50 lines; TS strict; English/timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `grep -n "readonly kind = 'sse'" src/server/transports/composite/composite.transport.ts` — expected: match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.6 — Module wiring — sse/websocket/both + barrel exports

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 4.1, 4.2, 4.4, 4.5

#### Description

Teach `BymaxRealtimeModule.forRoot` and `forRootAsync` to resolve all three transport modes with the correct providers, controllers, gateway, and `REALTIME_TRANSPORT_TOKEN` binding. Detect missing WebSocket peer deps with an actionable error, and update the server barrel to export the new public surface.

#### Acceptance criteria

- [ ] `forRoot` and `forRootAsync` resolve `'sse' | 'websocket' | 'both'` with the correct providers/controllers/gateway and `REALTIME_TRANSPORT_TOKEN` binding.
- [ ] `'sse'` → `SseTransport` bound to the token (+ the SSE controller). `'websocket'` → `WebSocketTransport` + `RealtimeGateway`, token → `WebSocketTransport`. `'both'` → `SseTransport` + `WebSocketTransport` + `CompositeTransport` + `RealtimeGateway` + the SSE controller, token → `CompositeTransport`.
- [ ] When `transport` includes `'websocket'`/`'both'`, missing WS peer deps (`@nestjs/websockets`, `socket.io`) are detected (`require.resolve`) and produce an actionable error explaining which package to install.
- [ ] The server barrel `src/server/index.ts` exports `WebSocketTransport`, `RealtimeGateway`, `CompositeTransport`, and `RealtimeIoAdapter`.
- [ ] `pnpm typecheck && pnpm build` pass.

#### Files to create / modify

- `src/server/realtime.module.ts`
- `src/server/index.ts`

#### Agent prompt

````
You are a senior NestJS module/architecture engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion. Subpaths `.`/`./shared`/`./react`.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.6 of 12.

PRECONDITIONS
- Tasks 4.1/4.2/4.4/4.5 shipped `WebSocketTransport`, `RealtimeGateway`, `RealtimeIoAdapter`,
  `CompositeTransport`. Phase 1 shipped `forRoot`/`forRootAsync` for the `'sse'` path,
  the SSE controller factory, and `REALTIME_TRANSPORT_TOKEN`.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.1 + § 5.4 ("Modification in the module" — the both-mode provider block).
- `docs/technical_specification.md` § 3.2/3.3 (subpath exports — what `.` must export),
  § 4.1 (`TransportMode`), § 4.6 (injection tokens).

TASK
Resolve all three transport modes in `forRoot`/`forRootAsync` and update the server barrel.

DELIVERABLES
1. In `forRoot`/`forRootAsync`, build providers/controllers based on the resolved `transport`:
   - Always: the common providers (registries, id generator, options, authenticator, hooks, pubsub).
   - `transport` includes `'sse'` → push `SseTransport` + SSE controller; for `'sse'` mode,
     `{ provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport }`.
   - `transport` includes `'websocket'` → FIRST assert the WS peer deps resolve:
     ```typescript
     try { require.resolve('@nestjs/websockets'); require.resolve('socket.io') }
     catch { throw new Error("transport 'websocket'|'both' requires '@nestjs/websockets' and 'socket.io' — install them, or use transport: 'sse'.") }
     ```
     then push `WebSocketTransport` + `RealtimeGateway`; for `'websocket'` mode,
     `{ provide: REALTIME_TRANSPORT_TOKEN, useExisting: WebSocketTransport }`.
   - `transport === 'both'` → push `SseTransport`, `WebSocketTransport`, `CompositeTransport`,
     `RealtimeGateway`, the SSE controller, and `{ provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport }`.
   - `forRootAsync` uses the same mode-resolution logic (resolved options come from the factory).
2. Update `src/server/index.ts` to export the new WS/composite surface:
   ```typescript
   export { WebSocketTransport } from './transports/websocket/websocket.transport'
   export { RealtimeGateway } from './transports/websocket/realtime.gateway'
   export { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'
   export { CompositeTransport } from './transports/composite/composite.transport'
   ```

Constraints:
- WS peer-dep detection must be a clear, actionable error (name the packages). Do NOT statically
  import `socket.io` at module top-level (keep it optional).
- Auth inversion preserved. `@fileoverview` + `@layer` header on touched files; English/timeless comments.

Verification:
- `pnpm typecheck && pnpm build` — expected: both pass; `dist/` has `.mjs`/`.cjs`/`.d.ts` for `.`.
- `node -e "console.log(Object.keys(require('./dist/server/index.cjs')))"` — expected: includes
  `WebSocketTransport`, `RealtimeGateway`, `RealtimeIoAdapter`, `CompositeTransport`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.7 — Auth handshake differences — docs + extraction spec

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: S
- **Depends on**: 4.3

#### Description

Consolidate the transport auth differences into one document (the full SSE-vs-WebSocket matrix with a per-transport recommendation) and pin the gateway's handshake-extraction behavior with a dedicated spec. Auth inversion is reaffirmed: the only changes are documentation and a test — no new production change in `src/` beyond what Task 4.3 already shipped.

#### Acceptance criteria

- [ ] `docs/architecture/auth-handshake-differences.md` created with the full transport matrix (cookie / ticket / bearer across **SSE EventSource**, **SSE server-side fetch**, **WebSocket (Socket.IO)**) and a per-transport recommendation.
- [ ] Each matrix row is accompanied by a client-side snippet and an authenticator-side snippet.
- [ ] `src/server/transports/websocket/auth-extraction.spec.ts` asserts that `socket.handshake.auth.token` is normalized into `headers.authorization` and that the `cookie` header is parsed via `parseCookieHeader`.
- [ ] Auth inversion preserved — the source diff is docs + a test only.

#### Files to create / modify

- `docs/architecture/auth-handshake-differences.md`
- `src/server/transports/websocket/auth-extraction.spec.ts`

#### Agent prompt

````
You are a senior NestJS realtime/security engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.7 of 12.

PRECONDITIONS
- Task 4.3 unified the three auth patterns on the WS handshake (gateway merges `auth.token`/`auth.ticket`).

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.5 ("Auth handshake differences").
- `docs/technical_specification.md` § 8.1 ("Three supported patterns"), § 8.2 ("Pattern comparison"),
  § 14 (the `REALTIME_AUTH_FAILED` mapping).

AUTH INVERSION (reaffirmed): the ONLY changes in this task are documentation and a test. There must
be NO reference to `JwtService`/`@nestjs/jwt`/`passport-*`/`@bymax-one/nest-auth` in any `src/` file
(mocks in the spec are allowed).

TASK
Consolidate the auth-handshake documentation and add the extraction spec.

DELIVERABLES
1. `docs/architecture/auth-handshake-differences.md` containing:
   - A matrix with rows = patterns (Cookie HttpOnly / Ticket / Bearer header) and columns =
     SSE (EventSource browser) / SSE (server-side fetch) / WebSocket (Socket.IO), filled with
     ✅/❌/⚠️ + a one-line note per cell (e.g. Bearer is ❌ on EventSource — the browser strips
     custom headers; ✅ on WS via `auth.token`/`extraHeaders`).
   - For each pattern: a client-side snippet and an authenticator-side snippet.
   - A short "Recommendation per transport" section.
2. `src/server/transports/websocket/auth-extraction.spec.ts` — unit tests on the gateway's
   handshake handling with a mocked `Socket`:
   - `socket.handshake.auth.token` → the built context carries `headers.authorization = 'Bearer <token>'`.
   - `socket.handshake.headers.cookie` is parsed by `parseCookieHeader` into `ctx.cookies`.
   - The authenticator receives the unified context (assert via a mocked `IConnectionAuthenticator`).

Constraints:
- Auth inversion (docs + test only; no concrete auth imports in `src/`).
- English/timeless docs (reference spec §8.1/§8.2 by section). Each `it()` carries a comment.

Verification:
- `pnpm test src/server/transports/websocket/auth-extraction.spec.ts` — expected: green.
- `ls docs/architecture/auth-handshake-differences.md` — expected: present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.8 — Tests — `WebSocketTransport` unit + `socket.io-client` e2e

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: L
- **Depends on**: 4.1, 4.2

#### Description

Cover `WebSocketTransport` with unit specs (mocked Socket.IO `Server`/`Socket`) and add an end-to-end spec that boots a real NestJS app and drives it with `socket.io-client`. This is the first e2e spec in the repo, so `test/e2e/` emerges here when the file is written.

#### Acceptance criteria

- [ ] `src/server/transports/websocket/websocket.transport.spec.ts` — 8+ unit cases (mocked `Server`/`Socket`): `emitToUser`/`emitToTenant`/`emitToRoom` call `server.to(room).emit(...)`; `broadcast` calls `server.emit(...)`; `joinRoom`/`leaveRoom` call `socket.join`/`socket.leave` + mirror `RoomRegistry`; `disconnect` calls `socket.disconnect(true)`; `registerSocket` auto-joins + fires `hooks.onConnect`; `unregisterSocket` leaves all + fires `hooks.onDisconnect`; emit is a safe no-op while the server is unset.
- [ ] `test/e2e/websocket.e2e-spec.ts` — 6+ cases with real `socket.io-client`: valid auth → `connection:established`; invalid auth → disconnect; `emitToUser` reaches the client; auto-join `user:{id}`/`tenant:{id}` verified via room emit; manual client disconnect → `handleDisconnect` (registry cleared); ticket via `io(url, { auth: { ticket } })` authenticates.
- [ ] 100% line/branch coverage on `websocket.transport.ts`.
- [ ] `pnpm typecheck` proves SSE-only mode compiles without `socket.io` runtime (type-only import) — and the e2e suite uses `socket.io-client` from devDependencies.

#### Files to create / modify

- `src/server/transports/websocket/websocket.transport.spec.ts`
- `test/e2e/websocket.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.8 of 12.

PRECONDITIONS
- Tasks 4.1/4.2/4.4/4.6 shipped `WebSocketTransport`, `RealtimeGateway`, `RealtimeIoAdapter`,
  and the module wiring. `socket.io-client`, `@nestjs/platform-socket.io`, `socket.io` are devDeps for tests.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.1 (transport behavior) + § 5.6 (the `socket.io-client` e2e skeleton).
- `docs/technical_specification.md` § 6.2 (`WebSocketTransport`).

TASK
Write the `WebSocketTransport` unit spec and the WebSocket e2e spec, driving 100% line/branch
coverage on `websocket.transport.ts`.

DELIVERABLES
1. `src/server/transports/websocket/websocket.transport.spec.ts` — 8+ cases with a mocked Socket.IO
   `Server` (`to`/`emit`/`sockets.sockets.get`) and `Socket` (`join`/`leave`/`disconnect`):
   emitToUser → `to('user:X').emit(event, data)`; emitToTenant → `to('tenant:X').emit(...)`;
   emitToRoom → `to(roomId).emit(...)`; broadcast → `emit(...)`; joinRoom → `socket.join` + RoomRegistry;
   leaveRoom → `socket.leave` + RoomRegistry; disconnect → `socket.disconnect(true)`;
   registerSocket → registry + auto-join + `hooks.onConnect`; unregisterSocket → leaveAll + `hooks.onDisconnect`
   (with `durationMs`); emit before `setServer` is a safe no-op.
2. `test/e2e/websocket.e2e-spec.ts` — boot a real app with `BymaxRealtimeModule.forRoot({ transport: 'websocket', authenticator })`,
   `app.useWebSocketAdapter(new RealtimeIoAdapter(app))`, `app.listen(0)`, then with `socket.io-client`:
   - connect with a valid `auth.token`/`auth.ticket` → receives `connection:established`;
   - connect with invalid auth → disconnected (no `connect`);
   - server `emitToUser('u-test', 'evt', {...})` → the connected client receives it;
   - server `emitToRoom` after the client auto-joined `user:{id}`/`tenant:{id}` → received;
   - client `close()` → server `handleDisconnect` clears the registry;
   - ticket pattern via `io(url, { auth: { ticket } })` authenticates.

Constraints:
- The unit spec must reach 100% line/branch on `websocket.transport.ts`. Use real branches, not
  fake assertions. Each `it()` carries a one-line comment explaining what it verifies.
- Use Jest (ts-jest); bound workers (`--maxWorkers=2`) to keep memory safe. English/timeless.

Verification:
- `pnpm test src/server/transports/websocket/websocket.transport.spec.ts -- --coverage` — expected:
  100% line/branch on `websocket.transport.ts`.
- `pnpm test:e2e -- websocket` — expected: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.9 — Tests — `RealtimeGateway` lifecycle + auth-fail paths

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: L
- **Depends on**: 4.2, 4.3

#### Description

Unit-test the gateway end to end with everything mocked (no live sockets): the init/connect/disconnect lifecycle, the auth-fail path, context extraction (cookies, header normalization, handshake `auth` merge), and hook resilience.

#### Acceptance criteria

- [ ] `src/server/transports/websocket/realtime.gateway.spec.ts` — 12+ cases (all mocked): `afterInit` → `transport.setServer`; valid connection → `registerSocket`; auto-join `user:{id}`/`tenant:{id}`; emits `connection:established`; `hooks.onConnect` fired; invalid auth → `socket.disconnect(true)` + no register; cookies parsed; headers normalized; `socket.handshake.auth.token`/`.ticket` merged into the context; `handleDisconnect` → `unregisterSocket` with reason; a hook throwing does not break the connection lifecycle; `connection:established` suppressed when `emitConnectionEvent === false`.
- [ ] 100% line/branch coverage on `realtime.gateway.ts`.
- [ ] Auth-inversion grep over `src/` returns zero.

#### Files to create / modify

- `src/server/transports/websocket/realtime.gateway.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.9 of 12.

PRECONDITIONS
- Tasks 4.2/4.3 shipped `RealtimeGateway` with handshake auth unification.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.2 (gateway skeleton) + § 5.5 (handshake auth merge).
- `docs/technical_specification.md` § 6.2 (lifecycle), § 8.1 (patterns), § 13 (`connection:established`).

TASK
Write `src/server/transports/websocket/realtime.gateway.spec.ts` as pure unit tests (no live
sockets), driving 100% line/branch coverage on `realtime.gateway.ts`.

DELIVERABLES
12+ cases, mocking `WebSocketTransport`, `IConnectionAuthenticator`, the options, and a `Socket`:
1. `afterInit(server)` → `transport.setServer(server)`.
2. valid `handleConnection` → `transport.registerSocket(socket, auth)`.
3. valid → auto-join is delegated to the transport (assert `registerSocket` received the auth).
4. valid → `socket.emit('connection:established', { connectionId, traits })`.
5. valid → the authenticator received a context with `transport: 'websocket'`.
6. invalid auth (authenticate → null) → `socket.disconnect(true)`, no `registerSocket`.
7. cookies extracted via `parseCookieHeader` from `handshake.headers.cookie`.
8. headers normalized (lower-cased keys; array values joined).
9. `socket.handshake.auth.token` → context `headers.authorization = 'Bearer <token>'`.
10. `socket.handshake.auth.ticket` → context `query.ticket`.
11. `handleDisconnect` → `transport.unregisterSocket(socket.id, <reason>)`.
12. `emitConnectionEvent === false` → no `connection:established` emitted.
13. a `hooks`/`registerSocket` rejection does not throw out of `handleConnection` (resilience).

Constraints:
- 100% line/branch on `realtime.gateway.ts`; real branches, no fake assertions. Each `it()` commented.
- No concrete-auth imports in `src/` (mocks only in the spec). Bound workers (`--maxWorkers=2`).

Verification:
- `pnpm test src/server/transports/websocket/realtime.gateway.spec.ts -- --coverage` — expected:
  100% line/branch on `realtime.gateway.ts`.
- `grep -rE "from '@nestjs/jwt|from 'passport|from '@bymax-one/nest-auth" src/` — expected: no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.10 — Tests — `CompositeTransport` fan-out + tolerance

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 4.5

#### Description

Unit-test `CompositeTransport`: every emit reaches both SSE and WS with identical args; a failure in one transport is logged and tolerated; join/leave/disconnect tolerate one side failing; `kind` is `'sse'`.

#### Acceptance criteria

- [ ] `src/server/transports/composite/composite.transport.spec.ts` — 10+ cases: `emitToUser`/`emitToTenant`/`emitToRoom`/`broadcast` each call both `sse.*` and `ws.*` with identical args; a rejection in one transport still invokes the other and logs a warn (`Promise.allSettled`); `joinRoom`/`leaveRoom`/`disconnect` tolerate one side failing; both sides failing is tolerated; `kind === 'sse'`.
- [ ] 100% line/branch coverage on `composite.transport.ts`.

#### Files to create / modify

- `src/server/transports/composite/composite.transport.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.10 of 12.

PRECONDITIONS
- Task 4.5 shipped `CompositeTransport` (fan-out via `Promise.allSettled`, `kind = 'sse'`).

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.4 (`CompositeTransport`).
- `docs/technical_specification.md` § 6.3 (`CompositeTransport`).

TASK
Write `src/server/transports/composite/composite.transport.spec.ts`, driving 100% line/branch
coverage on `composite.transport.ts`.

DELIVERABLES
10+ cases, mocking `SseTransport` and `WebSocketTransport`:
1. `emitToUser` calls both `sse.emitToUser` and `ws.emitToUser` with identical args.
2. `emitToTenant` — same (both sides, identical args).
3. `emitToRoom` — same.
4. `broadcast` — same.
5. SSE emit rejects → WS emit is STILL invoked; a warn is logged; `emitToUser` resolves (allSettled).
6. WS emit rejects → SSE still invoked; warn logged; resolves.
7. `joinRoom` — SSE rejects + WS resolves → resolves (the owning transport succeeds).
8. `joinRoom` — both reject → still resolves (tolerated).
9. `leaveRoom` — one side rejects → resolves.
10. `disconnect` — one side rejects → resolves.
11. `kind === 'sse'`.

Constraints:
- 100% line/branch on `composite.transport.ts`; assert the warn-logging branch (spy the logger).
  Each `it()` carries a one-line comment. Bound workers (`--maxWorkers=2`). English/timeless.

Verification:
- `pnpm test src/server/transports/composite/composite.transport.spec.ts -- --coverage` — expected:
  100% line/branch on `composite.transport.ts`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.11 — Tests — Redis adapter unit + cross-instance smoke

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: M
- **Depends on**: 4.4

#### Description

Cover `RealtimeIoAdapter` with a unit spec (options application + adapter install with a mocked `@socket.io/redis-adapter` + load-failure tolerance) and a cross-instance smoke e2e: two Socket.IO servers sharing one (mocked) Redis, an emit on server A reaches a `socket.io-client` connected to server B — proving the adapter does cross-instance fan-out.

#### Acceptance criteria

- [ ] `src/server/transports/websocket/realtime-io-adapter.spec.ts` — unit cases: `createIOServer` applies `cors`/`pingInterval`/`pingTimeout`/`maxHttpBufferSize`; adapter installed when `pubClient` present (with a mocked `@socket.io/redis-adapter`); `pubClient.duplicate()` called for the subscriber; load/install failure is logged and tolerated (no throw).
- [ ] `test/e2e/ws-redis-adapter.e2e-spec.ts` — 3+ smoke cases with `ioredis-mock` (shared Redis): `createIOServer` installs the adapter without throwing; single-instance local emit works; **cross-instance** — two io servers on one Redis, emit on A reaches a `socket.io-client` connected to B.
- [ ] 100% line/branch coverage on `realtime-io-adapter.ts` (config + install path); the cross-instance fan-out is verified by the e2e smoke.

#### Files to create / modify

- `src/server/transports/websocket/realtime-io-adapter.spec.ts`
- `test/e2e/ws-redis-adapter.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.11 of 12.

PRECONDITIONS
- Task 4.4 shipped `RealtimeIoAdapter` (options application + lazy `@socket.io/redis-adapter`).
- `ioredis-mock`, `socket.io`, `socket.io-client`, `@socket.io/redis-adapter` are devDeps for tests.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.3 (`RealtimeIoAdapter`) + § 5.6 (e2e harness).
- `docs/technical_specification.md` § 11.4 (Socket.IO Redis adapter).

TASK
Write the `RealtimeIoAdapter` unit spec and the cross-instance smoke e2e, driving 100% line/branch
coverage on `realtime-io-adapter.ts`.

DELIVERABLES
1. `src/server/transports/websocket/realtime-io-adapter.spec.ts` — unit cases (mock the parent
   `IoAdapter.createIOServer` and `@socket.io/redis-adapter.createAdapter`):
   - `createIOServer` passes merged `cors`/`pingInterval`/`pingTimeout`/`maxHttpBufferSize` to super.
   - `pubClient` present → `createAdapter` called; `pubClient.duplicate()` called for the sub client.
   - `pubClient` absent → no adapter installed.
   - a throwing `createAdapter`/load failure is caught and logged (no throw out of `createIOServer`).
2. `test/e2e/ws-redis-adapter.e2e-spec.ts` — with `ioredis-mock` as the shared Redis:
   - `createIOServer` with `redisAdapter.pubClient` installs the adapter without throwing.
   - single instance: a local `emitToUser` reaches a connected client.
   - cross-instance: stand up TWO io servers backed by the same mock Redis; a `socket.io-client`
     connects to server B; an `emitToUser` on server A reaches that client (adapter fan-out).

Constraints:
- 100% line/branch on `realtime-io-adapter.ts` (mock the optional adapter module so the install
  and failure branches are both exercised). Each `it()` carries a comment. Bound workers (`--maxWorkers=2`).
- English/timeless comments.

Verification:
- `pnpm test src/server/transports/websocket/realtime-io-adapter.spec.ts -- --coverage` — expected:
  100% line/branch on `realtime-io-adapter.ts`.
- `pnpm test:e2e -- ws-redis-adapter` — expected: green; cross-instance delivery verified.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.11 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 4.12 — Phase validation + 3-mode smoke

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.1…4.11

#### Description

Consolidated Phase 4 validation: run the full gate, confirm 100% coverage and the critical paths, smoke-test all three transport modes (`'sse'`, `'websocket'`, `'both'`), verify the server bundle stays within budget, re-prove auth inversion, and apply a code review.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size` all pass.
- [ ] 100% line/branch coverage on every Phase-4 file; critical paths green (`websocket.transport.ts`, `realtime.gateway.ts`, `composite.transport.ts`).
- [ ] All three transport modes smoke-tested: `RealtimeService.emitToUser(...)` reaches clients on the active transport(s) (SSE client via `EventSource`/curl, WS client via `socket.io-client`, and both simultaneously in `'both'`).
- [ ] `dist/server/index.mjs` ≤ 18 KB brotli (gateway glue ~3 KB; `socket.io` and `@nestjs/websockets` stay external).
- [ ] Auth inversion end check: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` returns zero.
- [ ] `/bymax-quality:code-review` executed and findings applied.

#### Files to create / modify

- (validation only — no new source files; fixes applied where the gate surfaces them)

#### Agent prompt

````
You are a senior NestJS release/QA engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push for NestJS (SSE default,
WebSocket opt-in), framework-agnostic auth via dependency inversion. pnpm@11.0.0.

CURRENT PHASE: 4 (WebSocket Transport) — Task 4.12 of 12 (LAST).

PRECONDITIONS
- Tasks 4.1–4.11 are done: `WebSocketTransport`, `RealtimeGateway`, `RealtimeIoAdapter`,
  `CompositeTransport`, the three-mode module wiring, and all specs (unit + e2e) are in place.

REQUIRED READING (only these):
- `docs/development_plan.md` § 5.7 ("Phase 4 validation") + § 1.7 ("Global per-phase Done criteria").
- `docs/technical_specification.md` § 14 (error catalog) — for the auth-fail / FIFO mappings.

TASK
Run the consolidated Phase 4 gate, smoke-test the three transport modes, confirm the bundle budget
and auth inversion, and apply a code review.

DELIVERABLES
1. Run and make green:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size
   ```
   - Coverage: 100% line/branch on every Phase-4 file; critical paths green
     (`websocket.transport.ts`, `realtime.gateway.ts`, `composite.transport.ts`).
   - Bundle: `dist/server/index.mjs` ≤ 18 KB brotli.
2. Smoke-test all three modes (a fixture app, not a full product):
   ```typescript
   // sse
   BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator, pubsub })
   // websocket
   BymaxRealtimeModule.forRoot({ transport: 'websocket', authenticator, websocket: { redisAdapter: { pubClient: redis } } })
   // both
   BymaxRealtimeModule.forRoot({ transport: 'both', authenticator, pubsub, websocket: { /* ... */ } })
   ```
   For each, verify `RealtimeService.emitToUser('u_x', 'evt', {})` reaches clients connected on the
   active transport(s) — in `'both'`, an SSE client AND a WS client both receive it.
3. Auth-inversion end check: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/`
   returns zero.
4. Run `/bymax-quality:code-review` and apply the findings (re-run the gate after fixes).

Constraints:
- Do not weaken any gate to make it pass (no `eslint-disable`, no `@ts-ignore`, no coverage carve-outs).
- If a gate fails, fix the cause and re-run. English/timeless comments on any fix.

Verification:
- The full command in deliverable (1) exits 0.
- The three-mode smoke confirms delivery on each transport.
- The auth-inversion grep returns no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 4.12 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 4.1 ✅ 2026-06-30 — `WebSocketTransport` implementing `ITransport` over Socket.IO with FIFO eviction
- 4.2 ✅ 2026-06-30 — `RealtimeGateway` with fail-closed handshake auth and lifecycle hooks
- 4.3 ✅ 2026-06-30 — Three-pattern handshake auth (cookie, ticket, Bearer) unified in gateway
- 4.4 ✅ 2026-06-30 — `RealtimeIoAdapter` with lazy `@socket.io/redis-adapter` install via `createAdapter(pub, pub.duplicate())`
- 4.5 ✅ 2026-06-30 — `CompositeTransport` fan-out with `Promise.allSettled` tolerance; `kind === 'sse'`
- 4.6 ✅ 2026-06-30 — Module wiring for sse/websocket/both; `RealtimePubSubSubscriber` scoped to SSE modes; barrel exports
- 4.7 ✅ 2026-06-30 — Auth handshake differences doc + `auth-extraction.spec.ts` covering all three patterns
- 4.8 ✅ 2026-06-30 — `WebSocketTransport` unit spec + `socket.io-client` e2e with auth/room/eviction coverage
- 4.9 ✅ 2026-06-30 — `RealtimeGateway` lifecycle + auth-fail spec with 100% branch coverage
- 4.10 ✅ 2026-06-30 — `CompositeTransport` fan-out, tolerance, and kind=sse tests
- 4.11 ✅ 2026-06-30 — `RealtimeIoAdapter` unit spec + `ws-redis-adapter.e2e-spec.ts` with `ioredis-mock`
- 4.12 ✅ 2026-06-30 — All gates passing: typecheck, lint, 100% coverage, build, size, e2e; auth-inversion grep = zero
