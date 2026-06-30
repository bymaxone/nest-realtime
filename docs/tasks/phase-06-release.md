# Phase 6 — Release v0.1.0

> **Status**: 🔄 In Progress · **Progress**: 8 / 10 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 7
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

This is the final phase. The library code is complete through Phase 5 (server dual-transport, auth, scaling, and the `./react` frontend). Phase 6 turns the working code into a **published, fully-documented, supply-chain-hardened npm release** — `@bymax-one/nest-realtime@0.1.0` on npm with provenance.

The work is predominantly mechanical and documental: write the public `README.md` (with four copy-pasteable Quick-Start scenarios), the `CHANGELOG.md`, `SECURITY.md`, `LICENSE`, and the agent-facing `CLAUDE.md` / `AGENTS.md`; add the release-time GitHub Actions workflows (`release` + a scheduled cross-instance e2e) and verify the Phase-1 CI set (`ci`/`codeql`/`scorecard`); establish the mutation-testing baseline and document it; calibrate the bundle-size budgets against the real `dist/`; finalize `.npmignore`; run the complete pre-publish gate; and finally tag `v0.1.0` and let `release.yml` publish with provenance.

Residual (non-mechanical) risk: fine-tuning the bundle budgets once the real `dist/` is measured, and the mutation baseline possibly revealing weak tests that need extra work. When Phase 6 is done, `pnpm prepublishOnly && pnpm size` is green, the four CI workflows are green on every PR, the `dist/` carries all three subpath bundles, auth inversion is preserved (`src/` references no concrete auth library), `socket.io-client` is absent from the SSE-only static bundle, and the tag is published.

---

## Rules-of-phase

1. **English-only & timeless comments** — no `Phase N` / `Task` / roadmap-stage references inside any committed file (code, config, or the docs-as-config files `CLAUDE.md` / `AGENTS.md`). A reference to a **doc section** (`spec §4`, `plan §7.1`) is allowed; a reference to a **plan stage** is not.
2. **Never create `.gitkeep` / `.keep` or empty-directory placeholders** — directories emerge from real files only.
3. **Auth inversion is a structural rule, not guidance.** There must be **NO** reference to `JwtService` / `JwtPayload` / `@bymax-one/nest-auth` / `passport-*` / `@nestjs/jwt` in any file of `src/`. The only allowed references are in `docs/` (bridge examples) and in tests (mocks). The final pre-publish gate greps `src/` for these and must return **zero**.
4. **Quality floor** — 100% line/branch coverage on every implemented file (Bymax library standard). Mutation testing is a pre-release gate: Stryker thresholds **high 99 / low 95 / break 95**; critical paths ≥ 95%.
5. **Bundle budgets (brotli)** — server bundle ≤ **18 KB**, `./shared` ≤ **3 KB**, `./react` SSE-only ≤ **4 KiB** (brotli, never gzipped). `socket.io-client` must **not** appear in `dist/react/index.mjs` — it is loaded via dynamic `import()` only.
6. **FIFO connection limit** — where docs describe `maxConnectionsPerUser`, state that the limit is enforced via **FIFO eviction**: the user's **oldest** connection is evicted (closed with `REALTIME_TOO_MANY_CONNECTIONS`) and the new one is admitted. The limit is **never** enforced by rejecting the new connection with HTTP 429.
7. **Heartbeat is a raw `: keepalive\n\n` SSE comment** written to the response stream by `HeartbeatService` — it is **not** a `MessageEvent`, **not** a named event, lives outside the event-id space, and is **absent** from the §13 reserved-event catalog. Docs that mention it must describe it as a comment-line keepalive, not as a reserved/named event.
8. **`CompositeTransport.kind === 'sse'`** (the dominant transport). `ITransport.kind` is `'sse' | 'websocket'` — never `'both'`.
9. **Cross-instance emit shape** — the public `emit*` / `broadcast` / `disconnect` methods do local delivery **plus a single publish**; the pub/sub subscriber re-emits via local-only paths (`emitToUserLocal` / `emitToTenantLocal` / `emitToRoomLocal` / `broadcastLocal` / `disconnectLocal`); cross-instance revocation uses an `op: 'disconnect'` producer. Any architectural description (AGENTS.md) must match this.
10. **Three subpaths only** — `.` (server), `./shared`, `./react`. The published tarball ships **only** `dist/` + `package.json` + `README.md` + `LICENSE` + `CHANGELOG.md`.
11. **Tooling** — `pnpm@11.0.0`, Node.js 24+, Conventional Commits (no `Co-Authored-By` trailer), npm publish **with provenance**.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 1.5 Distribution model, § 1.6 Design principles, § 3.1–3.3 Package structure & subpath exports, § 4.1–4.6 Configuration API, § 5.2 `IConnectionAuthenticator`, § 8.1 Auth patterns, § 9.1 Rooms convention, § 9.5 Anti-IDOR, § 11 Horizontal scalability, § 12 Frontend integration, § 13 Standard event catalog, § 14 Error code catalog, § 16 Dependencies.
- [`docs/development_plan.md`](../development_plan.md) — § 1.7 Global per-phase Done criteria, § 1.9 Expected end file structure, § 1.11 Attention points, § 6.5 Bundle size validation, § 7.1–7.5 (README / governance / CI / mutation baseline / tag & publish).
- `/bymax-workflow:standards` skill — universal coding & repo conventions (TypeScript track).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 6.1 | `README.md` with badges + 4 Quick-Start scenarios | ✅ Done | P0 | M | 5.12 |
| 6.2 | `CHANGELOG.md` (Keep a Changelog format) | ✅ Done | P0 | S | 1.1 |
| 6.3 | `SECURITY.md` (auth-inversion + CORS + anti-IDOR) | ✅ Done | P0 | S | 1.1 |
| 6.4 | `CLAUDE.md` + `AGENTS.md` agent quick reference | ✅ Done | P1 | M | 1.1 |
| 6.5 | Finalize CI — `release.yml` + scheduled cross-instance e2e (verify the Phase-1 workflows) | ✅ Done | P0 | M | 1.16 |
| 6.6 | Mutation-testing plan + results + baseline run | 🟡 Partial | P1 | M | 5.12 |
| 6.7 | `LICENSE` (MIT) + finalized `.npmignore` | ✅ Done | P0 | S | 1.1 |
| 6.8 | Final bundle-size budgets | ✅ Done | P1 | S | 5.12 |
| 6.9 | Final pre-publish gate | ✅ Done | P0 | S | 6.1…6.8 |
| 6.10 | Tag `v0.1.0` + npm publish `--provenance` | 📋 ToDo | P0 | S | 6.9 |

