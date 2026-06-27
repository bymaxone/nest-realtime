# Phase 2 — Auth + Last-Event-ID + Reauthentication

> **Status**: ✅ Done · **Progress**: 12 / 12 tasks · **Last updated**: 2026-06-27
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 3 (Phase 2)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

Phase 1 delivered a working single-instance SSE stack: `SseTransport`, `RealtimeService`, the connection/room registries, the event-id generator, the in-memory replay buffer, the heartbeat component, and `BymaxRealtimeModule.forRoot`. It left the connection-lifecycle logic inline in the dynamic SSE controller and stubbed authentication.

Phase 2 makes the SSE stack **production-ready for single-instance deployment**. It plugs in real authentication through the three canonical, auth-agnostic patterns (HttpOnly cookie, ticket, WebSocket bearer — the bearer pattern is documentation-only here because the WebSocket transport lands later), wires effective `Last-Event-ID` replay so reconnects are seamless, hardens the `: keepalive` heartbeat against real proxies (nginx 60s idle, Cloudflare 100s), adds the configurable periodic re-authentication policy with a short positive cache, wires the full lifecycle-hook set, and adds `forRootAsync` for DI-resolved configuration.

The work is mostly **factoring + contract wiring**, not new transport plumbing. The auth-inversion rule is the dominant invariant: every authentication concrete (JWT, passport, `@bymax-one/nest-auth`) lives in the consumer — the library only depends on the `IConnectionAuthenticator` contract. Reference bridges live in `docs/`, mocks in `test/`, never in `src/`.

When this phase is done, a consumer can authenticate via cookie or ticket, reconnects replay the missed events, and credentials are revalidated on a configurable interval (default 5 min) with disconnect-or-event on failure.

---

## Rules-of-phase

1. **English-only, timeless comments.** All identifiers, JSDoc, comments, and docs are English. No roadmap/phase/task references inside any committed file — describe *what* and *why*, never *which stage produced it*. A reference to a doc **section** (`spec §6.1`, `plan §3.3`) is allowed; a reference to a plan **stage** (`Phase 4`) is not.
2. **No `.gitkeep` / placeholder files and no empty-directory scaffolding.** Directories emerge when the first real file is written (`mkdir -p` immediately before the write, or let the file write create the path). `test/fixtures/authenticators/`, `docs/auth-patterns/`, and `docs/examples/` come into existence with their first real file.
3. **Auth-inversion structural rule (non-negotiable).** There must be **NO** reference to `JwtService` / `JwtPayload` / `@bymax-one/nest-auth` / `passport-*` (or any concrete auth library) in any file of `src/`. The only allowed references are in `docs/` (bridge examples) and `test/` (mocks). CI gate: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` returns **zero** matches.
4. **100% line/branch coverage per implemented file** (Bymax library standard). Mutation focus (Stryker `break 95`, high 99 / low 95) on the phase's critical paths at the pre-release gate.
5. **Heartbeat is a raw SSE comment, not an event.** The keepalive is the literal string `: keepalive\n\n` written **directly to the Express response stream** by `HeartbeatService` on an interval. It is **not** a `MessageEvent`, **not** a named event, stays **out of the event-id space**, and is **not** in the §13 reserved-event catalog (the browser never surfaces it to `addEventListener`). Never emit it through the per-connection `Subject`.
6. **`maxConnectionsPerUser` is enforced via FIFO eviction, never 429.** When a user is at the limit, evict the user's **oldest** connection (close it with reason `REALTIME_TOO_MANY_CONNECTIONS`) and **admit** the new one. The new connection is never rejected with HTTP 429.
7. **`EventReplayBuffer` is per-user and injects the options token.** It is keyed `Map<userId, MessageEvent[]>` and its constructor takes `@Inject(REALTIME_OPTIONS_TOKEN)`. The cap default must be **parenthesized**: `const cap = this.opts.sse?.replayBufferSize ?? 100; if (buf.length > cap) buf.shift()` — `>` binds tighter than `??`, so the unparenthesized form silently leaves the buffer unbounded.
8. **Emit is local delivery + a single publish.** Public `emitTo*` methods deliver locally **and** publish once; the buffer `append` happens on the local-only path (`emitToUserLocal`). The pub/sub subscriber dispatches remote messages to the **non-publishing** `*Local` methods only. `disconnect()` closes locally when the connection is owned by this instance, otherwise publishes `op:'disconnect'` so the owning instance closes it (the producer §8.4 cross-instance revocation depends on).
9. **Reserved event names are owned by the lib.** `connection:established` and `connection:reauthentication-failed` (payload `{ reason: string }`) must not be reused for custom events.
10. **SSE response hardening.** The SSE route sends `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`; never put HTTP body compression in front of `text/event-stream`.
11. **TS strict, no `any`, no `eslint-disable` / `@ts-ignore`.** Functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header per file; JSDoc on every export. Conventional Commits, `pnpm@11.0.0`.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 4.1–4.2 Configuration API & defaults, § 4.4 `forRootAsync` example, § 4.6 Injection tokens, § 4.7 `BymaxRealtimeModuleAsyncOptions`, § 5.2 `IConnectionAuthenticator`, § 5.3 `IConnectionLifecycleHooks`, § 6.1 `SseTransport` (controller skeleton, wire format, heartbeat note, local-only path), § 7.4 `EventReplayBuffer`, § 8 Authentication Strategy, § 10.1 `Last-Event-ID`, § 13 Standard Event Catalog, § 14 Error Code Catalog, § 1.6 Design principles (auth inversion).
- [`docs/development_plan.md`](../development_plan.md) — § 3.1–3.8 (Phase 2 sub-steps), § 1.7 Global per-phase Done criteria, § 1.11 Attention points (auth inversion is structural).
- `/bymax-workflow:standards` skill — universal coding rules (TypeScript track: type/lint discipline, JSDoc policy, layered architecture, typed errors, English-only comments, Conventional Commits).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 2.1 | Refactor — extract `SseSubscriptionHandler` | ✅ Done | P0 | M | 1.13 |
| 2.2 | `IConnectionAuthenticator` — three patterns (docs + fixtures) | ✅ Done | P1 | M | 1.9 |
| 2.3 | `@bymax-one/nest-auth` bridge — reference example (docs only) | ✅ Done | P2 | S | 2.2 |
| 2.4 | `ReauthenticationService` — periodic re-check + positive cache | ✅ Done | P1 | M | 2.1 |
| 2.5 | `encodeSseEvent` utility (correct wire format) | ✅ Done | P1 | S | 1.8 |
| 2.6 | `Last-Event-ID` replay wiring + lifecycle hooks | ✅ Done | P1 | M | 1.12, 2.1 |
| 2.7 | Effective heartbeat against real proxies | ✅ Done | P2 | S | 1.12 |
| 2.8 | `forRootAsync` support | ✅ Done | P1 | M | 1.13 |
| 2.9 | Tests — three auth patterns | ✅ Done | P1 | M | 2.2 |
| 2.10 | Tests — `ReauthenticationService` + lifecycle hooks | ✅ Done | P1 | M | 2.4, 2.6 |
| 2.11 | Tests — `encodeSseEvent` + `Last-Event-ID` replay | ✅ Done | P1 | M | 2.5, 2.6 |
| 2.12 | Phase 2 consolidated validation | ✅ Done | P1 | S | 2.1…2.11 |

---

## Tasks

### Task 2.1 — Refactor: extract `SseSubscriptionHandler`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.13

#### Description

Phase 1 left the connection-lifecycle logic inline in the dynamic SSE controller created by `createSseController`. Extract it into a reusable injectable `SseSubscriptionHandler` so the auth → register → auto-join → replay → heartbeat → cleanup flow can be unit-tested without booting the module and later reused by the composite transport. The dynamic controller becomes a thin shell that delegates to the handler. Enforce `maxConnectionsPerUser` via FIFO eviction.

#### Acceptance criteria

- [ ] `src/server/transports/sse/sse-subscription.handler.ts` created as an `@Injectable()` that owns the whole subscribe flow.
- [ ] `sse.controller.ts` is removed — the controller lives only in `sse-controller.factory.ts`, which delegates to the handler in ≤ 10 effective LoC.
- [ ] `handle(req, res)` authenticates (`UnauthorizedException(REALTIME_AUTH_FAILED)` on `null`), applies `tenantResolver` when provided, registers the connection, auto-joins `user:{userId}` and `tenant:{tenantId}` (when resolved), starts the heartbeat (raw `: keepalive` comment to `res`), emits `connection:established` (unless `sse.emitConnectionEvent === false`), and returns the merged stream with a `finalize`/`takeUntil` teardown.
- [ ] `enforceConnectionLimit` evicts the **oldest** connection via `transport.disconnect(oldest, 'REALTIME_TOO_MANY_CONNECTIONS')` and admits the new one — never rejects with 429.
- [ ] Eviction is logged with a clear, diagnosable message.
- [ ] Hooks are optional via `@Optional() @Inject(REALTIME_HOOKS_TOKEN)`.
- [ ] Existing Phase 1 SSE tests still pass after the refactor.
- [ ] 100% line/branch coverage on `sse-subscription.handler.ts`; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/transports/sse/sse-subscription.handler.ts` (new)
- `src/server/transports/sse/sse-controller.factory.ts` (modify — delegate to handler)
- `src/server/transports/sse/sse.controller.ts` (remove)
- `src/server/realtime.module.ts` (register `SseSubscriptionHandler` in providers)