---

## Tasks

### Task 6.1 — `README.md` with badges + 4 Quick-Start scenarios

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.12

#### Description

Author the public `README.md`, mirroring the canonical `../nest-auth/README.md` structure, with four complete copy-pasteable Quick-Start scenarios (single-instance SSE, SSE + Redis pub/sub, WebSocket-only, and `'both'` migration mode) and an Auth-Inversion section as the first entry after Quick Start.

#### Acceptance criteria

- [ ] `README.md` contains every section: Overview, Features, Subpath Exports, Quick Start (4 scenarios), Configuration, Auth Inversion, Replay & Offline Queue, Frontend, Horizontal Scaling, Infra notes, Testing, Contributing, License.
- [ ] The four Quick-Start scenarios are complete and copy-pasteable (forRoot single-instance SSE; SSE + `RedisRealtimePubSub` + `RedisOfflineQueue`; WebSocket-only with Socket.IO Redis adapter; `transport: 'both'` migration).
- [ ] Badges present and pointed at `bymaxone/nest-realtime`: npm version, downloads, CI status, coverage, mutation score, OpenSSF Scorecard, license, TypeScript, Node 24+, provenance.
- [ ] A Peer-deps table clearly marks which dependencies are optional (per transport / per subpath).
- [ ] The **Auth Inversion** section is the first heading after Quick Start and explains the structural rule; links to the bridge examples under `docs/`.
- [ ] All cross-links resolve (SECURITY.md, CHANGELOG.md, spec, plan, infra notes).

#### Files to create / modify

- `README.md`

#### Agent prompt

````
You are a senior NestJS library author / technical writer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — a public npm library: dual-transport realtime for NestJS 11
(SSE default, WebSocket opt-in) with a unified server-side API and a React 19 frontend subpath.
Zero direct dependencies; everything via peer deps. Three subpaths: `.` (server), `./shared`,
`./react`. Auth is inverted: the consumer plugs an `IConnectionAuthenticator`.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.1 of 10.

PRECONDITIONS
- The library source (server + ./react) is complete through the previous phase; `dist/` builds.
- A sibling library lives at `../nest-auth/` — use its `README.md` only as a structural template.

REQUIRED READING (only these — do not load the whole spec):
- `docs/development_plan.md` § 7.1 "README with 4 scenarios" (the exact section list, the four
  scenario snippets, and the acceptance bullets).
- `docs/technical_specification.md` § 3.2 + § 3.3 "Subpath exports" (the three subpaths and what
  each exports), § 4.3–4.6 "Configuration API" examples (forRoot / forRootAsync), § 8.1 "Three
  supported patterns" (auth inversion), § 9.1 "Room ID convention", § 11 "Horizontal Scalability"
  (IRealtimePubSub for SSE, @socket.io/redis-adapter for WS), § 12.1 + § 12.5 "Frontend"
  (useRealtime, RealtimeProvider, usePresence), § 1.5 "Distribution model".
- `../nest-auth/README.md` — copy only its structure/badge layout; rewrite all content for realtime.

TASK
Write `README.md` at the repo root, mirroring the `../nest-auth/README.md` structure.

DELIVERABLES
- Header: badges row (npm version, downloads, CI status, coverage, mutation score, OpenSSF
  Scorecard, license, TypeScript, Node 24+, provenance) — all URLs target `bymaxone/nest-realtime`
  and the npm package `@bymax-one/nest-realtime`. Centered title + one-line tagline.
- `## ✨ Overview` — what the lib is (dual-transport SSE+WS, transport-agnostic emit, multi-tenant).
- `## 🔥 Features` — bullet list of the headline features.
- `## 📦 Subpath Exports` — table of the three subpaths (`.`, `./shared`, `./react`) and their peer
  deps; mark optional peer deps clearly.
- `## 🚀 Quick Start` — four complete, copy-pasteable scenarios:
  1. SSE single-instance (`forRoot({ transport: 'sse', authenticator })`, InMemoryPubSub default).
  2. SSE + Redis pub/sub multi-instance (`RedisRealtimePubSub` + `RedisOfflineQueue`; reference impls
     live in `docs/examples`, not in lib code).
  3. WebSocket-only (`transport: 'websocket'`, Socket.IO Redis adapter via `websocket.redisAdapter`).
  4. `transport: 'both'` migration (legacy SSE clients coexist with new WS clients).
- `## 🔌 Auth Inversion` — FIRST section after Quick Start: explain that the lib never verifies
  JWTs / hashes passwords / imports any auth library; it only calls the consumer-provided
  `IConnectionAuthenticator`. Show the three patterns (cookie HttpOnly, ticket, bearer) briefly and
  link to the `@bymax-one/nest-auth` bridge example under `docs/`.
- `## 🧩 Configuration` — link to spec § 4 for the full options table.
- `## 🔍 Replay & Offline Queue` — how Last-Event-ID works, when to configure `IOfflineQueueStorage`.
- `## 🌐 Frontend (./react)` — `useRealtime`, `RealtimeProvider`, `usePresence` with a React 19 example.
- `## ⚙️ Horizontal Scaling` — pub/sub for SSE, Redis adapter for WS, optional integration with
  `@bymax-one/nest-cache`.
- `## 🚧 Infra notes` — link to the proxy/CDN appendix (Nginx, Cloudflare, AWS, serverless).
- `## 📊 Rooms Convention` — `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`.
- `## 🧪 Testing` — pnpm commands.
- `## 🤝 Contributing` (link SECURITY.md) and `## 📜 License` (MIT).