#### Agent prompt

````
You are a senior NestJS realtime engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — a dual-transport (SSE-default, WebSocket opt-in) realtime
push library for NestJS 11, published to npm. SSE-first, auth-agnostic: the consumer plugs an
`IConnectionAuthenticator`; the library NEVER imports a concrete auth library. pnpm@11.0.0,
TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.1 of 12 (FIRST, structural).

PRECONDITIONS
- Phase 1 is done: `SseTransport`, `HeartbeatService`, `ConnectionRegistry`, `RoomRegistry`,
  `EventIdGenerator`, `EventReplayBuffer`, `RealtimeService`, the dynamic SSE controller factory,
  and `BymaxRealtimeModule.forRoot` all exist and build green.

REQUIRED READING (only these — do not load the whole spec/plan):
- `docs/technical_specification.md` § 6.1 "SseTransport" — the controller skeleton (`@Sse()` with
  `@Req()` + `@Res({ passthrough: true })`), the transport `disconnect`/`disconnectLocal` methods,
  the "heartbeat is a true SSE comment, not a MessageEvent" note, and the teardown-correctness note.
- `docs/technical_specification.md` § 4.2 "Options table" — `sse.maxConnectionsPerUser` (default 5,
  FIFO eviction) and `sse.emitConnectionEvent` (default true).
- `docs/technical_specification.md` § 14 "Error Code Catalog" — `REALTIME_AUTH_FAILED` and
  `REALTIME_TOO_MANY_CONNECTIONS` (oldest evicted, new admitted, never 429).
- `docs/development_plan.md` § 3.1 — the `SseSubscriptionHandler` + factory skeleton.

TASK
Extract the inline subscribe logic into `SseSubscriptionHandler` and reduce the dynamic controller
to a thin delegating shell. Remove `sse.controller.ts`.

DELIVERABLES

1. `src/server/transports/sse/sse-subscription.handler.ts`:

   ```typescript
   @Injectable()
   export class SseSubscriptionHandler {
     constructor(
       private readonly transport: SseTransport,
       private readonly heartbeat: HeartbeatService,
       @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
       @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
     ) {}

     async handle(req: Request, res: Response): Promise<Observable<MessageEvent>> {
       // 1. Build the transport-agnostic ConnectionAuthContext (cookies parsed, headers
       //    lower-cased, query, ip via x-forwarded-for fallback, userAgent, transport: 'sse').
       // 2. auth = await this.transport.authenticate(ctx); if (!auth) throw
       //    new UnauthorizedException(REALTIME_ERROR_CODES.AUTH_FAILED).
       // 3. Resolve tenantId via options.tenantResolver?.(auth) ?? auth.tenantId.
       // 4. Enforce maxConnectionsPerUser via FIFO eviction (default 5) — see enforceConnectionLimit.
       // 5. connectionId = randomUUID(); subject = new Subject<MessageEvent>(); close$ = new Subject<void>().
       // 6. await this.transport.registerConnection({ connectionId, userId, tenantId, subject, close$, ip, userAgent }).
       //    Registration auto-joins user:{userId} and tenant:{tenantId} (when resolved).
       // 7. Fire-and-forget hooks.onConnect(meta) — best-effort, must not block.
       // 8. Start heartbeat: this.heartbeat.start(connectionId, res, this.options.sse?.heartbeatMs ?? 30_000)
       //    — writes raw ': keepalive\n\n' comments to res; NOT a MessageEvent.
       // 9. Build established$ (connection:established with { connectionId, traits: auth }) unless
       //    options.sse?.emitConnectionEvent === false.
       // 10. Build replay$ from Last-Event-ID (here use the transport's
       //     buildReplayStream when the header is present, else an empty completed Observable).
       // 11. return merge(established$, replay$, subject.asObservable()).pipe(
       //       takeUntil(close$),
       //       finalize(() => { this.heartbeat.stop(connectionId); void this.cleanup(connectionId, connectedAt) }),
       //     )
     }

     private async enforceConnectionLimit(userId: string, max: number): Promise<void> {
       const existing = this.transport.connectionsForUser(userId)   // expose a public accessor;
       while (existing.length >= max) {                              // do NOT reach into a private field
         const oldest = existing.shift()
         if (!oldest) break
         this.logger.warn(`Evicting oldest SSE connection ${oldest.connectionId} for user ${userId} (maxConnectionsPerUser=${max})`)
         await this.transport.disconnect(oldest.connectionId, 'REALTIME_TOO_MANY_CONNECTIONS')
       }
     }

     private async cleanup(connectionId: string, connectedAt: Date): Promise<void> {
       // Clear heartbeat, leaveAll rooms + unregister via the transport, then fire
       // hooks.onDisconnect({ ...meta, reason, durationMs: Date.now() - connectedAt.getTime() }).
     }
   }
   ```

   IMPORTANT: do NOT access a private field of the transport for the FIFO check — add a small
   public accessor on `SseTransport` (e.g. `connectionsForUser(userId): ConnectionRecord[]`) that
   delegates to `ConnectionRegistry.byUser(userId, 'sse')`.

2. `src/server/transports/sse/sse-controller.factory.ts` — thin delegating controller:

   ```typescript
   export function createSseController(endpoint: string): Type<unknown> {
     const ssePath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

     @Controller()
     class DynamicSseController {
       constructor(private readonly handler: SseSubscriptionHandler) {}

       @Sse(ssePath)
       subscribe(
         @Req() req: Request,
         @Res({ passthrough: true }) res: Response,
       ): Promise<Observable<MessageEvent>> {
         return this.handler.handle(req, res)
       }
     }
     return DynamicSseController
   }
   ```

3. Remove `src/server/transports/sse/sse.controller.ts`. Register `SseSubscriptionHandler` in the
   `BymaxRealtimeModule.forRoot` providers list.

Constraints:
- Heartbeat is a raw `: keepalive\n\n` comment written to `res` by `HeartbeatService` — never a
  `MessageEvent`, never through the Subject.