Constraints:
- English only; timeless content — no roadmap/phase references (doc-section links are fine).
- Describe the SSE heartbeat correctly: a `: keepalive` comment line, NOT a named/reserved event.
- Describe `maxConnectionsPerUser` correctly: FIFO eviction of the oldest connection (closed with
  `REALTIME_TOO_MANY_CONNECTIONS`), the new connection is admitted — never a 429 rejection.
- Genericize any example consumer to "a consuming NestJS app"; the only named bridge is the
  `@bymax-one/nest-auth` bridge **example** (in docs, not in lib code).
- All four scenarios must reflect the real public API surface (forRoot / forRootAsync options).

Verification:
- `ls README.md` — present.
- `npx markdownlint-cli README.md --no-config || true` — no blocking errors.
- Manually confirm every cross-link target exists (SECURITY.md, CHANGELOG.md, docs/…).
- `grep -c '```' README.md` — the four scenario code fences (and others) are balanced.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.2 — `CHANGELOG.md` (Keep a Changelog format)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Create `CHANGELOG.md` in Keep-a-Changelog + SemVer format with a detailed `0.1.0` entry covering the full feature set of the initial release.

#### Acceptance criteria

- [ ] `CHANGELOG.md` has the Keep-a-Changelog header and a SemVer adherence note.
- [ ] An `## [Unreleased]` section exists above the released entry.
- [ ] A detailed `## [0.1.0]` entry lists the dual-transport architecture, `RealtimeService` API, `IConnectionAuthenticator`, `EventReplayBuffer` / Last-Event-ID, `IRealtimePubSub` + `InMemoryPubSub` + `RedisRealtimePubSub`, `IOfflineQueueStorage` + `RedisOfflineQueue`, `IPresenceStorage`, lifecycle hooks, re-authentication policy, heartbeat keepalive, `@socket.io/redis-adapter` integration, `CompositeTransport` (`'both'` mode), multi-tenant room conventions, `forRoot` / `forRootAsync`, the React subpath hooks, the dynamic-imported `socket.io-client`, and the zero-direct-dependencies posture.
- [ ] A `### Security` sub-section notes auth inversion and server-side tenant isolation.

#### Files to create / modify

- `CHANGELOG.md`

#### Agent prompt

````
You are a senior NestJS library author working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS 11 (SSE default,
WebSocket opt-in) + React 19 frontend subpath. Zero direct deps; auth inverted via
`IConnectionAuthenticator`.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.2 of 10.

PRECONDITIONS
- The feature set of v0.1.0 is complete (server + ./react). A sibling `../nest-auth/CHANGELOG.md`
  exists as a format reference only.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.2 "CHANGELOG.md, SECURITY.md, CLAUDE.md, AGENTS.md" (the canonical
  `## [0.1.0]` Added + Security bullet list).
- `../nest-auth/CHANGELOG.md` — Keep-a-Changelog formatting reference only.

TASK
Create `CHANGELOG.md`.

DELIVERABLES
- The Keep-a-Changelog header:

  ```markdown
  # Changelog
  All notable changes to this project will be documented in this file.
  The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
  and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

  ## [Unreleased]

  ## [0.1.0] - 2026-XX-XX
  ### Added
  - Initial release
  - Dual-transport architecture: SSE (default) + WebSocket (opt-in) via the `ITransport` abstraction
  - `RealtimeService` unified server-side API (emitToUser/Tenant/Room, broadcast, room ops, disconnect)
  - `IConnectionAuthenticator` plug-and-play auth contract (cookie HttpOnly, ticket, bearer patterns)
  - `EventReplayBuffer` ring buffer per user for Last-Event-ID seamless reconnect (SSE)
  - `IRealtimePubSub` cross-instance pub/sub with `InMemoryPubSub` default and `RedisRealtimePubSub`
    reference implementation
  - `IOfflineQueueStorage` + `RedisOfflineQueue` for events delivered while a user is offline
  - `IPresenceStorage` optional online-users tracking
  - Lifecycle hooks: onConnect, onDisconnect, onError, onReauthenticationFailed (fire-and-forget)
  - Re-authentication policy: periodic credential revalidation with a positive cache
  - Heartbeat keepalive tuned for real-world proxies (Nginx, Cloudflare, AWS ALB)
  - `@socket.io/redis-adapter` integration for WebSocket horizontal scaling
  - `CompositeTransport` for `transport: 'both'` mode (migration scenario)
  - Multi-tenant first-class: `user:{id}`, `tenant:{id}`, `resource:{type}:{id}` room conventions
  - `forRoot` + `forRootAsync` dynamic-module support
  - Frontend React subpath: `useRealtime` (auto-detects SSE vs WS), `useRealtimeConnection`,
    `RealtimeProvider`, `usePresence`
  - `socket.io-client` dynamic-imported (kept out of the SSE-only static bundle)
  - Zero direct dependencies — everything via peer deps (`rxjs` required; WebSocket/Redis/React optional)

  ### Security
  - Auth inversion — the library never imports an auth concrete
  - Tenant isolation enforced server-side via the room registry
  ```

Constraints:
- English only; timeless content. Keep the heartbeat described as a keepalive (a `: keepalive`
  comment), not as a named event.
- Do not invent features beyond the v0.1.0 surface in plan § 7.2.

Verification:
- `grep -q Unreleased CHANGELOG.md` — match.
- `grep -q '0.1.0' CHANGELOG.md` — match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.3 — `SECURITY.md` (auth-inversion + CORS + anti-IDOR)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Author `SECURITY.md` from the `../nest-auth/SECURITY.md` template, adapted for realtime — with explicit sections on the library's auth-inversion responsibility boundary, CORS configuration ownership, and anti-IDOR / tenant-isolation responsibility.

#### Acceptance criteria

- [ ] `SECURITY.md` present, with supported-versions and a private-disclosure process (contact `security@bymax.one`; ask reporters not to open public issues for vulnerabilities).
- [ ] A section on **auth-inversion responsibility**: the lib does not verify JWTs, hash passwords, etc.; it only calls the consumer-provided `IConnectionAuthenticator`. Vulnerabilities in **bridges** (e.g. the `@bymax-one/nest-auth` bridge) must be reported to the corresponding project, not this lib.
- [ ] A section on **CORS configuration**: the consumer is responsible; the lib exposes `CorsConfig` in `SseOptions` and `WebSocketOptions`.
- [ ] A section on **anti-IDOR**: the lib only emits to rooms; the consumer must not emit cross-tenant improperly (server-side tenant isolation via the room registry).

#### Files to create / modify

- `SECURITY.md`

#### Agent prompt

````
You are a senior NestJS library maintainer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS 11; auth inverted via
`IConnectionAuthenticator`; multi-tenant via room conventions.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.3 of 10.

PRECONDITIONS
- A sibling `../nest-auth/SECURITY.md` exists as a template.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.2 (the SECURITY.md note: copy the nest-auth template, adapt
  references).
- `docs/technical_specification.md` § 5.2 "IConnectionAuthenticator" (what the lib does NOT do),
  § 9.5 "Anti-IDOR — protection against improper cross-tenant emit", § 4.1 + § 4.2 (the `CorsConfig`
  field inside `SseOptions` / `WebSocketOptions`).
- `../nest-auth/SECURITY.md` — template only.

TASK
Create `SECURITY.md` adapted for nest-realtime.

DELIVERABLES
- Copy the nest-auth structure; replace every `nest-auth` reference with `nest-realtime`.
- Supported versions + a private disclosure process. Security contact: `security@bymax.one`.
- A section "Auth-inversion responsibility": the lib never verifies JWTs / hashes passwords / imports
  an auth library — it only calls the consumer's `IConnectionAuthenticator`. A vulnerability in a
  bridge implementation (e.g. the `@bymax-one/nest-auth` bridge) is reported to that project, not here.
- A section "CORS configuration": the consumer owns CORS; the lib exposes `CorsConfig` in `SseOptions`
  and `WebSocketOptions`.
- A section "Anti-IDOR / tenant isolation": the lib only emits to rooms; the consumer is responsible
  for not emitting cross-tenant; tenant isolation is enforced server-side via the room registry.

Constraints:
- English only; timeless content. No phase/task references.

Verification:
- `ls SECURITY.md` — present.
- `grep -qi 'auth' SECURITY.md && grep -qi 'cors' SECURITY.md && grep -qi 'idor' SECURITY.md` — match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.4 — `CLAUDE.md` + `AGENTS.md` agent quick reference

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.1

#### Description

Author `CLAUDE.md` (a concise AI-agent quick reference) and `AGENTS.md` (a deeper architecture / patterns / testing reference), adapted from the `../nest-auth/` templates but rewritten for the realtime domain (dual-transport, auth inversion, rooms, cross-instance fan-out).

#### Acceptance criteria

- [ ] `CLAUDE.md` and `AGENTS.md` both exist.
- [ ] Content reflects the SSE+WS dual-transport architecture (not JWT/MFA/OAuth).
- [ ] Critical Rules cover: npm library (zero direct deps), auth inversion (never import a concrete auth lib in `src/`), SSE-first / WS opt-in, `socket.io-client` dynamic import, multi-tenant rooms, cross-instance via `IRealtimePubSub`, fire-and-forget lifecycle hooks, zero `any`.
- [ ] Subpaths listed correctly: three (`.`, `./shared`, `./react`), not five.
- [ ] The reserved-events note lists the §13 catalog correctly and clarifies that the SSE heartbeat is a `: keepalive` comment, **not** a reserved/named event.
- [ ] `AGENTS.md` documents the architectural decisions, including the cross-instance emit shape (local delivery + single publish; subscriber re-emits via local-only paths; `op: 'disconnect'` producer for revocation) and the `CompositeTransport.kind === 'sse'` fact.

#### Files to create / modify

- `CLAUDE.md`
- `AGENTS.md`

#### Agent prompt

````
You are a senior NestJS library author documenting @bymax-one/nest-realtime for AI agents.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS 11 (SSE default, WebSocket
opt-in) + React 19 frontend. Zero direct deps; three subpaths (`.`, `./shared`, `./react`); auth
inverted via `IConnectionAuthenticator`; multi-tenant via room conventions.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.4 of 10.

PRECONDITIONS
- Sibling templates exist at `../nest-auth/CLAUDE.md` and `../nest-auth/AGENTS.md` — structure only.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.2 (the canonical `CLAUDE.md` body — Critical Rules, Subpaths,
  Verification, Guidelines table — and the AGENTS.md expectations).
- `docs/technical_specification.md` § 1.6 "Design principles", § 3.1 "Directory tree" + § 3.2
  "Subpath exports", § 2.6 "Emit flow (any transport)", § 13 "Standard Event Catalog".
- `../nest-auth/CLAUDE.md` and `../nest-auth/AGENTS.md` — structural templates only.

TASK
Create `CLAUDE.md` and `AGENTS.md`, rewriting all content for realtime.

DELIVERABLES
- `CLAUDE.md`:
  - Header: type = npm public library; package `@bymax-one/nest-realtime`; Node 24+; zero direct deps.
  - Critical Rules:
    1. npm library — zero direct dependencies; everything is a peer dependency; three subpaths.
    2. Auth inversion — the library NEVER imports `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport-*`
       or any auth library in `src/`. The consumer plugs `IConnectionAuthenticator`; examples in docs.
    3. SSE first, WS opt-in — default transport is SSE; WS requires `transport: 'websocket' | 'both'`.
       The frontend `socket.io-client` is dynamic-imported — SSE-only bundle ≤ 4 KiB brotli.
    4. Multi-tenant via rooms — `user:{userId}`, `tenant:{tenantId}`, `resource:{type}:{id}`; the lib
       auto-joins `user:` and `tenant:` rooms on connect.
    5. Cross-instance — `IRealtimePubSub` for SSE scaling; `@socket.io/redis-adapter` for WS scaling.
    6. Reserved events — `connection:established`, `connection:reauthentication-failed`, `error`, and
       the reserved-but-not-yet-emitted `connection:credential-expiring` / `room:joined` / `room:left`.
       The SSE heartbeat is a `: keepalive` comment line, NOT a named/reserved event.
    7. TypeScript — zero `any`; use `unknown` where appropriate (e.g. `IRealtimePubSub` args).
    8. Build — tsup, three entries, `sideEffects: false`, all peer deps external.
  - Subpaths table (three rows).
  - "Verification — run before completing any task": `pnpm typecheck && pnpm lint && pnpm test &&
    pnpm build && pnpm size`; and a pre-release mutation note (`pnpm mutation`, target ≥ 95%).
  - A "Guidelines — load only what you need" table (NestJS / RxJS / Socket.IO / React / Testing / Infra).