- FIFO eviction only — never throw HTTP 429 for `maxConnectionsPerUser`.
- Hooks are best-effort: wrap each hook call so a throwing hook cannot break the connection lifecycle.
- No reference to `JwtService`/`@bymax-one/nest-auth`/`passport-*` anywhere in `src/`.
- English-only, timeless comments. Functions ≤ 50 lines. `@fileoverview` + `@layer` header.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/transports/sse/` — expected: Phase 1 SSE tests still green.
- `test -f src/server/transports/sse/sse.controller.ts` — expected: file is gone.
- `pnpm test:cov -- src/server/transports/sse/sse-subscription.handler.ts` — expected: 100% lines/branches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.2 — `IConnectionAuthenticator`: three patterns (docs + fixtures)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.9

#### Description

Document the three supported, auth-agnostic patterns — HttpOnly Cookie (Pattern A), Ticket / one-time id (Pattern B), and Bearer header (Pattern C, WebSocket only) — and provide test fixtures that exercise the `IConnectionAuthenticator` contract for each. Concrete implementations live **only** in `docs/` (reference) and `test/fixtures/` (mocks), never in `src/`. This task is mostly documentation + reusable fixtures consumed by Task 2.9 and later e2e.

#### Acceptance criteria

- [ ] `docs/auth-patterns/cookie-httponly.md`, `docs/auth-patterns/ticket.md`, and `docs/auth-patterns/bearer-header.md` created (English).
- [ ] Each doc states when to use the pattern, how to implement it against `ConnectionAuthContext`, and the security notes (cookie `HttpOnly`/`Secure`/`SameSite`; ticket short TTL + atomic consume + rate limit; bearer is WS-only because `EventSource` strips custom headers).
- [ ] `test/fixtures/authenticators/cookie-jwt.authenticator.ts`, `ticket.authenticator.ts`, `bearer.authenticator.ts` created — each implements `IConnectionAuthenticator`, works standalone, and carries JSDoc pointing to the matching doc.
- [ ] The cookie fixture validates a JWT with the standalone `jsonwebtoken` package; the ticket fixture uses an in-memory `Map` with a TTL as a Redis stand-in and consumes the ticket atomically; the bearer fixture parses `Bearer <token>`.
- [ ] No import of `@bymax-one/nest-auth`, `@nestjs/jwt`, or `passport-*` in any file of `src/`.

#### Files to create / modify

- `docs/auth-patterns/cookie-httponly.md`, `docs/auth-patterns/ticket.md`, `docs/auth-patterns/bearer-header.md` (new)
- `test/fixtures/authenticators/cookie-jwt.authenticator.ts`, `ticket.authenticator.ts`, `bearer.authenticator.ts` (new)

#### Agent prompt

````
You are a senior NestJS security engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport (SSE-default, WebSocket opt-in) realtime push
library for NestJS 11. Auth-agnostic: the consumer plugs an `IConnectionAuthenticator`; the library
NEVER imports a concrete auth library. pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.2 of 12.

PRECONDITIONS
- The `IConnectionAuthenticator`, `AuthenticationResult`, and `ConnectionAuthContext` contracts
  exist in `src/server/interfaces/connection-authenticator.interface.ts` (Phase 1).

REQUIRED READING (only these):
- `docs/technical_specification.md` § 5.2 "IConnectionAuthenticator" — the `AuthenticationResult`,
  `ConnectionAuthContext` shapes and the cookie + ticket example implementations.
- `docs/technical_specification.md` § 8.1 "Three supported patterns" and § 8.2 "Pattern comparison".
- `docs/development_plan.md` § 3.2 — the three pattern examples and the fixture intent.

TASK
Author the three pattern docs and the three reusable test fixtures. Concrete auth code lives ONLY
in `docs/` and `test/fixtures/` — never in `src/`.

DELIVERABLES

1. `docs/auth-patterns/cookie-httponly.md` (Pattern A):
   - When to use: SSE in browsers (the `Authorization` header is stripped by `EventSource`).
   - How: read `ctx.cookies['access_token']`, validate the JWT/session, return
     `{ userId, tenantId, roles }`. Include a TypeScript reference bridge that uses
     `@bymax-one/nest-auth`'s `JwtService` — **clearly marked as consumer code, not lib `src/`**.
   - Security: cookie must be `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`.

2. `docs/auth-patterns/ticket.md` (Pattern B):
   - When to use: clients without cookies (native mobile, devtools), strict cross-origin.
   - How: a consumer endpoint `POST /events/ticket` issues a one-time UUID (TTL 60s) stored in
     Redis; the SSE request carries `?ticket=<uuid>`; the authenticator consumes it atomically
     (`GETDEL`) so it is single-use, then returns the auth result.
   - Security: short TTL, atomic consume, rate-limit the issuing endpoint.

3. `docs/auth-patterns/bearer-header.md` (Pattern C):
   - When to use: WebSocket only (Socket.IO allows auth in the handshake).
   - How: extract from `socket.handshake.auth.token` / `ctx.headers.authorization`, parse
     `Bearer <token>`, validate, return the auth result.
   - DO NOT use for SSE — `EventSource` cannot send custom headers.

4. `test/fixtures/authenticators/` — three fixtures implementing `IConnectionAuthenticator`:
   - `cookie-jwt.authenticator.ts` — validates a JWT from `ctx.cookies` with the standalone
     `jsonwebtoken` package; supports a configurable cookie name; returns a mock auth result.
   - `ticket.authenticator.ts` — an in-memory `Map<string, AuthenticationResult>` with a TTL
     (via `setTimeout`) as a Redis stand-in; `authenticate` consumes the ticket atomically.
   - `bearer.authenticator.ts` — splits the `Bearer ` prefix from `ctx.headers.authorization`.
   Each fixture exports the class plus JSDoc cross-linking to its doc.

Constraints:
- Fixtures must be standalone (no NestJS module needed to instantiate).
- Reference the lib's public types by package name (`from '@bymax-one/nest-realtime'`) in the docs;
  in fixtures, import the contract from the relative interface path.
- No `@bymax-one/nest-auth`/`@nestjs/jwt`/`passport-*` import anywhere in `src/`.
- English-only, timeless docs and comments.

Verification:
- `grep -rnE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` — expected: zero.
- `ls docs/auth-patterns/ test/fixtures/authenticators/` — expected: 3 docs + 3 fixtures.
- `pnpm typecheck` — expected: clean (fixtures compile against the lib types).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.3 — `@bymax-one/nest-auth` bridge: reference example (docs only)

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: S
- **Depends on**: 2.2

#### Description

Provide a standalone reference example showing how a consuming NestJS app bridges `@bymax-one/nest-auth`'s `JwtService` to the `IConnectionAuthenticator` contract. It lives in `docs/examples/`, generates zero bytes in the shipped bundle, and reaffirms the auth-inversion rule. The sibling auth library is referenced by its package name `@bymax-one/nest-auth` (repo `../nest-auth`).

#### Acceptance criteria

- [ ] `docs/examples/nest-auth-bridge.md` created (English) with an introduction explaining that `nest-realtime` is auth-agnostic and `IConnectionAuthenticator` is the extension point.
- [ ] A complete `NestAuthRealtimeBridge` example: `authenticate` reads the cookie or bearer token, verifies via `JwtService`, returns `{ userId, tenantId, roles }`; `revalidate` optionally re-checks a revocation list.
- [ ] Shows wiring through `BymaxRealtimeModule.forRootAsync({ useFactory, inject: [JwtService] })`.
- [ ] Security notes: JWT rotation, refresh-token handling, revocation via Redis blacklist, and the lib's short positive cache via `reauthenticationPolicy.cacheTtlMs`.
- [ ] Cross-link added in `docs/auth-patterns/cookie-httponly.md`.
- [ ] There is **no** reference to `@bymax-one/nest-auth` in `src/`.

#### Files to create / modify

- `docs/examples/nest-auth-bridge.md` (new)
- `docs/auth-patterns/cookie-httponly.md` (add cross-link)

#### Agent prompt

````
You are a senior NestJS security engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
Auth-agnostic; the library NEVER imports a concrete auth library. The sibling auth library is
`@bymax-one/nest-auth` (repo `../nest-auth`). pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.3 of 12.

PRECONDITIONS
- Task 2.2 is done: the three pattern docs and fixtures exist; `docs/auth-patterns/cookie-httponly.md`
  is present and ready for a cross-link.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 5.2 "IConnectionAuthenticator" — the bridge example for
  `@bymax-one/nest-auth`.
- `docs/technical_specification.md` § 1.6 "Design principles" — the auth-inversion principle.
- `docs/technical_specification.md` § 4.4 "forRootAsync example" — how an injected `JwtService`
  reaches the authenticator.
- `docs/development_plan.md` § 3.2 — the bridge intent.

TASK
Author `docs/examples/nest-auth-bridge.md` as consumer-side reference code that bridges
`@bymax-one/nest-auth` → `@bymax-one/nest-realtime`. It is documentation only — it produces 0 bytes
in the shipped bundle and is excluded from npm via `.npmignore`.

DELIVERABLES

1. `docs/examples/nest-auth-bridge.md`:
   - Intro: `nest-realtime` is auth-agnostic; `IConnectionAuthenticator` is the only extension point.
   - A complete `NestAuthRealtimeBridge`:

     ```typescript
     import { Injectable } from '@nestjs/common'
     import { JwtService } from '@nestjs/jwt'   // peer of the consuming app
     import type {
       IConnectionAuthenticator,
       ConnectionAuthContext,
       AuthenticationResult,
     } from '@bymax-one/nest-realtime'

     @Injectable()
     export class NestAuthRealtimeBridge implements IConnectionAuthenticator {
       constructor(private readonly jwt: JwtService) {}

       async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
         const token = ctx.cookies['access_token'] ?? this.extractBearer(ctx.headers.authorization)
         if (!token) return null
         try {
           const payload = await this.jwt.verifyAsync<{ sub: string; tid?: string; roles?: string[] }>(token)
           return { userId: payload.sub, tenantId: payload.tid, roles: payload.roles }
         } catch {
           return null
         }
       }

       async revalidate(_connectionId: string, originalAuth: AuthenticationResult): Promise<boolean> {
         // Optional instant revocation: return !(await redis.exists(`auth:revoked:${originalAuth.userId}`))
         return true
       }

       private extractBearer(header?: string): string | undefined {
         if (!header?.startsWith('Bearer ')) return undefined
         return header.slice(7)
       }
     }
     ```

   - Wiring via `BymaxRealtimeModule.forRootAsync({ inject: [NestAuthRealtimeBridge], useFactory:
     (auth) => ({ transport: 'sse', authenticator: auth, ... }) })`.
   - Security notes: JWT rotation, refresh-token handling, Redis-blacklist revocation, and the
     short positive cache via `reauthenticationPolicy.cacheTtlMs`.

2. Add a cross-link to this example in `docs/auth-patterns/cookie-httponly.md`.

Constraints:
- The example compiles verbatim if pasted into a consumer project (no typos, correct imports).
- This file is `docs/` only — it must not appear under `src/` and there must be no
  `@bymax-one/nest-auth` reference in `src/`.
- English-only, timeless documentation.

Verification:
- `grep -rnE "from '@bymax-one/nest-auth'" src/` — expected: zero.
- `test -f docs/examples/nest-auth-bridge.md` — expected: present.
- `grep -q 'nest-auth-bridge' docs/auth-patterns/cookie-httponly.md` — expected: cross-link present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.4 — `ReauthenticationService`: periodic re-check + positive cache

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.1

#### Description

Add a service that periodically revalidates active connections through the `IConnectionAuthenticator.revalidate(...)` contract. It uses a short positive cache (default 60s) to avoid hammering the auth backend, and on failure either disconnects or emits `connection:reauthentication-failed` then disconnects, per `reauthenticationPolicy.onFailure`. It never imports a concrete auth library — it only calls the contract.

#### Acceptance criteria

- [ ] `src/server/services/reauthentication.service.ts` created, implementing `OnModuleInit` + `OnApplicationShutdown`.
- [ ] `onModuleInit` schedules a timer every `intervalSeconds` (default 300s per spec §4.2) and `.unref()`s it; it is a **no-op** (with an informative log) when the authenticator does not implement `revalidate`.
- [ ] `onApplicationShutdown` clears the timer and the cache (no leak).
- [ ] Each cycle iterates active connections; a positive-cache hit (within `cacheTtlMs`, default 60s) skips revalidation; a positive result refreshes the cache.
- [ ] `onFailure: 'disconnect'` calls `transport.disconnect(connectionId, 'REAUTHENTICATION_FAILED')`; `onFailure: 'event'` first emits `connection:reauthentication-failed` with payload `{ reason: 'REAUTHENTICATION_FAILED' }`, then disconnects.
- [ ] `onReauthenticationFailed` hook is fired (best-effort) on failure; the positive-cache entry is invalidated.
- [ ] A throwing `revalidate` is logged and treated as a non-fatal cycle error (resilience — never propagates).
- [ ] Registered in `BymaxRealtimeModule` providers; 100% line/branch coverage; `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/reauthentication.service.ts` (new)
- `src/server/realtime.module.ts` (register the service)

#### Agent prompt

````
You are a senior NestJS realtime engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
Auth-agnostic; the library NEVER imports a concrete auth library — it only calls the
`IConnectionAuthenticator` contract. pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.4 of 12.

PRECONDITIONS
- Task 2.1 is done: `SseSubscriptionHandler` and the registries exist. `RealtimeService`,
  `ConnectionRegistry`, and `SseTransport` (with `disconnect`) are available.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 8.3 "Periodic re-authentication" and § 8.4 "Instant revocation".
- `docs/technical_specification.md` § 4.2 "Options table" — `reauthenticationPolicy.intervalSeconds`
  (default 300), `onFailure` (default 'disconnect'), `cacheTtlMs` (default 60000).
- `docs/technical_specification.md` § 13 — `connection:reauthentication-failed` payload `{ reason: string }`.
- `docs/technical_specification.md` § 5.3 — `IConnectionLifecycleHooks.onReauthenticationFailed`.
- `docs/technical_specification.md` § 6.1 — `disconnect` (owned → local close; otherwise publishes op:'disconnect').
- `docs/development_plan.md` § 3.3 — the `ReauthenticationService` skeleton.

TASK
Author `ReauthenticationService` — a periodic re-check over all active connections with a short
positive cache.

DELIVERABLES

1. `src/server/services/reauthentication.service.ts`:

   ```typescript
   @Injectable()
   export class ReauthenticationService implements OnModuleInit, OnApplicationShutdown {
     private readonly logger = new Logger(ReauthenticationService.name)
     private timer: NodeJS.Timeout | null = null
     private readonly positiveCache = new Map<string, number>()  // connectionId → lastValidAt (epoch ms)
     private readonly policy: Required<ReauthenticationPolicy>

     constructor(
       private readonly connections: ConnectionRegistry,
       private readonly realtime: RealtimeService,
       @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
       @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
       @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
     ) {
       this.policy = {
         intervalSeconds: options.reauthenticationPolicy?.intervalSeconds ?? 300,
         onFailure: options.reauthenticationPolicy?.onFailure ?? 'disconnect',
         cacheTtlMs: options.reauthenticationPolicy?.cacheTtlMs ?? 60_000,
       }
     }

     onModuleInit(): void {
       if (!this.auth.revalidate) {
         this.logger.log('Authenticator does not implement revalidate() — reauthentication disabled')
         return
       }
       this.timer = setInterval(() => void this.runCycle(), this.policy.intervalSeconds * 1000)
       this.timer.unref?.()
       this.logger.log(`Reauthentication scheduled every ${this.policy.intervalSeconds}s`)
     }

     onApplicationShutdown(): void {
       if (this.timer) { clearInterval(this.timer); this.timer = null }
       this.positiveCache.clear()
     }

     /** Public for test access. */
     async runCycle(): Promise<void> {
       const now = Date.now()
       for (const conn of this.connections.allByTransport('sse')) {
         try {
           const lastValid = this.positiveCache.get(conn.connectionId)
           if (lastValid && now - lastValid < this.policy.cacheTtlMs) continue
           const ok = (await this.auth.revalidate?.(conn.connectionId, conn.originalAuth)) ?? true
           if (ok) { this.positiveCache.set(conn.connectionId, now); continue }
           await this.handleFailure(conn)
         } catch (err) {
           this.logger.warn(`Reauthentication errored for ${conn.connectionId}: ${(err as Error).message}`)
         }
       }
     }

     private async handleFailure(conn: ConnectionRecord): Promise<void> {
       this.positiveCache.delete(conn.connectionId)
       if (this.policy.onFailure === 'event') {
         await this.realtime.emitToUser(conn.userId, RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED, {
           reason: 'REAUTHENTICATION_FAILED',
         })
       }
       await this.hooks?.onReauthenticationFailed?.({ /* full ConnectionEventMeta from conn */ })  // best-effort
       await this.realtime.disconnect(conn.connectionId, 'REAUTHENTICATION_FAILED')
     }
   }
   ```

   - Register `ReauthenticationService` in the `forRoot` providers list.
   - When the WebSocket transport lands later, `runCycle` will also iterate
     `allByTransport('websocket')`; keep the iteration source easy to extend.

Constraints:
- The `'event'` failure path emits the reserved `connection:reauthentication-failed` with payload
  `{ reason: 'REAUTHENTICATION_FAILED' }`, then disconnects.
- The service NEVER imports a concrete auth library — only the `IConnectionAuthenticator` contract.
- Negative results are not cached; only positive results enter the cache.
- A throwing `revalidate` must not abort the cycle for other connections.
- English-only, timeless comments. Functions ≤ 50 lines.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/services/reauthentication.service.spec.ts` — expected: green (spec lands in Task 2.10).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.5 — `encodeSseEvent` utility (correct wire format)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.8