- `AGENTS.md` (deeper — architectural decisions, patterns, testing patterns):
  - The dual-transport architecture and the `ITransport` abstraction (`kind` is `'sse' | 'websocket'`;
    `CompositeTransport.kind === 'sse'`, the dominant transport).
  - The cross-instance emit shape: the public `emit*` / `broadcast` / `disconnect` methods perform
    local delivery PLUS a single publish; the pub/sub subscriber re-emits through local-only paths
    (`emitToUserLocal` / `emitToTenantLocal` / `emitToRoomLocal` / `broadcastLocal` / `disconnectLocal`);
    cross-instance revocation flows through an `op: 'disconnect'` producer.
  - `maxConnectionsPerUser` is enforced by FIFO eviction (oldest connection closed with
    `REALTIME_TOO_MANY_CONNECTIONS`; the new connection is admitted), never by a 429.
  - Lifecycle hooks are fire-and-forget (never block the connection lifecycle).
  - Testing patterns (EventSource mock, socket.io-client, supertest for SSE).

Constraints:
- English only; timeless content — no roadmap/phase references in either file (doc-section links OK).
- Subpaths are exactly three; do not copy the five-subpath layout from nest-auth.
- Do not list `heartbeat` as a reserved/named event — it is a comment-line keepalive.

Verification:
- `ls CLAUDE.md AGENTS.md` — both present.
- `grep -qi 'auth inversion' CLAUDE.md` — match.
- `grep -c '`./react`' CLAUDE.md` — the three-subpath table is present.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.5 — Finalize CI — `release.yml` + scheduled cross-instance e2e (verify the Phase-1 workflows)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.16

#### Description

`ci.yml`, `codeql.yml`, `scorecard.yml`, and `.github/dependabot.yml` are created in **Phase 1 (Task 1.16)** and have gated every PR since the first one. This task adds the **release-time** workflows — a hardened, tag-driven `release.yml` and a scheduled `e2e-cross-instance.yml` — and re-verifies the full CI set against the real `dist/`. Least-privilege permissions everywhere.

#### Acceptance criteria

- [ ] The Phase-1 workflows (`ci.yml`, `codeql.yml`, `scorecard.yml`, `.github/dependabot.yml`) are present and green; re-verify `ci.yml` against the real build — `typecheck`, `lint`, `test:cov` (100% on implemented files), `build` (3 subpaths emit `.mjs`/`.cjs`/`.d.ts`), `size` (brotli budgets), `test:e2e -- --testPathIgnorePatterns=cross-instance`, `dependency-review`.
- [ ] `release.yml` exists and is valid YAML, triggered on tag `v*`: runs `pnpm prepublishOnly`, then publishes via `pnpm publish --provenance` using **OIDC trusted publishing** (no `NPM_TOKEN`), then creates a GitHub Release from the changelog; `permissions: { id-token: write, contents: write }` scoped to the publish job only.
- [ ] `release.yml` publish job is gated behind `environment: npm-publish` (manual approval) so an accidentally-pushed tag cannot auto-publish.
- [ ] `release.yml` has a **"verify tag matches `package.json` version"** step that exits non-zero on mismatch, before the publish step.
- [ ] `e2e-cross-instance.yml` runs the cross-instance suite on a daily schedule + `workflow_dispatch`, with a `redis:7-alpine` service container; `pnpm/action-setup@v6` + `version: 11.0.0`; `pnpm install --frozen-lockfile`.

#### Files to create / modify

- `.github/workflows/release.yml`
- `.github/workflows/e2e-cross-instance.yml`
- _(verify only — created in Phase 1 Task 1.16: `.github/workflows/ci.yml`, `codeql.yml`, `scorecard.yml`, `.github/dependabot.yml`)_

#### Agent prompt

````
You are a senior CI/CD engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — public npm library; dual-transport realtime for NestJS 11.
Bymax CI conventions: least-privilege permissions, concurrency, pinned actions, OIDC provenance
for publishing. pnpm@11.0.0, Node.js 24.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.5 of 10.

PRECONDITIONS
- The library builds and tests pass locally. `ci.yml`, `codeql.yml`, `scorecard.yml`, and
  `.github/dependabot.yml` were created in Phase 1 (Task 1.16) and are green on every PR.
- The cross-instance e2e suite (worker_threads + Redis) is flaky on the per-PR path and must run on
  a schedule instead.
- Sibling release workflow exists at `../nest-auth/.github/workflows/release.yml` as a template.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.3 "CI workflows — finalize" (release.yml + e2e-cross-instance; what is
  created here vs. in Phase 1).
- `docs/development_plan.md` § 1.7 "Global per-phase Done criteria" (the gate set `ci.yml` must run).
- `../nest-auth/.github/workflows/release.yml` — template only.

TASK
Create the release-time workflows (`release.yml`, `e2e-cross-instance.yml`) and re-verify the Phase-1
CI set (`ci.yml` / `codeql.yml` / `scorecard.yml`) is green against the real `dist/`.

DELIVERABLES
- Re-verify `.github/workflows/ci.yml` (from Phase 1) against the real build: `typecheck`, `lint`,
  `test:cov` (100% on implemented files), `build` (3 subpaths), `size` (brotli budgets),
  `test:e2e -- --testPathIgnorePatterns=cross-instance`, `dependency-review`. Confirm `codeql.yml` +
  `scorecard.yml` are green. Do NOT recreate them.