#### Description

A pure utility that encodes a NestJS `MessageEvent` into the exact SSE wire format: `id: <id>\nevent: <type>\ndata: <json>\n\n`, with multi-line `data` split into multiple `data:` lines, the `id:` line omitted when empty, the `event:` line omitted for the default `message` type, and the heartbeat encoded as a `: keepalive\n\n` comment. NestJS's `@Sse()` does most of this for live streams; this helper exists for the direct-emission path (the cross-instance pub/sub subscriber) and for testing. This is a critical path — mutation focus ≥ 95%.

#### Acceptance criteria

- [ ] `src/server/utils/encode-sse-event.ts` created, exporting `encodeSseEvent(event: MessageEvent): string`.
- [ ] A heartbeat (`event.type === 'heartbeat'` (a local sentinel, NOT a RESERVED_EVENT_NAMES member)) encodes to exactly `: keepalive\n\n` (comment line — invisible to `EventSource`, no `id:`/`event:`/`data:`).
- [ ] A regular event encodes `id: x\nevent: type\ndata: {...}\n\n`.
- [ ] Multi-line `data` is split across multiple `data:` lines (W3C SSE).
- [ ] The `id:` line is omitted when `event.id` is empty (e.g. the canonical `connection:established`).
- [ ] The `event:` line is omitted when `type` is `message` (the W3C default) or absent.
- [ ] String `data` is passed through as-is (not JSON-encoded); `null`/`undefined` serialize to an empty string.
- [ ] The terminator is always a blank line (`\n\n`).
- [ ] 100% line/branch coverage; JSDoc with four `@example` blocks (single-line, multi-line, no id / default type, heartbeat).

#### Files to create / modify

- `src/server/utils/encode-sse-event.ts` (new)

#### Agent prompt

````
You are a senior NestJS realtime engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.5 of 12.

PRECONDITIONS
- `RESERVED_EVENT_NAMES` exists in `src/shared/constants/reserved-events.constants.ts` (re-exported
  from the server index). `MessageEvent` is the `@nestjs/common` type.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 6.1 "Event format on the wire (SSE)" — the exact `id:/event:/data:`
  layout and the `: keepalive` comment.
- `docs/technical_specification.md` § 13 — the heartbeat is a comment, NOT a named event (so it never
  carries `event: heartbeat`).
- `docs/development_plan.md` § 3.4 — the `encodeSseEvent` skeleton.
- W3C SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html

TASK
Author the pure `encodeSseEvent` utility.

DELIVERABLES

1. `src/server/utils/encode-sse-event.ts`:

   ```typescript
   import type { MessageEvent } from '@nestjs/common'
   import { RESERVED_EVENT_NAMES } from '../../shared/constants/reserved-events.constants'

   /**
    * Encode a NestJS MessageEvent into the SSE wire format.
    *
    * The heartbeat is a comment line `: keepalive\n\n` (no id/event/data — invisible to
    * EventSource and out of the event-id space). Regular events emit `id:`/`event:`/`data:`
    * followed by a blank line. Multi-line `data` becomes multiple `data:` lines.
    *
    * NestJS's @Sse() handles live streams; this helper drives the direct-emission path
    * (the cross-instance pub/sub subscriber) and the unit tests.
    */
   export function encodeSseEvent(event: MessageEvent): string {
     // 'heartbeat' is a local sentinel — deliberately NOT a RESERVED_EVENT_NAMES member; the heartbeat is an SSE comment, never a named event (spec section 13).
     if (event.type === 'heartbeat') return ': keepalive\n\n'

     const lines: string[] = []
     if (event.id) lines.push(`id: ${event.id}`)
     if (event.type && event.type !== 'message') lines.push(`event: ${event.type}`)

     for (const line of serializeData(event.data).split('\n')) lines.push(`data: ${line}`)
     return lines.join('\n') + '\n\n'
   }

   function serializeData(data: unknown): string {
     if (typeof data === 'string') return data
     if (data === null || data === undefined) return ''
     return JSON.stringify(data)
   }
   ```

Constraints:
- Pure function — no side effects, no I/O.
- Do NOT reimplement everything NestJS does; this exists for the direct-emission path and tests.
- English-only, timeless comments. `@fileoverview` + `@layer` header; JSDoc with four `@example`s.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test:cov -- src/server/utils/encode-sse-event.ts` — expected: 100% lines/branches (spec lands in Task 2.11).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.6 — `Last-Event-ID` replay wiring + lifecycle hooks

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.12, 2.1

#### Description

When `EventSource` reconnects, the browser automatically resends the `Last-Event-ID` header with the last `id:` it received. The `SseSubscriptionHandler` must read this header, query the per-user `EventReplayBuffer`, and re-emit the missed events (in order) **before** any new event. This task also confirms the buffer is per-user with the options token injected (parenthesized cap), and wires the full lifecycle-hook set (`onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed`).

#### Acceptance criteria

- [ ] `EventReplayBuffer` is keyed `Map<userId, MessageEvent[]>` and its constructor takes `@Inject(REALTIME_OPTIONS_TOKEN)`.
- [ ] The cap default is **parenthesized**: `const cap = this.opts.sse?.replayBufferSize ?? 100; if (buf.length > cap) buf.shift()`.
- [ ] The buffer `append` happens on the transport's **local-only** path (`emitToUserLocal`), before delivery to subscribers; public `emitToUser` does local delivery + a single publish.
- [ ] The handler reads `req.headers['last-event-id']` (lower-case) and, when present, replays the missed events (id > sinceId, ordered) before live events; an empty/absent header yields no replay (only `connection:established`).
- [ ] All four hooks are wired: `onConnect` fires after register (before any event); `onDisconnect` fires in cleanup with `durationMs = now - connectedAt`; `onError` fires when the upstream `Subject` errors; `onReauthenticationFailed` is fired by the reauthentication service.
- [ ] Hook failures are best-effort and never block the connection lifecycle (each call is try/caught).
- [ ] Existing Phase 1 SSE tests still pass; `pnpm typecheck` passes; 100% coverage on the touched files.

#### Files to create / modify

- `src/server/transports/sse/sse-subscription.handler.ts` (modify — replay + hooks)
- `src/server/transports/sse/event-replay-buffer.ts` (confirm per-user + injected options token, parenthesized cap)
- `src/server/transports/sse/sse.transport.ts` (confirm `emitToUserLocal` appends to the buffer)

#### Agent prompt

````
You are a senior NestJS realtime engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.6 of 12.

PRECONDITIONS
- Task 2.1 is done: `SseSubscriptionHandler` exists and the controller delegates to it.
- `EventReplayBuffer` and `SseTransport` exist from Phase 1.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 10.1 "Last-Event-ID (SSE — native protocol)" — the reconnect
  replay sequence.
- `docs/technical_specification.md` § 7.4 "EventReplayBuffer" — per-user Map, the injected
  REALTIME_OPTIONS_TOKEN, and the parenthesized cap default (a relational `>` binds tighter than `??`).
- `docs/technical_specification.md` § 6.1 "SseTransport" — `emitToUserLocal` appends to the buffer
  then delivers; public `emitTo*` = local delivery + a SINGLE publish; `buildReplayStream`.
- `docs/technical_specification.md` § 5.3 "IConnectionLifecycleHooks" — the four hook shapes.
- `docs/development_plan.md` § 3.5 (lifecycle hooks) and § 3.1 (Last-Event-ID inside handle()).

TASK
Wire `Last-Event-ID` replay into the handler, confirm the per-user buffer with the injected options
token, and wire the four lifecycle hooks.

DELIVERABLES

1. Confirm `event-replay-buffer.ts` is per-user with the options token injected:

   ```typescript
   @Injectable()
   export class EventReplayBuffer {
     private readonly buffers = new Map<string, MessageEvent[]>()   // userId → ring buffer

     constructor(@Inject(REALTIME_OPTIONS_TOKEN) private readonly opts: BymaxRealtimeModuleOptions) {}

     append(userId: string, event: MessageEvent): void {
       const buf = this.buffers.get(userId) ?? []
       buf.push(event)
       const cap = this.opts.sse?.replayBufferSize ?? 100   // PARENTHESIZED — never `> x ?? 100`
       if (buf.length > cap) buf.shift()
       this.buffers.set(userId, buf)
     }

     since(userId: string, lastEventId: string): MessageEvent[] {
       const buf = this.buffers.get(userId) ?? []
       const idx = buf.findIndex((e) => e.id === lastEventId)
       return idx === -1 ? [] : buf.slice(idx + 1)
     }
   }
   ```

2. Confirm `SseTransport.emitToUserLocal(userId, event, data, id)` appends to the buffer BEFORE
   delivering, and that public `emitToUser` does local delivery + a single publish (the subscriber
   path calls only the non-publishing `*Local` methods). Do NOT append in the publishing path.

3. In `sse-subscription.handler.ts`, read `req.headers['last-event-id']` (lower-case) and build the
   replay stream via `this.transport.buildReplayStream(userId, lastEventId)` when present; replay the
   missed events (id > sinceId, in buffer order) BEFORE the live `subject` stream and after
   `connection:established`. Absent header → an empty completed Observable.

4. Wire the four hooks (each best-effort, try/caught so a throwing hook never breaks the stream):
   - `onConnect(meta)` after register, before any event is emitted.
   - `onDisconnect({ ...meta, reason, durationMs })` in cleanup (`durationMs = Date.now() - connectedAt.getTime()`).
   - `onError({ connectionId, error, transport: 'sse' })` via a `catchError` before `finalize`.
   - `onReauthenticationFailed` is fired by `ReauthenticationService` (Task 2.4) — only confirm here.

Constraints:
- Replay events are delivered in order, strictly before live events; the canonical
  `connection:established` is emitted first.
- Best-effort hooks: `void Promise.resolve(this.hooks?.onX?.(meta)).catch(() => /* internal warn */)`.
- No concrete-auth import in `src/`. English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/transports/sse/` — expected: Phase 1 tests still green.
- `grep -n 'replayBufferSize ?? 100' src/server/transports/sse/event-replay-buffer.ts` — expected:
  the cap is assigned to a `const` on its own line (parenthesized), never inline inside the `>`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.7 — Effective heartbeat against real proxies

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: S
- **Depends on**: 1.12