- `.github/workflows/release.yml` — on tag `v*`:
  - A step that verifies the tag matches `package.json` version and exits non-zero on mismatch, BEFORE publish.
  - Publish job gated behind `environment: npm-publish` (manual approval).
  - `pnpm prepublishOnly`, then `pnpm publish --provenance --no-git-checks` via OIDC trusted publishing
    (no `NPM_TOKEN`), then create a GitHub Release from the changelog.
  - Grant `id-token: write` + `contents: write` ONLY on the publish job (least privilege).
- `.github/workflows/e2e-cross-instance.yml`:

  ```yaml
  name: E2E Cross-Instance
  on:
    schedule:
      - cron: '0 6 * * *'   # daily
    workflow_dispatch:
  permissions:
    contents: read
  jobs:
    cross-instance:
      runs-on: ubuntu-latest
      timeout-minutes: 20
      services:
        redis:
          image: redis:7-alpine
          ports: ['6379:6379']
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
          with: { version: 11.0.0 }
        - uses: actions/setup-node@v4
          with: { node-version: 24, cache: pnpm }
        - run: pnpm install --frozen-lockfile
        - run: pnpm test:e2e -- --testPathPattern=cross-instance
          env: { REDIS_URL: redis://localhost:6379 }
  ```

Constraints:
- Least privilege: never grant `write` at the workflow level; a job widens scope only if it needs it.
- Pin every action to at least a major version tag.
- English only; timeless comments — no phase/task references in any YAML.

Verification:
- `yamllint .github/workflows/*.yml` (or `gh workflow view`) — valid YAML for all five.
- `grep -q 'testPathIgnorePatterns=cross-instance' .github/workflows/ci.yml` — match.
- `grep -q 'provenance' .github/workflows/release.yml` — match.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.6 — Mutation-testing plan + results + baseline run

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: M
- **Depends on**: 5.12

#### Description

Author `docs/mutation_testing_plan.md`, run the mutation-testing baseline, and record the scores in `docs/mutation_testing_results.md`. Thresholds follow the Bymax library standard (Stryker high 99 / low 95 / break 95), with critical realtime paths held to ≥ 95%.

#### Acceptance criteria

- [ ] `docs/mutation_testing_plan.md` and `docs/mutation_testing_results.md` both exist.
- [ ] The plan documents the Stryker thresholds (high 99 / low 95 / break 95), the run command (`pnpm mutation`, manual / pre-release — not per-commit in CI), the equivalent-mutant documentation convention (`// Stryker disable next-line <Mutator>: <reason>`), and the report path (`reports/mutation/mutation.html`).
- [ ] The plan lists the critical paths held to ≥ 95%: `connection-registry.service.ts`, `room-registry.service.ts`, `sse.transport.ts`, `event-replay-buffer.ts`, `event-id-generator.service.ts`, `encode-sse-event.ts`, `realtime-pubsub-subscriber.ts`, `composite.transport.ts`, `validate-options.ts`.
- [ ] `pnpm mutation` has been run; `reports/mutation/mutation.html` is generated.
- [ ] Global mutation score ≥ 95% and each critical path ≥ 95%; `docs/mutation_testing_results.md` records the timestamp and per-file scores.

#### Files to create / modify

- `docs/mutation_testing_plan.md`
- `docs/mutation_testing_results.md`

#### Agent prompt

````
You are a senior test/quality engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS 11. Quality floor: 100%
line/branch coverage per file; mutation testing is a pre-release gate.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.6 of 10.

PRECONDITIONS
- The full test suite is green and `stryker.config.json` exists (thresholds high 99 / low 95 /
  break 95 — the Bymax library standard, mirroring nest-logger). A sibling
  `../nest-auth/docs/mutation_testing_plan.md` exists as a template.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.4 "Mutation baseline" (the acceptance bullets and critical paths).
- `docs/development_plan.md` § 2 (phase header) — the "Critical paths for 95% coverage" list of files.
- `../nest-auth/docs/mutation_testing_plan.md` — template only.

TASK
1. Create `docs/mutation_testing_plan.md` adapted from the nest-auth template:
   - Strategy: Stryker thresholds high 99 / low 95 / break 95 (the Bymax library standard).
   - Justification: nest-realtime is the largest lib in the portfolio; document any genuinely
     equivalent mutants inline with `// Stryker disable next-line <Mutator>: <reason>` rather than
     lowering the bar.
   - Run command: `pnpm mutation` (manual, pre-release). NOT run per-commit in CI (cost ~15–25 min).
   - Reports at `reports/mutation/mutation.html` (+ `reports/stryker-incremental.json`).
   - Critical paths held to ≥ 95%: connection-registry.service.ts, room-registry.service.ts,
     sse.transport.ts, event-replay-buffer.ts, event-id-generator.service.ts, encode-sse-event.ts,
     realtime-pubsub-subscriber.ts (subscriber echo prevention), composite.transport.ts,
     validate-options.ts.
2. Run `pnpm mutation:dry-run && pnpm mutation` (timeout ~30 min). Save the report.
3. Create `docs/mutation_testing_results.md` with a `## v0.1.0 (<date>)` section: the global score
   and the per-critical-path scores (fill the TBDs from the real run).

Constraints:
- English only; timeless content. Any `// Stryker disable` comment states a real reason, never a
  phase/task reference.
- Do not lower thresholds below the library standard to make the gate pass — fix or justify instead.

Verification:
- `ls docs/mutation_testing_plan.md docs/mutation_testing_results.md reports/mutation/mutation.html`
  — all present.
- The recorded global score is ≥ 95% and each listed critical path is ≥ 95%.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.7 — `LICENSE` (MIT) + finalized `.npmignore`

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Add the MIT `LICENSE` and finalize `.npmignore` so the published tarball ships only the built artifacts and metadata.

#### Acceptance criteria