#### Description

Phase 1 shipped a symbolic heartbeat. Harden it for real proxies: the configured interval must comfortably beat nginx's 60s idle default and Cloudflare's 100s limit, the configured value is range-validated, the SSE response carries the anti-buffering headers, and a proxy cheat-sheet documents the deployment knobs. The heartbeat remains a raw `: keepalive\n\n` comment written directly to the response stream.

#### Acceptance criteria

- [ ] `HeartbeatService` default interval is `30_000` ms (30s, per spec §4.2 — below the 60s nginx idle default); the keepalive written is exactly `: keepalive\n\n` directly to the Express response (never a `MessageEvent`).
- [ ] The configured `heartbeatMs` is validated to be within `[5_000, 90_000]`; out of range throws `REALTIME_INVALID_OPTIONS`.
- [ ] The SSE response sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (anti-nginx buffering); `Content-Type: text/event-stream`.
- [ ] `docs/proxies-cheat-sheet.md` created: nginx (`proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout` ≥ heartbeat + margin), Cloudflare (no buffering by default but 100s cap on free — recommend Enterprise for long-lived), AWS ALB (`idle_timeout`, default 60s).
- [ ] `pnpm typecheck` and `pnpm test` pass; 100% coverage on the touched files.

#### Files to create / modify

- `src/server/transports/sse/heartbeat.service.ts` (modify — default, range validation, raw comment)
- `src/server/transports/sse/sse-controller.factory.ts` (modify — anti-buffering response headers)
- `docs/proxies-cheat-sheet.md` (new)

#### Agent prompt

````
You are a senior NestJS realtime / infra engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.7 of 12.

PRECONDITIONS
- `HeartbeatService` exists from Phase 1 with `start(connectionId, res, ms)` / `stop(connectionId)`.
- The SSE controller factory exists (Task 2.1).

REQUIRED READING (only these):
- `docs/technical_specification.md` § 6.1 "SseTransport" — the "heartbeat is a true SSE comment,
  not a MessageEvent" note (written directly to the response stream by HeartbeatService).
- `docs/technical_specification.md` § 4.1 / § 4.2 — `sse.heartbeatMs` default 30000.
- `docs/technical_specification.md` § 14 — `REALTIME_INVALID_OPTIONS`.
- `docs/technical_specification.md` § 15 — never put HTTP compression in front of `text/event-stream`;
  send `Cache-Control: no-cache, no-transform`.
- `docs/development_plan.md` § 3.6 — heartbeat effectiveness and the proxy notes.

TASK
Harden the heartbeat and document proxy deployment.

DELIVERABLES

1. `heartbeat.service.ts`:
   - Default interval `30_000` ms (30s) when `sse.heartbeatMs` is unset.
   - On `start`, validate the effective interval is within `[5_000, 90_000]`; out of range throws
     `new Error(REALTIME_ERROR_CODES.INVALID_OPTIONS)` (or the lib's typed error).
   - The interval callback writes the raw string `': keepalive\n\n'` directly to `res` (e.g.
     `res.write(': keepalive\n\n')`) — never via a Subject or MessageEvent. `stop` clears the interval.

2. `sse-controller.factory.ts` — set anti-buffering headers on the SSE response (via the
   `@Res({ passthrough: true })` handle): `Content-Type: text/event-stream`,
   `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.

3. `docs/proxies-cheat-sheet.md`:
   - nginx: `proxy_buffering off;`, `proxy_cache off;`, `proxy_read_timeout` ≥ heartbeat + margin.
   - Cloudflare: no buffering by default, but a 100s cap on free plans — recommend Enterprise for
     long-lived streams.
   - AWS ALB: `idle_timeout` (default 60s) — set above the heartbeat interval.

Constraints:
- The heartbeat NEVER becomes a `MessageEvent` and NEVER carries an `id:` — it stays out of the
  event-id space.
- English-only, timeless comments and docs. Functions ≤ 50 lines.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/transports/sse/heartbeat` — expected: green.
- `grep -q 'X-Accel-Buffering' src/server/transports/sse/sse-controller.factory.ts` — expected: match.
- `test -f docs/proxies-cheat-sheet.md` — expected: present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.8 — `forRootAsync` support

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.13

#### Description

Add `BymaxRealtimeModule.forRootAsync(asyncOptions)` so consumers can resolve options (and the authenticator) through DI — `ConfigService`, `JwtService`, a Redis client, etc. Options are validated and defaulted **inside** the resolving factory, so a malformed config rejects at bootstrap. Because controllers are registered at decoration time, the async path binds the SSE controller to the fixed default endpoint `/events`; document the trade-off.

#### Acceptance criteria

- [ ] `forRootAsync(asyncOptions: BymaxRealtimeModuleAsyncOptions): DynamicModule` added, accepting `useFactory`, `inject`, and `imports`.
- [ ] A resolved-options provider (`REALTIME_OPTIONS_TOKEN`) runs the factory, then `validateOptions` + `applyDefaults`; a malformed config rejects via the Promise at bootstrap.
- [ ] The authenticator provider (`REALTIME_AUTHENTICATOR_TOKEN`) derives from the resolved options; the pub/sub provider falls back to `InMemoryPubSub`; hooks/offline-queue/presence are optional providers.
- [ ] `EventReplayBuffer` is registered as a plain class provider (it injects `REALTIME_OPTIONS_TOKEN` itself — do **not** construct it with a number).
- [ ] All Phase 2 providers are registered (`ConnectionRegistry`, `RoomRegistry`, `EventIdGenerator`, `HeartbeatService`, `SseTransport`, `REALTIME_TRANSPORT_TOKEN` via `useExisting`, `SseSubscriptionHandler`, `ReauthenticationService`, `RealtimeService`).
- [ ] The async path registers `createSseController('/events')` (fixed endpoint); the JSDoc documents that a non-default endpoint with async config should use `forRoot`.
- [ ] A test fixture resolves options from a `ConfigService` stub; `pnpm typecheck` passes; 100% coverage on the module's new path.

#### Files to create / modify

- `src/server/realtime.module.ts` (modify — add `forRootAsync`)

#### Agent prompt

````
You are a senior NestJS module-architecture engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.8 of 12.

PRECONDITIONS
- Task 2.1 + 2.4 are done: `SseSubscriptionHandler` and `ReauthenticationService` exist.
- `BymaxRealtimeModule.forRoot`, `validateOptions`, `applyDefaults`, and the DI tokens exist (Phase 1).

REQUIRED READING (only these):
- `docs/technical_specification.md` § 4.4 "forRootAsync example".
- `docs/technical_specification.md` § 4.7 "BymaxRealtimeModuleAsyncOptions".
- `docs/technical_specification.md` § 4.6 "Injection tokens".
- `docs/technical_specification.md` § 7.4 — `EventReplayBuffer` injects the options token (so it is a
  plain class provider, NOT constructed with a number).
- `docs/development_plan.md` § 3.7 — the `forRootAsync` skeleton and the fixed-endpoint trade-off.

TASK
Add `BymaxRealtimeModule.forRootAsync`.

DELIVERABLES

1. `src/server/realtime.module.ts`:

   ```typescript
   static forRootAsync(asyncOptions: BymaxRealtimeModuleAsyncOptions): DynamicModule {
     const resolvedOptionsProvider: Provider = {
       provide: REALTIME_OPTIONS_TOKEN,
       useFactory: async (...args: unknown[]) => {
         const raw = await asyncOptions.useFactory(...(args as never[]))
         validateOptions(raw)
         return applyDefaults(raw)
       },
       inject: [...(asyncOptions.inject ?? [])],
     }

     const authenticatorProvider: Provider = {
       provide: REALTIME_AUTHENTICATOR_TOKEN,
       useFactory: (opts: BymaxRealtimeModuleOptions) => opts.authenticator,
       inject: [REALTIME_OPTIONS_TOKEN],
     }

     const pubsubProvider: Provider = {
       provide: REALTIME_PUBSUB_TOKEN,
       useFactory: (opts: BymaxRealtimeModuleOptions) => opts.pubsub ?? new InMemoryPubSub(),
       inject: [REALTIME_OPTIONS_TOKEN],
     }
     // hooks / offlineQueue / presence: optional providers derived from resolved options.

     const providers: Provider[] = [
       resolvedOptionsProvider,
       authenticatorProvider,
       pubsubProvider,
       ConnectionRegistry,
       RoomRegistry,
       EventIdGenerator,
       EventReplayBuffer,                                 // plain class — injects REALTIME_OPTIONS_TOKEN
       HeartbeatService,
       SseTransport,
       { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
       SseSubscriptionHandler,
       ReauthenticationService,
       RealtimeService,
       ...(asyncOptions.extraProviders ?? []),
     ]

     return {
       module: BymaxRealtimeModule,
       imports: asyncOptions.imports ?? [],
       providers,
       // Controllers register at decoration time, so the async path binds the fixed default
       // endpoint. Consumers needing a custom endpoint with async config should use forRoot.
       controllers: [createSseController('/events')],
       exports: [
         RealtimeService,
         ConnectionRegistry,
         RoomRegistry,
         REALTIME_OPTIONS_TOKEN,
         REALTIME_TRANSPORT_TOKEN,
       ],
     }
   }
   ```

Constraints:
- Validation + defaulting happen INSIDE the resolving factory (not at the `forRootAsync` call site);
  a malformed config rejects via the Promise at bootstrap.
- `EventReplayBuffer` is a class provider — never `new EventReplayBuffer(<number>)`.
- No concrete-auth import in `src/`. English-only, timeless comments (the fixed-endpoint note must
  not reference any roadmap stage).

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/realtime.module.spec.ts` — expected: the forRootAsync fixture (ConfigService
  stub) resolves options and the module compiles.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.9 — Tests: three auth patterns

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.2

#### Description

Specs for the three authentication patterns using the fixtures from Task 2.2, plus an integration spec proving the `SseSubscriptionHandler` works with each pattern. Cover the authenticator fixtures and the handler to 100% line/branch.

#### Acceptance criteria

- [ ] `test/fixtures/authenticators/cookie-jwt.authenticator.spec.ts` (6+ cases): valid JWT cookie → `{ userId, tenantId, roles }`; missing cookie → `null`; expired JWT → `null`; malformed JWT → `null` (silent catch); custom cookie name works; roles extracted.
- [ ] `test/fixtures/authenticators/ticket.authenticator.spec.ts` (6+ cases): valid ticket in query → auth result and ticket consumed (a second call fails); missing ticket → `null`; expired ticket → `null`; invalid ticket → `null`; concurrent same-ticket calls → only one wins (atomicity); empty query → `null`.
- [ ] `test/fixtures/authenticators/bearer.authenticator.spec.ts` (5+ cases): `Authorization: Bearer xyz` valid → auth result; no header → `null`; header without the `Bearer ` prefix → `null`; empty token (`Bearer `) → `null`; SSE context still works when the header is present (docs warn against it).
- [ ] `test/integration/sse-subscription-handler.spec.ts`: each of the three patterns → `handle` returns an Observable; auth failure → `UnauthorizedException`; connection registered in `ConnectionRegistry`; auto-join `user:{id}` and `tenant:{id}`; `onConnect` fired.
- [ ] 100% line/branch coverage on the fixtures and `SseSubscriptionHandler`; `pnpm test` passes.

#### Files to create / modify

- `test/fixtures/authenticators/cookie-jwt.authenticator.spec.ts`, `ticket.authenticator.spec.ts`, `bearer.authenticator.spec.ts` (new)
- `test/integration/sse-subscription-handler.spec.ts` (new)

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict. Tests run with Jest (ts-jest) bounded at maxWorkers 50%.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.9 of 12.

PRECONDITIONS
- Task 2.2 is done: the three fixtures exist in `test/fixtures/authenticators/`.
- Task 2.1 is done: `SseSubscriptionHandler` exists.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 5.2 "IConnectionAuthenticator" — the contract and the
  ConnectionAuthContext shape under test.
- `docs/technical_specification.md` § 8.1 / § 8.2 — the three patterns and their constraints.
- `docs/development_plan.md` § 3.2 — fixture intent.

TASK
Write specs for the three pattern fixtures plus an integration spec for the handler.

DELIVERABLES
- `cookie-jwt.authenticator.spec.ts` — the six cookie cases above.
- `ticket.authenticator.spec.ts` — the six ticket cases above, including atomic single-use and
  concurrent contention (only one of two concurrent calls for the same ticket wins).
- `bearer.authenticator.spec.ts` — the five bearer cases above.
- `test/integration/sse-subscription-handler.spec.ts` — boot a minimal testing module, feed a mock
  `Request` for each pattern, assert: `handle` returns an Observable; a `null` auth → throws
  `UnauthorizedException`; the connection is registered; the user/tenant rooms are auto-joined; the
  `onConnect` hook fired.

Constraints:
- Every `it()` carries a one-line comment stating what it proves; assert real branches (no fake
  values that always pass). Drive the fixtures and the handler to 100% line/branch coverage.
- No concrete-auth import in `src/` (tests/fixtures may use `jsonwebtoken`).
- English-only, timeless test names and comments.

Verification:
- `pnpm test test/fixtures/authenticators test/integration/sse-subscription-handler` — expected: green.
- `pnpm test:cov -- test/fixtures/authenticators src/server/transports/sse/sse-subscription.handler.ts`
  — expected: 100% on the fixtures and the handler.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.10 — Tests: `ReauthenticationService` + lifecycle hooks

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.4, 2.6

#### Description

Specs for the periodic re-authentication cycle and the wired lifecycle hooks, using fake timers to drive `setInterval`. Cover the service to 100% line/branch.

#### Acceptance criteria

- [ ] `src/server/services/reauthentication.service.spec.ts` (8+ cases): timer scheduled in `onModuleInit` when the authenticator implements `revalidate`; a cycle calls `revalidate` for each connection; a positive-cache hit skips revalidation; an expired cache entry triggers revalidation again; `revalidate` returns `false` + `onFailure: 'disconnect'` → `transport.disconnect` called; `revalidate` returns `false` + `onFailure: 'event'` → reserved event emitted then disconnect; a throwing `revalidate` is treated as a non-fatal cycle error; an authenticator without `revalidate` → no timer (informative log); `onApplicationShutdown` clears the timer; `onReauthenticationFailed` hook fired on failure. Uses `jest.useFakeTimers()`.
- [ ] `test/integration/lifecycle-hooks.spec.ts` (5+ cases): `onConnect` fired after register with correct meta; `onDisconnect` fired in cleanup with computed `durationMs`; `onError` fired on an upstream error; a throwing hook does not break the lifecycle (subsequent emits still work); all four hooks undefined → no crash.
- [ ] 100% line/branch coverage on `reauthentication.service.ts`; `pnpm test` passes.

#### Files to create / modify

- `src/server/services/reauthentication.service.spec.ts` (new)
- `test/integration/lifecycle-hooks.spec.ts` (new)

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict. Tests run with Jest (ts-jest), maxWorkers 50%.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.10 of 12.

PRECONDITIONS
- Task 2.4 is done: `ReauthenticationService` exists.
- Task 2.6 is done: the lifecycle hooks are wired into the handler.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 8.3 "Periodic re-authentication" and § 4.2 (policy defaults).
- `docs/technical_specification.md` § 5.3 "IConnectionLifecycleHooks".
- `docs/technical_specification.md` § 13 — `connection:reauthentication-failed` payload `{ reason }`.
- `docs/development_plan.md` § 3.3 (reauth) and § 3.5 (hooks).

TASK
Write the reauthentication-service spec (fake timers) and the lifecycle-hooks integration spec.

DELIVERABLES
- `reauthentication.service.spec.ts` — the cases listed in the acceptance criteria, using
  `jest.useFakeTimers()` to advance the interval and `jest.spyOn` on a mock authenticator,
  `RealtimeService`/transport, and hooks. Assert cache-skip, cache-expiry, both failure modes, the
  throwing-revalidate resilience, the no-revalidate no-op, and shutdown cleanup.
- `lifecycle-hooks.spec.ts` — boot a minimal module and assert hook order/timing, `durationMs`
  computation, `onError` on an upstream Subject error, the throwing-hook resilience, and the
  all-undefined-hooks no-crash path.

Constraints:
- Every `it()` carries a one-line comment of what it proves. Drive `reauthentication.service.ts` to
  100% line/branch. Restore real timers in `afterEach`.
- English-only, timeless test names and comments.

Verification:
- `pnpm test src/server/services/reauthentication.service.spec.ts test/integration/lifecycle-hooks.spec.ts`
  — expected: green.
- `pnpm test:cov -- src/server/services/reauthentication.service.ts` — expected: 100% lines/branches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.11 — Tests: `encodeSseEvent` + `Last-Event-ID` replay

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.5, 2.6

#### Description

Specs for the SSE encoder (a critical path — mutation focus ≥ 95%) and for the `Last-Event-ID` replay flow. Cover the encoder to 100% line/branch.

#### Acceptance criteria

- [ ] `src/server/utils/encode-sse-event.spec.ts` (10+ cases): single-line string data → `data: foo\n\n`; object data → JSON, single line; multi-line data (`'a\nb'`) → two `data:` lines; no `id` → no `id:` line; no `type` → no `event:` line (default `message`); `type: 'message'` → no `event:` line; an `id` containing `\n` (document the pass-through limitation); empty data → `data: \n\n`; a heartbeat → `: keepalive\n\n`; the terminator is always `\n\n`.
- [ ] `test/integration/last-event-id-replay.spec.ts` (5+ cases): reconnect without `Last-Event-ID` → no replay (only `connection:established`); reconnect with `Last-Event-ID: <id>` → replay of events with id > that id; replay respects buffer order; new events start only after the complete replay; an unknown `Last-Event-ID` (buffer gap) → empty replay.
- [ ] 100% line/branch coverage on `encode-sse-event.ts`; `pnpm test` passes.

#### Files to create / modify

- `src/server/utils/encode-sse-event.spec.ts` (new)
- `test/integration/last-event-id-replay.spec.ts` (new)

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict. Tests run with Jest (ts-jest), maxWorkers 50%.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.11 of 12.

PRECONDITIONS
- Task 2.5 is done: `encodeSseEvent` exists.
- Task 2.6 is done: Last-Event-ID replay is wired into the handler.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 6.1 "Event format on the wire (SSE)" — the exact byte layout.
- `docs/technical_specification.md` § 10.1 "Last-Event-ID".
- `docs/technical_specification.md` § 13 — heartbeat is a comment, not a named event.
- `docs/development_plan.md` § 3.4 — the encoder cases.

TASK
Write the encoder spec (critical path) and the Last-Event-ID replay integration spec.

DELIVERABLES
- `encode-sse-event.spec.ts` — the 10+ cases above, asserting exact output strings (byte-for-byte,
  including the trailing `\n\n`). This is a critical path: the suite must be strong enough to clear
  Stryker `break 95` (drive toward 100%).
- `last-event-id-replay.spec.ts` — simulate a reconnect with a mock `Request` carrying
  `last-event-id`; assert replay membership (id > sinceId), buffer order, replay-before-live
  ordering, and the empty-replay paths (no header; unknown id / buffer gap).

Constraints:
- Every `it()` carries a one-line comment of what it proves; assert exact wire bytes for the encoder.
- English-only, timeless test names and comments.

Verification:
- `pnpm test src/server/utils/encode-sse-event.spec.ts test/integration/last-event-id-replay.spec.ts`
  — expected: green.
- `pnpm test:cov -- src/server/utils/encode-sse-event.ts` — expected: 100% lines/branches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.11 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 2.12 — Phase 2 consolidated validation

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.1…2.11

#### Description

Run the full gate set, an extended smoke test (cookie connect → `connection:established`; reconnect with `Last-Event-ID` → replay; expired credential → 401), confirm coverage and the auth-inversion guard, and apply `/bymax-quality:code-review` findings. Closing task for the phase.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm test:e2e` all pass.
- [ ] 100% line/branch coverage on every file implemented in this phase; mutation focus ≥ 95% (Stryker `break 95`) on the critical paths (`reauthentication.service.ts`, `encode-sse-event.ts`, `sse-subscription.handler.ts`, the authenticator fixtures).
- [ ] Extended smoke test covers three scenarios: connect with a valid cookie (receive `connection:established`); reconnect with `Last-Event-ID` (receive replay); connect with an expired credential (receive 401).
- [ ] Auth-inversion guard passes: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` returns zero matches.
- [ ] `/bymax-quality:code-review` executed and findings applied; commits are Conventional Commits.

#### Files to create / modify

- (validation only — no library source changes beyond review findings)

#### Agent prompt

````
You are a senior NestJS release engineer closing Phase 2 of @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime push library for NestJS 11.
pnpm@11.0.0, TypeScript strict.

CURRENT PHASE: 2 (Auth + Last-Event-ID + Reauthentication) — Task 2.12 of 12 (LAST).

PRECONDITIONS
- Tasks 2.1…2.11 are done: handler refactor, three auth patterns + bridge, reauthentication service,
  encoder, Last-Event-ID replay + hooks, heartbeat hardening, forRootAsync, and all specs.

REQUIRED READING (only these):
- `docs/development_plan.md` § 3.8 "Phase 2 validation" and § 1.7 "Global per-phase Done criteria".
- `docs/technical_specification.md` § 1.6 "Design principles" — the auth-inversion structural rule.

TASK
Run the consolidated validation and close the phase.

DELIVERABLES
1. Run the gates: `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm test:e2e`.
2. Extended smoke test — boot a fixture app via `Test.createTestingModule().compile()
   .createNestApplication()` with `BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator:
   <cookie-jwt fixture> })` and a controller that injects `RealtimeService`. Using the `eventsource`
   devDependency, exercise three scenarios:
   - Connect with a valid cookie → receive `connection:established`, then disconnect.
   - Reconnect with `Last-Event-ID` set → receive the replayed events.
   - Connect with an expired credential → receive HTTP 401.
3. Confirm coverage gates (100% per file; mutation ≥ 95% on the critical paths) and the
   auth-inversion guard.
4. Run `/bymax-quality:code-review` and apply every finding; re-run the gates after fixes.

Constraints:
- Auth-inversion is a release blocker: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|
  from 'passport" src/` must return zero matches.