- [ ] `LICENSE` present (MIT, "Copyright (c) 2026 Bymax One").
- [ ] `.npmignore` excludes from publish: `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`, `*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`, ESLint/Prettier config, `scripts/`.
- [ ] `pnpm pack --dry-run` lists only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`.

#### Files to create / modify

- `LICENSE`
- `.npmignore`

#### Agent prompt

````
You are a senior npm release engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — public npm library. The published tarball must contain only the
built artifacts and metadata (no source, tests, or tooling).

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.7 of 10.

PRECONDITIONS
- A minimal `.npmignore` was created during the scaffold phase; refine it here.
- A sibling `../nest-auth/LICENSE` (MIT) exists as a template.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 3.1 "Directory tree" (what is source vs built output),
  § 16.3 "dependencies: {}" (zero direct deps — nothing extra ships).
- `docs/development_plan.md` § 1.9 "Expected end file structure".
- `../nest-auth/LICENSE` — template only.

TASK
1. Create `LICENSE` — MIT text, copyright "Copyright (c) 2026 Bymax One".
2. Finalize `.npmignore` — exclude `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`,
   `*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`, `.eslintrc*` / eslint config, `.prettierrc`,
   `scripts/`. Only `dist/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` stay in the tarball.
3. Run `pnpm pack --dry-run` and confirm the file list is only dist + metadata.

Constraints:
- English only; timeless content. No `.gitkeep` / placeholder files.

Verification:
- `ls LICENSE .npmignore` — present.
- `pnpm pack --dry-run` — the listed files are only `dist/**`, `package.json`, `README.md`, `LICENSE`,
  `CHANGELOG.md`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.8 — Final bundle-size budgets

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 5.12

#### Description

Measure the real brotli bundle sizes of all three subpaths and calibrate the budgets in `scripts/check-size.mjs` so they are tight (favoring bloat detection) without being over-permissive. Re-confirm `socket.io-client` is absent from the SSE-only static bundle.

#### Acceptance criteria

- [ ] `pnpm build && pnpm size` is green: server ≤ 18 KB brotli, `./shared` ≤ 3 KB brotli, `./react` SSE-only ≤ 4 KiB brotli.
- [ ] Budgets in `scripts/check-size.mjs` are calibrated to the measured values (tightened by ~10–15% where there is excessive headroom), not over-permissive.
- [ ] `grep -E "^import.*socket.io-client" dist/react/index.mjs` returns zero (dynamic import only).

#### Files to create / modify

- `scripts/check-size.mjs`

#### Agent prompt

````
You are a senior build/bundle engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — public npm library; three subpaths (`.`, `./shared`, `./react`).
The SSE-only frontend bundle must stay tiny; `socket.io-client` is loaded via dynamic import only.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.8 of 10.

PRECONDITIONS
- `scripts/check-size.mjs` exists (created during the scaffold phase) and `dist/` builds.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.5 "Bundle size validation" (the budget intent and the
  socket.io-client absence check).
- `docs/technical_specification.md` § 12.3 "Internal implementation — WebSocket (dynamic import)"
  (why socket.io-client must not be in the static SSE bundle), § 3.2 "Subpath exports".

TASK
Measure the real brotli sizes and calibrate the budgets.

DELIVERABLES
- Run `pnpm build && pnpm size`. Measure the real brotli size of each subpath.
  - If `server` > 18 KB brotli → investigate (likely a peer dep bundled in error — check tsup externals).
  - If `shared` > 3 KB brotli → investigate (should be ~2.5 KB of pure constants).
  - If `react` > 4 KiB brotli → investigate (likely socket.io-client got bundled — re-check the
    dynamic-import guard).
- If the actual values sit well under budget, TIGHTEN the budgets in `scripts/check-size.mjs` by
  ~10–15% (don't leave excessive headroom — tighter budgets catch future bloat).
- Re-confirm: `grep -E "^import.*socket.io-client" dist/react/index.mjs` returns nothing.

Constraints:
- All budgets are expressed in brotli (never gzip).
- English only; timeless comments in `scripts/check-size.mjs`.

Verification:
- `pnpm size` — green with the calibrated budgets.
- `grep -E "^import.*socket.io-client" dist/react/index.mjs` — no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.9 — Final pre-publish gate

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.1…6.8

#### Description

Run the complete local pipeline (simulating CI + release), bump the package version to `0.1.0`, and walk the final release checklist — including the auth-inversion structural audit and the `socket.io-client` static-bundle audit.

#### Acceptance criteria

- [ ] `pnpm prepublishOnly` (clean + typecheck + lint + coverage + build), `pnpm size`, and `pnpm mutation` all pass.
- [ ] `dist/` contains `server/index.{mjs,cjs,d.ts}`, `shared/index.{mjs,cjs,d.ts}`, and `react/index.{mjs,cjs,d.ts}`.
- [ ] `package.json` version is set to `0.1.0`; the `CHANGELOG.md` `0.1.0` entry has its date filled in.
- [ ] Bundle sizes within budget; mutation score ≥ 95%; `git status` clean.
- [ ] `/bymax-quality:code-review` run once more, findings applied.
- [ ] **Auth-inversion audit**: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/` returns **zero** — there must be NO reference to `JwtService` / `JwtPayload` / `@bymax-one/nest-auth` / `passport-*` in any file of `src/`.
- [ ] **socket.io-client audit**: `grep -E "^import.*socket\.io-client" dist/react/index.mjs` returns **zero**.

#### Files to create / modify

- `package.json` (version bump)
- `CHANGELOG.md` (fill the release date)

#### Agent prompt

````
You are a senior release engineer / code reviewer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — public npm library; dual-transport realtime for NestJS 11.
Auth inversion is a structural rule; the SSE-only static bundle must not contain socket.io-client.

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.9 of 10 (penultimate; this is the last gate before tagging).

PRECONDITIONS
- Tasks 6.1…6.8 are done: README, CHANGELOG, SECURITY, CLAUDE/AGENTS, CI workflows, mutation baseline,
  LICENSE/.npmignore, and the calibrated bundle budgets all exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 1.7 "Global per-phase Done criteria" and § 1.11 "Attention points"
  (the auth-inversion structural rule + the socket.io-client bundle check).
- `docs/development_plan.md` § 7.5 "Tag + publish" (what the gate prepares for).
- `docs/technical_specification.md` § 3.2 "Subpath exports" (the expected `dist/` layout).

TASK
Run the full pipeline locally (simulating CI + release) and walk the final checklist.

DELIVERABLES — run and confirm:

```bash
pnpm prepublishOnly   # = clean + typecheck + lint + test:cov:all + build
pnpm size
pnpm mutation         # final pre-release validation
```

Then the checklist:
- [ ] All commands pass.
- [ ] `dist/` contains `server/index.{mjs,cjs,d.ts}`, `shared/index.{mjs,cjs,d.ts}`,
      `react/index.{mjs,cjs,d.ts}`.
- [ ] `package.json` `"version"` set to `"0.1.0"`.
- [ ] `CHANGELOG.md` `0.1.0` entry has the release date filled in.
- [ ] Bundle sizes within budget; mutation score ≥ 95%.
- [ ] `git status` clean (all commits made).
- [ ] `/bymax-quality:code-review` run once more, findings applied.
- [ ] AUTH-INVERSION audit: `grep -rE "from '@bymax-one/nest-auth|from '@nestjs/jwt|from 'passport" src/`
      returns ZERO. (There must be NO reference to JwtService/JwtPayload/@bymax-one/nest-auth/passport-*
      in this file nor any other file of `src/`.)
- [ ] socket.io-client audit: `grep -E "^import.*socket\.io-client" dist/react/index.mjs` returns ZERO.

Constraints:
- Do not bypass any gate (no `--no-verify`, no `@ts-ignore`, no `eslint-disable`).
- English only; timeless content.

Verification:
- `pnpm prepublishOnly && pnpm size` — green.
- `node -e "process.exit(require('./package.json').version === '0.1.0' ? 0 : 1)"` — exit 0.
- Both audit greps above — no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 6.10 — Tag `v0.1.0` + npm publish `--provenance`

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.9

#### Description

Create the annotated `v0.1.0` tag, push it, and validate that `release.yml` publishes `@bymax-one/nest-realtime@0.1.0` to npm with provenance and creates the GitHub Release.

#### Acceptance criteria

- [ ] Tag `v0.1.0` created and pushed (`git push origin main --follow-tags`).
- [ ] The `release` workflow is green in GitHub Actions.
- [ ] The package is available at `https://www.npmjs.com/package/@bymax-one/nest-realtime` at version `0.1.0`.
- [ ] The "Provenance" badge appears on npm.
- [ ] A GitHub Release is created at `https://github.com/bymaxone/nest-realtime/releases`.

#### Files to create / modify

- (none — git tag + workflow-driven publish)

#### Agent prompt

````
You are a senior release engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — public npm library; dual-transport realtime for NestJS 11.
Publishing is workflow-driven: pushing a `v*` tag triggers `release.yml` (prepublishOnly →
`pnpm publish --provenance` → GitHub Release).

CURRENT PHASE: 6 (Release v0.1.0) — Task 6.10 of 10 (LAST).

PRECONDITIONS
- Task 6.9 passed: the full local pipeline is green, `package.json` version is `0.1.0`, the CHANGELOG
  date is filled, `git status` is clean, and `release.yml` exists.

REQUIRED READING (only these):
- `docs/development_plan.md` § 7.5 "Tag + publish" (the tag + publish flow and acceptance bullets).

TASK
Tag, push, and validate the release.

DELIVERABLES — run:

```bash
# Ensure main is clean and up to date
git status            # clean
git pull --ff-only origin main

# Create the annotated tag
git tag -a v0.1.0 -m "Release v0.1.0 — dual-transport SSE + WebSocket realtime for NestJS"

# Push commits + tag
git push origin main --follow-tags
```

`release.yml` fires on the `v*` tag and: (1) runs `pnpm prepublishOnly`; (2) runs
`pnpm publish --provenance`; (3) creates a GitHub Release from the changelog.

Validate:
- The `release` workflow is green in the GitHub Actions tab.
- `https://www.npmjs.com/package/@bymax-one/nest-realtime` shows `0.1.0`.
- The "Provenance" badge appears on npm.
- A GitHub Release exists at `https://github.com/bymaxone/nest-realtime/releases`.

If it fails: read the workflow logs, fix the root cause, then recreate the `v0.1.0` tag (deleting the
previous local + remote tag if needed) — only after confirming the root cause.

Constraints:
- Use `gh` for any GitHub API calls. English only; timeless commit/tag messages.

Verification:
- `gh release view v0.1.0` — exists.
- `gh api repos/bymaxone/nest-realtime/releases/tags/v0.1.0 --jq '.body'` — returns the changelog body.
- `npm view @bymax-one/nest-realtime version` — `0.1.0`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 6.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 6.1 ✅ 2026-06-30 — README.md with badges, 4 Quick-Start scenarios, auth-inversion section, infra notes
- 6.2 ✅ 2026-06-30 — CHANGELOG.md with Keep a Changelog format, v0.1.0 full feature set entry
- 6.3 ✅ 2026-06-30 — SECURITY.md: auth-inversion responsibility, CORS ownership, anti-IDOR, disclosure process
- 6.4 ✅ 2026-06-30 — CLAUDE.md + AGENTS.md: agent quick reference + architecture docs for realtime
- 6.5 ✅ 2026-06-30 — release.yml (OIDC, env gate, tag↔version guard) + e2e-cross-instance.yml (daily, Redis)
- 6.6 🟡 2026-06-30 — mutation baseline run: 81.99% (below 95% threshold); plan + results documented; needs test improvement before release
- 6.7 ✅ 2026-06-30 — LICENSE (MIT) + .npmignore finalized; pnpm pack confirms dist+README+LICENSE+CHANGELOG only
- 6.8 ✅ 2026-06-30 — Bundle budgets tightened: shared 3KB→0.6KB, react 4KB→2.2KB; pnpm size green
- 6.9 ✅ 2026-06-30 — Pre-publish gate green: typecheck+lint+test:cov(100%)+build+size+e2e pass; auth-inversion zero; static socket.io-client zero