- Do not weaken any gate to make it pass; fix the code. No `eslint-disable` / `@ts-ignore`.
- English-only, timeless comments. Conventional Commits.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm test:e2e` — expected: all green.
- `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` — expected: zero.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index. Mark the phase ✅ only when every §1.7 Done-criteria bullet is met.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 2.12 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 2.1 ✅ 2026-06-27 — Extracted SseSubscriptionHandler from factory; factory is now a thin shell; FIFO eviction, onConnect hook, anti-buffering headers, and replay all moved to handler.
- 2.2 ✅ 2026-06-27 — Authored three auth-pattern docs (cookie, ticket, bearer) and three standalone test fixtures implementing IConnectionAuthenticator.
- 2.3 ✅ 2026-06-27 — Authored nest-auth-bridge reference doc and cross-linked it from cookie-httponly.md.
- 2.4 ✅ 2026-06-27 — Implemented ReauthenticationService with FIFO-per-user positive cache, both onFailure modes, best-effort hooks, and graceful shutdown.
- 2.5 ✅ 2026-06-27 — Implemented pure encodeSseEvent utility with multi-line data, heartbeat comment, and W3C SSE wire format.
- 2.6 ✅ 2026-06-27 — Confirmed Last-Event-ID replay in handler; added catchError to wire onError lifecycle hook; per-user EventReplayBuffer with parenthesized cap confirmed.
- 2.7 ✅ 2026-06-27 — Added range validation [5000,90000]ms to HeartbeatService; anti-buffering headers moved to factory; proxy cheat sheet authored.
- 2.8 ✅ 2026-06-27 — Added forRootAsync to BymaxRealtimeModule; validates+defaults inside factory; all Phase 2 providers registered; fixed endpoint /events with JSDoc trade-off note.
- 2.9 ✅ 2026-06-27 — Authored specs for cookie-jwt, ticket, bearer fixtures and handler integration spec; jest configs extended to cover test/ directory.
