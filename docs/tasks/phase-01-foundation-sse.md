# Phase 1 — Foundation + SSE Transport

> **Status**: ✅ Done · **Progress**: 16 / 16 tasks · **Last updated**: 2026-06-27
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 2
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

This phase produces the **complete scaffold + a working SSE transport** for `@bymax-one/nest-realtime`. By the end, the library can be installed in a fixture NestJS app, a browser can open an `EventSource`, and a server-side call to `realtimeService.emitToUser(...)` reaches that browser.

It delivers, cumulatively:

- The three-subpath package skeleton — `.` (server), `./shared` (zero-dependency types & constants), `./react` (hooks/provider, still empty here) — with zero direct dependencies and every transport pulled in through peer deps.
- The public **contracts**: shared types, shared constants, and the seven server interfaces (`ITransport`, `IConnectionAuthenticator`, lifecycle hooks, pub/sub, offline-queue, presence, module options). This is where the **auth-inversion** rule first lands in code.
- The internal registries — `ConnectionRegistry`, `RoomRegistry`, `EventIdGenerator` — plus the SSE building blocks: `EventReplayBuffer`, `HeartbeatService`, and `SseTransport`.
- The glue: a dynamic `SseController` (via factory), `RealtimeService` as the unified public API, the default `InMemoryPubSub`, and `BymaxRealtimeModule.forRoot({ transport: 'sse' })`.

Files that bear the highest mutation focus at the pre-release gate are `connection-registry.service.ts`, `room-registry.service.ts`, `sse.transport.ts`, `event-replay-buffer.ts`, and `event-id-generator.service.ts`. Every file implemented in the phase carries **100% line/branch coverage** (the Bymax library standard).

---

## Rules-of-phase

1. **English-only & timeless comments.** All code, JSDoc, identifiers, and committed docs are English. No roadmap/phase/task references inside any committed file — a reference to a **doc section** (`spec §6.1`, `plan §2.6`) is allowed; a reference to a **plan stage** ("Phase 4") is not.
2. **No `.gitkeep` / `.keep` / empty-directory placeholders.** Directories emerge on demand when the first real file is written into them. Do not pre-create empty scaffolding; the only "structural" files are the three real barrels (`src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts`), which create their parent dirs naturally. `test/e2e/` is created when the first e2e spec lands.
3. **Auth-inversion structural rule (NEGATION).** There must be **NO** reference to `JwtService`, `JwtPayload`, `@bymax-one/nest-auth`, or `passport-*` in any file of `src/`. The only auth contract the library owns is `IConnectionAuthenticator`; consumers plug a concrete authenticator. A `@bymax-one/nest-auth` bridge may exist only as a docs/example, never in `src/`.
4. **Coverage & mutation.** `pnpm test:cov` enforces **100% line/branch coverage on every file implemented in the phase** (Bymax library standard — not 80%). Mutation testing (Stryker) is a pre-release gate with thresholds **high 99 / low 95 / break 95**.
5. **Zero direct dependencies.** `package.json` `"dependencies"` stays `{}`; every transport/runtime arrives via peer deps. `./shared` is strictly zero-dependency — no `@nestjs/*`, `rxjs`, or `socket.io` imports anywhere under `src/shared/`.
6. **TS strict, no `any`.** Use `unknown` where a value is genuinely arbitrary (e.g. `IRealtimePubSub.args`, `WebSocketOptions.redisAdapter.pubClient`). Use `import type` for type-only imports. Functions ≤ 50 lines, files ≤ 800.
7. **Heartbeat is a raw SSE comment.** The keepalive is a literal `: keepalive\n\n` comment written **directly to the response stream** by `HeartbeatService` on an interval. It is **not** a `MessageEvent`, **not** a named event, and lives **out of the event-id space** — so it never appears in the §13 reserved-event catalog and never corrupts `Last-Event-ID` replay.
8. **SSE emit path.** Each public `emitTo*`/`broadcast`/`disconnect` does **local delivery + a single publish**. Remote messages received from pub/sub dispatch to the **local-only** methods (`emitToUserLocal`, `emitToTenantLocal`, `emitToRoomLocal`, `broadcastLocal`, `disconnectLocal`) and are **never re-published** (which would A→B→A ping-pong). `disconnect` also publishes `op:'disconnect'` so the owning instance can close a connection it does not hold (cross-instance revocation).
9. **`ITransport.kind` is `'sse' | 'websocket'`.** `SseTransport.kind = 'sse' as const`. There is no `'both'` transport kind.
10. **`EventReplayBuffer` injects `REALTIME_OPTIONS_TOKEN`.** The cap is parenthesized: `const cap = this.opts.sse?.replayBufferSize ?? 100; if (buf.length > cap) buf.shift()` — never `buf.length > this.opts.sse?.replayBufferSize ?? 100` (which parses as `(buf.length > x) ?? 100` and leaves the buffer unbounded).
11. **DI tokens are `Symbol`s.** Explicit DI throughout; the eight injection tokens are unique `Symbol`s to avoid string collisions.
12. **`REALTIME_TOO_MANY_CONNECTIONS` is FIFO eviction, not a 429.** When a user exceeds `maxConnectionsPerUser`, evict the user's **oldest** connection (close it with `REALTIME_TOO_MANY_CONNECTIONS`) and admit the new one — never reject the new connection with HTTP 429.
13. **Toolchain & budgets.** `packageManager: "pnpm@11.0.0"`, `engines.node >= 24.0.0`. Bundle budgets are **brotli** (never gzip): server ≤ 18 KB, shared ≤ 3 KB, react ≤ 4 KiB.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 1.3 Why SSE default, § 1.6 Design principles (auth inversion), § 3 Package Structure (3.1 tree, 3.2/3.3 subpath exports), § 4 Configuration API (4.1 options, 4.3 forRoot SSE, 4.6 injection tokens), § 5 Contracts (5.1–5.6), § 6.1 `SseTransport`, § 7 Services (7.1 `RealtimeService`, 7.2 `ConnectionRegistry`, 7.3 `RoomRegistry`, 7.4 `EventReplayBuffer`), § 9.1 Room ID convention, § 10.1 `Last-Event-ID`, § 11.2 pub/sub flow, § 13 Event catalog, § 14 Error catalog, § 16 Dependencies.
- [`docs/development_plan.md`](../development_plan.md) — § 1.7 Global per-phase Done criteria, § 1.9 Expected end file structure, § 2 (Phase 1 detail: 2.1 scaffold, 2.2 shared, 2.3 interfaces, 2.4 DI tokens, 2.5 registries, 2.6 SSE transport, 2.7 `RealtimeService` + `InMemoryPubSub`, 2.8 `forRoot` + factory, 2.9 barrel + tests, 2.10 validation).
- `/bymax-workflow:standards` skill — universal coding rules (TypeScript track): strict types, layered architecture, typed errors, English-only/timeless comments, Conventional Commits.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 1.1 | Project scaffold — `package.json` + pnpm init | ✅ Done | P0 | S | — |
| 1.2 | `tsconfig` variants + `tsup` config (3 entries) | ✅ Done | P0 | M | 1.1 |
| 1.3 | ESLint + Prettier + `.gitignore` + `.npmignore` | ✅ Done | P1 | S | 1.1 |
| 1.4 | Jest configs (4 variants) + Stryker config | ✅ Done | P0 | M | 1.2 |
| 1.5 | `scripts/check-size.mjs` bundle-size gate | ✅ Done | P1 | S | 1.2 |
| 1.6 | Source layout barrels + build-output integrity | ✅ Done | P1 | S | 1.2 |
| 1.7 | Shared types (`TransportMode`, `RealtimeEvent`, `PublicConnectionMeta`) | ✅ Done | P0 | S | 1.6 |
| 1.8 | Shared constants (`ROOM_PREFIXES`, `RESERVED_EVENT_NAMES`, `REALTIME_ERROR_CODES`) + barrel | ✅ Done | P0 | S | 1.6 |
| 1.9 | Server interfaces (7 contracts) + barrel | ✅ Done | P0 | L | 1.7, 1.8 |
| 1.10 | DI tokens (Symbol) + `composeRoomId` utility | ✅ Done | P0 | S | 1.6, 1.8 |
| 1.11 | Internal services — `EventIdGenerator` + `ConnectionRegistry` + `RoomRegistry` | ✅ Done | P0 | L | 1.9, 1.10 |
| 1.12 | SSE core — `EventReplayBuffer` + `HeartbeatService` + `SseTransport` | ✅ Done | P0 | L | 1.11 |
| 1.13 | `SseController` + factory + `RealtimeService` + `InMemoryPubSub` + `forRoot` | ✅ Done | P0 | L | 1.9, 1.10, 1.11, 1.12 |
| 1.14 | Unit specs — registries, id-gen, replay, transport, service, pubsub | ✅ Done | P0 | L | 1.11, 1.12, 1.13 |
| 1.15 | Phase validation + barrel + integration smoke | ✅ Done | P0 | M | 1.1…1.14 |
| 1.16 | CI skeleton — `ci.yml` + `codeql.yml` + `scorecard.yml` + `.github/dependabot.yml` (green on the scaffold) | ✅ Done | P0 | M | 1.3, 1.4, 1.5, 1.6 |

---

## Tasks

### Task 1.1 — Project scaffold: `package.json` + pnpm init

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

Initialize `package.json` under the `@bymax-one` scope with the canonical scripts, the required peer deps (`@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`) and the optional peer deps (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@socket.io/redis-adapter`, `ioredis`, `react`, `react-dom`, `socket.io-client`), and `"dependencies": {}` (zero direct deps).

#### Acceptance criteria

- [ ] `package.json` created with all required fields.
- [ ] `pnpm install` completes with no errors and no missing-required-peer warnings (warnings about omitted optionals are acceptable).
- [ ] `pnpm-lock.yaml` is generated.
- [ ] `node_modules/` is populated with the required peers installed as devDeps.

#### Files to create / modify

- `package.json`

#### Agent prompt

````
You are a senior NestJS package/release engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — a NestJS real-time library with dual transport
(SSE default, WebSocket opt-in), published to npm with three subpaths: `.` (server),
`./shared` (zero-dependency types & constants), `./react` (hooks/provider). It carries
ZERO direct dependencies; every transport/runtime arrives via peer deps. The library
NEVER imports a concrete auth library — auth is inverted behind `IConnectionAuthenticator`.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.1 of 16 (FIRST)

PRECONDITIONS
- The repo contains only `docs/` (technical_specification.md, development_plan.md, tasks/). No source code yet.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.1 "Project scaffold" — the complete `package.json` block for this phase.
- `docs/technical_specification.md` § 16 "Dependencies" (16.1 required peers, 16.2 optional peers, 16.3 `"dependencies": {}`).

TASK
Create the repo-root `package.json` exactly per the block in `docs/development_plan.md` § 2.1.

DELIVERABLES
Create `package.json` with these critical fields:
- `"name": "@bymax-one/nest-realtime"`, `"version": "0.1.0-alpha.0"`.
- `"type": "module"`, `"sideEffects": false`.
- `"files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"]`.
- `"exports"` with 3 subpaths: `.`, `./shared`, `./react` (each with `types`/`import`/`require`).
- `"dependencies": {}` (zero direct deps).
- `"peerDependencies"` with 12 entries (4 required + 8 optional).
- `"peerDependenciesMeta"` marking all 8 optional as `{ "optional": true }`:
  `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@socket.io/redis-adapter`,
  `ioredis`, `react`, `react-dom`, `socket.io-client`.
- `"devDependencies"`: NestJS 11.x (common/core) + platform-express + platform-socket.io +
  websockets + testing, jest 30 + jest-environment-jsdom, ts-jest 29, stryker 9 (jest-runner +
  typescript-checker), tsup 8.5, typescript 5.9, eslint 9 + react-hooks plugin, prettier 3.8,
  `socket.io`, `socket.io-client`, `@socket.io/redis-adapter`, `ioredis`, `ioredis-mock`,
  `@testing-library/react`, `supertest`, `eventsource`.
- `"scripts"`: build (tsup), lint, test, test:cov, test:e2e, test:cov:all, mutation,
  mutation:incremental, mutation:dry-run, typecheck, size, clean, prepublishOnly, release.
- `"packageManager": "pnpm@11.0.0"`, `"engines": { "node": ">=24.0.0" }`.
- `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`.

After creating it, run `pnpm install` at the repo root. Confirm `pnpm-lock.yaml` is generated and
there are NO warnings about missing REQUIRED peers (warnings about omitted optionals are OK).

Constraints:
- `"dependencies"` MUST stay `{}` — zero direct deps.
- English-only, timeless content — no roadmap/phase references anywhere.

Verification:
- `pnpm install` — expected: completes; no missing-required-peer warnings.
- `node -e "console.log(require('./package.json').name)"` — expected: `@bymax-one/nest-realtime`.
- `node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies).length)"` — expected: `0`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.2 — `tsconfig` variants + `tsup` config (3 entries)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1

#### Description

Create `tsconfig.json` plus four variants (build/server/e2e/jest) and `tsup.config.ts` with three entries (`server`, `shared`, `react`). Also create the three real barrel placeholders.

#### Acceptance criteria

- [ ] All 5 `tsconfig.*.json` present; the path aliases cover the 3 subpaths correctly.
- [ ] `tsup.config.ts` has 3 entries — server (node24), shared (node24, no NestJS externals — zero deps), react (es2022, `platform: 'neutral'`).
- [ ] `socket.io-client` is listed in `external` for the React entry (must stay external to keep the SSE-only base bundle minimal).
- [ ] `pnpm typecheck` passes on the three placeholders.

#### Files to create / modify

- `tsconfig.json`, `tsconfig.build.json`, `tsconfig.server.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`
- `tsup.config.ts`
- `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts` (each `export {}`)

#### Agent prompt

````
You are a senior NestJS package/build engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport (SSE default,
WS opt-in), 3 npm subpaths (`.`, `./shared`, `./react`), zero direct deps, auth inverted
behind `IConnectionAuthenticator`.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.2 of 16

PRECONDITIONS
- Task 1.1 is done: `package.json` exists, `pnpm install` works.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.1 — the config table to mirror and the complete `tsup.config.ts` block.
- `docs/technical_specification.md` § 3.2 "Subpath exports" (the 3 subpaths and their entry points).
- Reference files to copy and adapt (the sibling lib — copy ONLY these specific files):
  - `../nest-auth/tsconfig.json`
  - `../nest-auth/tsconfig.build.json`
  - `../nest-auth/tsconfig.server.json`
  - `../nest-auth/tsconfig.e2e.json`
  - `../nest-auth/tsconfig.jest.json`

TASK
1. Copy the 5 `tsconfig.*.json` files from `../nest-auth/` into the repo root and adapt the path
   aliases in `tsconfig.json` to the 3 subpaths (drop nest-auth's `/client` and `/nextjs`):

   ```jsonc
   "paths": {
     "@bymax-one/nest-realtime":        ["./src/server/index.ts"],
     "@bymax-one/nest-realtime/shared": ["./src/shared/index.ts"],
     "@bymax-one/nest-realtime/react":  ["./src/react/index.ts"]
   }
   ```

2. Create `tsup.config.ts` with 3 entries exactly per the block in `docs/development_plan.md` § 2.1.
   Shared externals: `/^@nestjs\//`, `reflect-metadata`, `rxjs`, `socket.io`,
   `@socket.io/redis-adapter`, `ioredis`, `react`, `react-dom`, and **`socket.io-client`**
   (CRITICAL — it must stay external in the React entry to guarantee the minimal SSE-only bundle).
   The React entry uses `platform: 'neutral'` and `target: 'es2022'` (the other two use `node24`).
   The `shared` entry has NO NestJS externals because it imports nothing from NestJS (zero deps).

3. Create the placeholders `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts`, each
   containing only `export {}`.

Constraints:
- Exactly 3 subpaths (not 5). `socket.io-client` external in the React entry is non-negotiable.
- English-only, timeless comments — no roadmap/phase references.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `pnpm typecheck` — expected: passes on the three placeholders.
- `grep -q "socket.io-client" tsup.config.ts` — expected: match (kept external).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.3 — ESLint + Prettier + `.gitignore` + `.npmignore`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.1

#### Description

Lint and format configs mirroring the sibling lib, with a React-specific override that enables `eslint-plugin-react-hooks`, plus a `shared/` override forbidding any `@nestjs/*` or `rxjs` import (zero-dep boundary).

#### Acceptance criteria

- [ ] `eslint.config.mjs` adapted with 2 overrides (React hooks + `shared/` zero-deps boundary).
- [ ] `.prettierrc` identical to the sibling lib.
- [ ] `.gitignore` covers `node_modules`, `dist`, `coverage`, `reports`, `.stryker-tmp`.
- [ ] `.npmignore` created.
- [ ] `pnpm lint` passes.

#### Files to create / modify

- `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.npmignore`

#### Agent prompt

````
You are a senior NestJS tooling engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps, auth inverted behind `IConnectionAuthenticator`. `./shared` is strictly zero-dep.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.3 of 16

PRECONDITIONS
- Task 1.1 is done: `package.json` exists with the eslint/prettier devDeps.

REQUIRED READING (only these sections — do not load more):
- `../nest-auth/eslint.config.mjs` (flat config, ESLint v9).
- `../nest-auth/.prettierrc`.
- `../nest-auth/.gitignore`.
- `docs/development_plan.md` § 2.1 (the line describing the React override).

TASK
Copy `eslint.config.mjs`, `.prettierrc`, and `.gitignore` from the sibling lib, then adapt eslint:
- Remove rules specific to folders nest-realtime does NOT have (`oauth/`, `crypto/`, `nextjs/`).
- Keep `@typescript-eslint/no-explicit-any` (error).
- Keep `eslint-plugin-security` (recommended).
- Keep `eslint-plugin-import` (order, no-cycle).
- Keep `eslint-config-prettier` last.
- Add an override for `files: ['src/react/**/*.ts', 'src/react/**/*.tsx']` enabling
  `eslint-plugin-react-hooks` rules `rules-of-hooks` and `exhaustive-deps`.
- Add an override for `files: ['src/shared/**/*.ts']` forbidding any import from `@nestjs/*` or
  `rxjs` (the shared subpath is zero-dependency).

Create `.npmignore` excluding: `src/`, `test/`, `docs/`, `coverage/`, `reports/`, `.github/`,
`*.config.ts`, `tsconfig.*.json`, `.stryker-tmp/`, `.eslintrc*`, `.prettierrc`.

Verify `pnpm lint` passes on the empty placeholders.

Constraints:
- English-only, timeless comments.
- Do NOT create `.gitkeep` or empty-directory placeholders.

Verification:
- `pnpm lint` — expected: passes with zero warnings.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.4 — Jest configs (4 variants) + Stryker config

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.2

#### Description

Create `jest.config.ts` (fast dev runner), `jest.coverage.config.ts` (the 100%-per-file library gate), `jest.e2e.config.ts` (15 s timeout for long-lived SSE), `jest.stryker.config.ts`, and `stryker.config.json`. Mutation thresholds: high 99, low 95, break 95.

#### Acceptance criteria

- [ ] 5 config files created with the adaptations below.
- [ ] `pnpm test` runs (`--passWithNoTests` on an empty suite is fine).
- [ ] `pnpm test:cov` runs without errors; the coverage gate is **100% line/branch on every implemented file**.
- [ ] `pnpm mutation:dry-run` validates the Stryker config without running mutants.

#### Files to create / modify

- `jest.config.ts`, `jest.coverage.config.ts`, `jest.e2e.config.ts`, `jest.stryker.config.ts`, `stryker.config.json`

#### Agent prompt

````
You are a senior NestJS test-infrastructure engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps. Bymax library standard: 100% line/branch coverage per implemented file.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.4 of 16

PRECONDITIONS
- Task 1.2 is done: tsconfig variants + tsup config + the 3 placeholders exist; `pnpm typecheck` passes.

REQUIRED READING (only these sections — do not load more):
- `../nest-auth/jest.config.ts`
- `../nest-auth/jest.coverage.config.ts`
- `../nest-auth/jest.e2e.config.ts`
- `../nest-auth/jest.stryker.config.ts`
- `../nest-auth/stryker.config.json`
- `docs/development_plan.md` § 2.1 (per-subpath adaptations) and § 1.7 (the coverage & mutation standard).

TASK
Copy the 5 Jest/Stryker files from the sibling lib and apply these adaptations:

In `jest.config.ts` (fast dev runner):
- `moduleNameMapper` — 3 entries (not 5):
  ```typescript
  '^@bymax-one/nest-realtime$':        '<rootDir>/server/index.ts',
  '^@bymax-one/nest-realtime/shared$': '<rootDir>/shared/index.ts',
  '^@bymax-one/nest-realtime/react$':  '<rootDir>/react/index.ts',
  ```
- Cap the worker pool: `maxWorkers: '50%'` (memory safety for the local sibling dep).
- `passWithNoTests: true` so the runner is green before any spec exists.

In `jest.coverage.config.ts` (the release gate):
- Same 3-entry `moduleNameMapper`.
- `coverageThreshold` = 100% statements/branches/functions/lines — the Bymax library standard,
  enforced on every implemented file (`collectCoverageFrom` targets `src/**/*.ts`, excluding
  barrels and `*.spec.ts`).

In `jest.e2e.config.ts`:
- `rootDir: '<rootDir>/test/e2e'`.
- `testTimeout: 15_000` (SSE keepalive cycles can exceed 5 s).

In `stryker.config.json`: thresholds `high: 99, low: 95, break: 95`. Keep the `jest-runner` and
`typescript-checker` plugins; point the runner at `jest.stryker.config.ts`.

Constraints:
- 100% per-file coverage is the gate — do NOT lower it to 80%.
- English-only, timeless comments.

Verification:
- `pnpm test` — expected: runs (passes with no tests).
- `pnpm test:cov` — expected: runs (no failures on an empty suite).
- `pnpm mutation:dry-run` — expected: validates the config without running mutants.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.5 — `scripts/check-size.mjs` bundle-size gate

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.2

#### Description

A native Node script (zero deps) that validates the brotli size of each subpath bundle and fails when a budget is exceeded, plus a special check that `socket.io-client` is never statically present in the React bundle.

#### Acceptance criteria

- [ ] `scripts/check-size.mjs` created.
- [ ] Runs via `pnpm size` (after a build) and reports the 3 subpaths.
- [ ] Exits 1 when any subpath exceeds its brotli budget.
- [ ] Fails if `socket.io-client` appears statically in `dist/react/index.mjs`.

#### Files to create / modify

- `scripts/check-size.mjs`

#### Agent prompt

````
You are a senior NestJS build/perf engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, 3 npm subpaths. The React subpath
is the SSE-only base bundle: `socket.io-client` is loaded by dynamic import only, never bundled.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.5 of 16

PRECONDITIONS
- Task 1.2 is done: tsup builds 3 entries to `dist/{server,shared,react}/index.mjs`.

REQUIRED READING (only these sections — do not load more):
- `../nest-auth/scripts/check-size.mjs`.
- `docs/development_plan.md` § 2.1 (the bundle-budget line).
- `docs/technical_specification.md` § 3.2 (subpath exports — what each bundle contains).

TASK
Copy `scripts/check-size.mjs` from the sibling lib and adapt the `BUDGETS` constant to 3 entries
(budgets are BROTLI bytes, never gzip):

```javascript
const BUDGETS = [
  { name: 'server (NestJS module + transports)',     path: 'dist/server/index.mjs', brotli: 18_000 },
  { name: 'shared (types + constants)',              path: 'dist/shared/index.mjs', brotli: 3_000 },
  { name: 'react (hooks + provider, SSE-only base)', path: 'dist/react/index.mjs',  brotli: 4_000 },
]
```

Rationale: server bundles the SSE controller/transport + WS gateway (WS externalized) + composite +
registries + reference pub/sub ≈ 15–17 KB brotli; shared is types + constants only (~2.5 KB); react
is SSE-only (socket.io-client dynamically imported, not bundled) ~3.5 KB.

Keep `node:zlib` (brotli, max quality), `node:fs`, `node:url`, `node:path` only — ZERO external deps.

Additional: add a check for the React entry — fail if `socket.io-client` appears statically in
`dist/react/index.mjs` (it must be a dynamic import only). Document this check in the script header.

Constraints:
- Zero external deps; budgets are brotli.
- English-only, timeless comments — the header documents the static-import check without phase references.

Verification:
- After a build: `pnpm build && pnpm size` — expected: reports the 3 subpaths; exit 0 when within budget.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.6 — Source layout barrels + build-output integrity

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.2

#### Description

Confirm the three real barrel placeholders exist (creating their parent dirs naturally) and validate the tsup 3-entry config end-to-end: an empty source tree must still build to `dist/{server,shared,react}/index.{mjs,cjs,d.ts}`. No empty-directory scaffolding and no `.gitkeep` — every other directory (`services/`, `transports/`, `interfaces/`, …) emerges when its first real file is written in later tasks.

#### Acceptance criteria

- [ ] `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts` exist, each `export {}`.
- [ ] No `.gitkeep`/`.keep` files and no empty-directory placeholders anywhere in the repo.
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}`, `dist/shared/index.{mjs,cjs,d.ts}`, and `dist/react/index.{mjs,cjs,d.ts}`.

#### Files to create / modify

- `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts` (ensure present)

#### Agent prompt

````
You are a senior NestJS package/build engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, 3 npm subpaths (`.`, `./shared`,
`./react`), zero direct deps.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.6 of 16

PRECONDITIONS
- Task 1.2 is done: tsup config + the 3 `export {}` placeholders exist.

REQUIRED READING (only these sections — do not load more):
- `docs/technical_specification.md` § 3.1 "Directory tree" (the canonical layout — reference only;
  do NOT pre-create empty folders).
- `docs/development_plan.md` § 1.9 "Expected end file structure".

TASK
This is a build-output integrity checkpoint, NOT a scaffolding task.

1. Ensure the three real barrels exist and contain only `export {}`:
   `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts`.
   These three files are the ONLY structural files — they create their parent dirs naturally.
2. Do NOT create any `.gitkeep`/`.keep` file and do NOT pre-create empty directories
   (`services/`, `transports/`, `interfaces/`, `constants/`, `utils/`, `pubsub/`, `factories/`,
   `hooks/`, `providers/`, …). Each emerges on demand when its first real file lands in a later task.
   `test/e2e/` is created only when the first e2e spec is written.
3. Run `pnpm build` and confirm the empty source tree still produces all three subpath outputs —
   this validates the tsup 3-entry config end-to-end.

Constraints:
- ZERO `.gitkeep` / empty-directory placeholders. Directory structure emerges from real content.
- English-only, timeless comments.

Verification:
- `find . -name .gitkeep -o -name .keep` — expected: no output.
- `pnpm build && ls dist/server dist/shared dist/react` — expected: each has `index.mjs`, `index.cjs`, `index.d.ts`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.7 — Shared types (`TransportMode`, `RealtimeEvent`, `PublicConnectionMeta`)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6

#### Description

Define the three public types under `src/shared/types/`. The shared subpath is zero-dependency — no `@nestjs/*`, `rxjs`, or `socket.io` imports.

#### Acceptance criteria

- [ ] 3 type files created with complete JSDoc.
- [ ] Zero `any` (verified by grep).
- [ ] Zero imports of `@nestjs/*` or `rxjs` (verified by grep).
- [ ] `import type` used for any cross-file type import.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/shared/types/transport-mode.type.ts`
- `src/shared/types/realtime-event.type.ts`
- `src/shared/types/connection-meta.type.ts`

#### Agent prompt

````
You are a senior TypeScript/NestJS reviewer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, 3 npm subpaths. The `./shared`
subpath is strictly ZERO-dependency — types & constants only, no runtime imports.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.7 of 16

PRECONDITIONS
- Task 1.6 is done: the source layout and `src/shared/index.ts` barrel exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.2 "Shared types and constants" (the complete type skeletons).
- `docs/technical_specification.md` § 3.3 "Exports per subpath" (what `./shared` exposes).
- `docs/technical_specification.md` § 1.3 "Why SSE as the default" (for the `TransportMode` JSDoc rationale).

TASK
Create the 3 files per the skeletons in `docs/development_plan.md` § 2.2:

1. `src/shared/types/transport-mode.type.ts` — `export type TransportMode = 'sse' | 'websocket' | 'both'`
   with complete JSDoc + `@example`. Note: `TransportMode` is the CONFIG-level mode chosen by the
   consumer; it is distinct from `ITransport.kind` (`'sse' | 'websocket'`).
2. `src/shared/types/realtime-event.type.ts` —
   `export interface RealtimeEvent<TData = unknown> { readonly id: string; readonly type: string; readonly data: TData }`
   with JSDoc explaining the mapped-type pattern a consumer can layer on top.
3. `src/shared/types/connection-meta.type.ts` —
   `export interface PublicConnectionMeta { readonly connectionId: string; readonly userId: string;
   readonly tenantId?: string; readonly transport: 'sse' | 'websocket'; readonly connectedAt: Date }`
   with JSDoc explaining why it does NOT expose the per-connection `Subject` (kept private in the server runtime).

Apply strict rules:
- `readonly` on properties where appropriate.
- JSDoc with `@example` on `TransportMode` and `RealtimeEvent`.
- `import type` for any cross-file type import.
- NO `any` in any signature — use `unknown` where needed (the `TData` default).
- NO import from `@nestjs/*`, `rxjs`, or `socket.io` — `./shared` is zero-dep.
- English in all code and JSDoc.

Constraints:
- Zero-dep boundary; no `any`. Functions/types small and single-responsibility.
- English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rnE ': any\b|any\[\]' src/shared/` — expected: no output.
- `grep -rnE "from '@nestjs|from 'rxjs|from 'socket.io" src/shared/` — expected: no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.8 — Shared constants (`ROOM_PREFIXES`, `RESERVED_EVENT_NAMES`, `REALTIME_ERROR_CODES`) + barrel

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6

#### Description

Three public constants under `src/shared/constants/` plus the `src/shared/index.ts` barrel.

#### Acceptance criteria

- [ ] 3 constant files created.
- [ ] All exported `as const`.
- [ ] Types derived via `(typeof X)[keyof typeof X]`.
- [ ] `src/shared/index.ts` updated with 3 runtime exports + the corresponding type exports.
- [ ] `pnpm build` produces `dist/shared/index.{mjs,cjs,d.ts}` listing all runtime exports.

#### Files to create / modify

- `src/shared/constants/room-prefixes.constants.ts`
- `src/shared/constants/reserved-events.constants.ts`
- `src/shared/constants/error-codes.constants.ts`
- `src/shared/index.ts`

#### Agent prompt

````
You are a senior TypeScript/NestJS reviewer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, 3 npm subpaths. `./shared` is
strictly zero-dependency.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.8 of 16

PRECONDITIONS
- Task 1.6 is done: the source layout and `src/shared/index.ts` barrel exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.2 (constant skeletons + the barrel).
- `docs/technical_specification.md` § 13 "Standard Event Catalog".
- `docs/technical_specification.md` § 14 "Error Code Catalog".
- `docs/technical_specification.md` § 9.1 "Room ID convention".

TASK
Create:

1. `src/shared/constants/room-prefixes.constants.ts` —
   `export const ROOM_PREFIXES = { USER: 'user', TENANT: 'tenant', RESOURCE: 'resource' } as const`
   and `export type RoomPrefix = (typeof ROOM_PREFIXES)[keyof typeof ROOM_PREFIXES]`. JSDoc explains
   the convention (`user:{id}`, `tenant:{id}`, `resource:{type}:{id}`) and that changing a prefix is
   a breaking change.

2. `src/shared/constants/reserved-events.constants.ts` —
   `export const RESERVED_EVENT_NAMES` with these keys:
   `CONNECTION_ESTABLISHED: 'connection:established'`,
   `CONNECTION_REAUTH_FAILED: 'connection:reauthentication-failed'`,
   `CONNECTION_CREDENTIAL_EXPIRING: 'connection:credential-expiring'`,
   `ROOM_JOINED: 'room:joined'`, `ROOM_LEFT: 'room:left'`, `ERROR: 'error'`.
   Export `type ReservedEventName`. IMPORTANT: do NOT add a `HEARTBEAT` key — the SSE heartbeat is a
   raw `: keepalive` comment written to the response stream, not a named event (spec §13), so it is
   NOT part of the reserved-event catalog.

3. `src/shared/constants/error-codes.constants.ts` —
   `export const REALTIME_ERROR_CODES` with 9 keys, each value `REALTIME_<KEY>`:
   `INVALID_OPTIONS`, `NO_AUTHENTICATOR`, `AUTH_FAILED`, `REAUTHENTICATION_FAILED`,
   `TOO_MANY_CONNECTIONS`, `INVALID_TICKET`, `PUBSUB_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`,
   `REPLAY_BUFFER_MISS`. Export `type RealtimeErrorCode`. In the JSDoc for `TOO_MANY_CONNECTIONS`,
   state that it signals FIFO eviction per spec §14: when a user exceeds `maxConnectionsPerUser`,
   the OLDEST connection is evicted (closed with this code) and the new one is admitted — it is
   never an HTTP 429 rejection.

4. Update `src/shared/index.ts` per the barrel skeleton in § 2.2 (3 runtime `export {}` for the
   constants + `export type {}` for `RoomPrefix`, `ReservedEventName`, `RealtimeErrorCode`, plus the
   types from Task 1.7).

Constraints:
- Everything `as const`; types derived via `(typeof X)[keyof typeof X]`.
- Zero-dep boundary; no `any`; English-only, timeless comments.

Verification:
- `pnpm build` then
  `node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m).sort()))"`
  — expected: `['REALTIME_ERROR_CODES', 'RESERVED_EVENT_NAMES', 'ROOM_PREFIXES']`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.9 — Server interfaces (7 contracts) + barrel

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.7, 1.8

#### Description

Define all 7 public interfaces + module options + the barrel under `src/server/interfaces/`. This is the central contract task — it is where the auth-inversion rule first manifests in code.

#### Acceptance criteria

- [ ] 7 interface files + an `index.ts` barrel.
- [ ] Every field documented via JSDoc, with `@example` on `ITransport` and `IConnectionAuthenticator`.
- [ ] `import type` used for all external type imports.
- [ ] Zero `any` (verified by grep).
- [ ] Zero imports of `ioredis` in `src/server/interfaces/`.
- [ ] Zero references to `@nestjs/jwt`, `passport-*`, or `@bymax-one/nest-auth` anywhere in `src/`.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/interfaces/transport.interface.ts`
- `src/server/interfaces/connection-authenticator.interface.ts`
- `src/server/interfaces/connection-lifecycle-hooks.interface.ts`
- `src/server/interfaces/realtime-pubsub.interface.ts`
- `src/server/interfaces/offline-queue-storage.interface.ts`
- `src/server/interfaces/presence-storage.interface.ts`
- `src/server/interfaces/realtime-module-options.interface.ts`
- `src/server/interfaces/index.ts`

#### Agent prompt

````
You are a senior TypeScript/NestJS reviewer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps. CRITICAL design principle — AUTH INVERSION: the library NEVER imports a concrete
auth library; the only auth contract it owns is `IConnectionAuthenticator`, which the consumer plugs.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.9 of 16

PRECONDITIONS
- Tasks 1.7–1.8 are done: shared types and constants exist; `src/shared/index.ts` exports them.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.3 "Interfaces and contracts" (the complete skeletons for all 7).
- `docs/technical_specification.md` § 5 "Contracts" (5.1 ITransport, 5.2 IConnectionAuthenticator,
  5.3 lifecycle hooks, 5.4 IRealtimePubSub, 5.5 IOfflineQueueStorage, 5.6 IPresenceStorage).
- `docs/technical_specification.md` § 4.1 "BymaxRealtimeModuleOptions interface".
- `docs/technical_specification.md` § 1.6 "Design principles" (the auth-inversion principle).

TASK
Create the 8 files in `src/server/interfaces/` (7 interfaces + index barrel) per § 2.3:

1. `transport.interface.ts` — `ITransport` with `readonly kind: 'sse' | 'websocket'`, `emitToUser`,
   `emitToTenant`, `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, `disconnect`,
   `onModuleInit?`, `onApplicationShutdown?`. Full JSDoc + `@example` for a custom transport.
2. `connection-authenticator.interface.ts` — 3 types:
   `ConnectionAuthContext { cookies, headers, query, ip, userAgent, transport }`,
   `AuthenticationResult { userId, tenantId?, roles?, metadata? }`,
   `IConnectionAuthenticator { authenticate(ctx), revalidate?(connectionId, originalAuth) }`.
   Highlight the AUTH-INVERSION comment: the library never imports a concrete auth library;
   reference spec § 1.6.
3. `connection-lifecycle-hooks.interface.ts` —
   `ConnectionEventMeta { connectionId, userId, tenantId?, transport, ip, userAgent?, connectedAt }`
   + `IConnectionLifecycleHooks { onConnect?, onDisconnect?, onError?, onReauthenticationFailed? }`,
   each hook returning `void | Promise<void>`.
4. `realtime-pubsub.interface.ts` — `RealtimePubSubMessage { op, args, origin }`
   + `IRealtimePubSub { publish, subscribe }` where `subscribe` returns an unsubscribe handle.
   JSDoc mentions the default `InMemoryPubSub` and the reference `RedisRealtimePubSub`.
   `args` is typed `unknown` (the per-op shape is narrowed at the call site).
5. `offline-queue-storage.interface.ts` —
   `OfflineQueuedEvent { id, event, data, emittedAt }`
   + `IOfflineQueueStorage { append, retrieveSince, acknowledge }`. JSDoc explains per-user retention.
6. `presence-storage.interface.ts` —
   `IPresenceStorage { setOnline, setOffline, isOnline, listOnlineByTenant, countOnline }`. JSDoc marks it optional.
7. `realtime-module-options.interface.ts` — `CorsConfig`, `SseOptions`, `WebSocketOptions`,
   `ReauthenticationPolicy`, `BymaxRealtimeModuleOptions` (all fields from spec § 4.1),
   `BymaxRealtimeModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'>`,
   `BymaxRealtimeModuleOptionsFactory`. CRITICAL: `WebSocketOptions.redisAdapter.pubClient: unknown`
   (do NOT import `ioredis` here).
8. `index.ts` — barrel re-exporting all types via `export type { ... }`.

NO `any` in any signature — use `unknown` where the type is genuinely arbitrary
(`IRealtimePubSub.args`, `WebSocketOptions.redisAdapter.pubClient`).

AUTH-INVERSION CHECK (structural rule): `connection-authenticator.interface.ts` is the only allowed
auth contract. There must be NO reference to `JwtService`, `JwtPayload`, `@bymax-one/nest-auth`, or
`passport-*` in this file nor any other file of `src/`.

Constraints:
- `import type` for all external type imports; zero `any`; zero `ioredis` import here.
- English-only, timeless comments. Functions/types single-responsibility; files ≤ 800 lines.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -rnE ': any\b|any\[\]' src/server/interfaces/` — expected: no output.
- `grep -rnE "from 'ioredis" src/server/interfaces/` — expected: no output.
- `grep -rnE "@nestjs/jwt|from 'passport|@bymax-one/nest-auth|JwtPayload|JwtService" src/` — expected: no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.10 — DI tokens (Symbol) + `composeRoomId` utility

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.6, 1.8

#### Description

The eight injection `Symbol`s (collision-proof) plus a `composeRoomId` helper that builds canonical room IDs, and the server-side re-exports of the shared room/event constants.

#### Acceptance criteria

- [ ] 8 `Symbol`s exported, all unique.
- [ ] The server re-exports of `ROOM_PREFIXES` and `RESERVED_EVENT_NAMES` resolve to the shared source.
- [ ] `composeRoomId('RESOURCE', 'invoice', 'inv_1')` returns `'resource:invoice:inv_1'`.
- [ ] Explanatory JSDoc on each export.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/constants/injection-tokens.constants.ts`
- `src/server/constants/room-prefixes.constants.ts`
- `src/server/constants/reserved-events.constants.ts`
- `src/server/utils/compose-room-id.ts`

#### Agent prompt

````
You are a senior NestJS architect working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps. DI tokens are `Symbol`s to avoid string collisions (pattern from @bymax-one/nest-auth).

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.10 of 16

PRECONDITIONS
- Tasks 1.6 and 1.8 are done: the source layout exists and the shared constants are defined.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.4 "Constants and DI tokens" (the complete skeleton).
- `docs/technical_specification.md` § 4.6 "Injection tokens".
- `docs/technical_specification.md` § 9.1 "Room ID convention".

TASK
1. Create `src/server/constants/injection-tokens.constants.ts` with 8 `Symbol`s:
   ```typescript
   export const REALTIME_OPTIONS_TOKEN = Symbol('BYMAX_REALTIME_OPTIONS')
   export const REALTIME_TRANSPORT_TOKEN = Symbol('BYMAX_REALTIME_TRANSPORT')
   export const REALTIME_AUTHENTICATOR_TOKEN = Symbol('BYMAX_REALTIME_AUTHENTICATOR')
   export const REALTIME_PUBSUB_TOKEN = Symbol('BYMAX_REALTIME_PUBSUB')
   export const REALTIME_OFFLINE_QUEUE_TOKEN = Symbol('BYMAX_REALTIME_OFFLINE_QUEUE')
   export const REALTIME_PRESENCE_TOKEN = Symbol('BYMAX_REALTIME_PRESENCE')
   export const REALTIME_HOOKS_TOKEN = Symbol('BYMAX_REALTIME_HOOKS')
   export const REALTIME_INSTANCE_ID_TOKEN = Symbol('BYMAX_REALTIME_INSTANCE_ID')
   ```
   JSDoc explains why `Symbol` (avoids string collisions across modules).

2. Create `src/server/constants/room-prefixes.constants.ts` re-exporting the shared source:
   ```typescript
   export { ROOM_PREFIXES } from '../../shared/constants/room-prefixes.constants'
   export type { RoomPrefix } from '../../shared/constants/room-prefixes.constants'
   ```

3. Create `src/server/constants/reserved-events.constants.ts` analogously (re-export
   `RESERVED_EVENT_NAMES` + `ReservedEventName` from the shared source).

4. Create `src/server/utils/compose-room-id.ts`:
   ```typescript
   import { ROOM_PREFIXES } from '../constants/room-prefixes.constants'

   export function composeRoomId(prefix: keyof typeof ROOM_PREFIXES, ...parts: string[]): string {
     return [ROOM_PREFIXES[prefix], ...parts].join(':')
   }
   ```
   JSDoc with 3 `@example`s: `composeRoomId('USER', 'u_abc')` → `'user:u_abc'`;
   `composeRoomId('TENANT', 't_1')` → `'tenant:t_1'`;
   `composeRoomId('RESOURCE', 'invoice', 'inv_123')` → `'resource:invoice:inv_123'`.

Constraints:
- 8 unique Symbols; `composeRoomId` ≤ 50 lines; no `any`.
- English-only, timeless comments — no roadmap/phase references in any comment.

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.11 — Internal services: `EventIdGenerator` + `ConnectionRegistry` + `RoomRegistry`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.9, 1.10

#### Description

The three internal services that underpin every transport: a monotonic ID generator for `Last-Event-ID`, a connection registry indexed by id/user/tenant/transport, and a room registry with a reverse index for O(rooms-per-conn) cleanup on disconnect. These carry the highest mutation focus at the pre-release gate.

#### Acceptance criteria

- [ ] 3 services created, all `@Injectable()`.
- [ ] `EventIdGenerator` is monotonic even for calls within the same millisecond.
- [ ] `ConnectionRegistry.register`/`unregister` keep the 3 indices consistent.
- [ ] `RoomRegistry.leaveAll` clears both maps.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/services/event-id-generator.service.ts`
- `src/server/services/connection-registry.service.ts`
- `src/server/services/room-registry.service.ts`

#### Agent prompt

````
You are a senior NestJS code reviewer/implementer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.11 of 16

PRECONDITIONS
- Tasks 1.9–1.10 are done: interfaces, DI tokens, and `composeRoomId` exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.5 "Internal services" (the complete skeletons for all 3).
- `docs/technical_specification.md` § 7.2 "ConnectionRegistry (internal)".
- `docs/technical_specification.md` § 7.3 "RoomRegistry (internal)".

TASK
Create 3 services in `src/server/services/`:

1. `event-id-generator.service.ts` — `@Injectable() class EventIdGenerator` with `next(): string`
   returning `{epochMillis}-{counter}` (counter zero-padded to 6 digits). Reset the counter when the
   millisecond changes. JSDoc with `@example`. IDs must be lexicographically sortable.

2. `connection-registry.service.ts` — export a
   `ConnectionRecord { connectionId, userId, tenantId?, transport: 'sse' | 'websocket', ip,
   userAgent?, connectedAt, subject: Subject<MessageEvent> | null, close$: Subject<void> | null,
   originalAuth }` (`subject` and `close$` are populated only for SSE; WS leaves them `null`).
   Then `@Injectable() class ConnectionRegistry` with 3 internal indices (`byId`, `byUserId`,
   `byTenantId`) and methods `register`, `unregister`, `get`, `byUser(userId, transport?)`,
   `byTenant(tenantId, transport?)`, `allByTransport`, `count`, `countUsers`. Operations amortized O(1).

3. `room-registry.service.ts` — `@Injectable() class RoomRegistry` with 2 maps (`rooms`,
   `connectionRooms`) and methods `join`, `leave`, `members`, `roomsOf`, `leaveAll(connectionId)`,
   `countRooms`. The reverse index makes `leaveAll` O(rooms-per-conn), not O(total rooms).

These three files carry the highest mutation focus at the pre-release gate — keep them small, pure,
and fully branch-covered.

Constraints:
- All `@Injectable()`; no `any` (use `unknown`/generics); `import type` for type-only imports.
- Functions ≤ 50 lines; English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.11 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.12 — SSE core: `EventReplayBuffer` + `HeartbeatService` + `SseTransport`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.11

#### Description

The three SSE building blocks: the per-user ring buffer for `Last-Event-ID` replay, the heartbeat service that writes raw `: keepalive\n\n` comments to the response stream, and the `ITransport` implementation with the local-delivery-plus-single-publish emit path.

#### Acceptance criteria

- [ ] 3 files created.
- [ ] `EventReplayBuffer` injects `REALTIME_OPTIONS_TOKEN`, is keyed by `userId`, and evicts FIFO using the parenthesized cap.
- [ ] `HeartbeatService.start` writes a raw `: keepalive\n\n` comment to the response stream on an interval (not a `MessageEvent`, not a named event) and `stop(connectionId)` clears it.
- [ ] `SseTransport.kind === 'sse'`; public `emitTo*`/`broadcast`/`disconnect` do local delivery + a single publish; the `*Local` methods never publish.
- [ ] `disconnect` of a non-local connection publishes `op:'disconnect'`; `disconnectLocal` completes `close$` before unregistering.
- [ ] A failure in one connection does not block delivery to others (per-connection try/catch).
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/transports/sse/event-replay-buffer.ts`
- `src/server/transports/sse/heartbeat.service.ts`
- `src/server/transports/sse/sse.transport.ts`

#### Agent prompt

````
You are a senior NestJS code reviewer/implementer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport (SSE default),
3 npm subpaths, zero direct deps.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.12 of 16

PRECONDITIONS
- Task 1.11 is done: `EventIdGenerator`, `ConnectionRegistry` (with `ConnectionRecord` carrying
  `subject` + `close$`), and `RoomRegistry` exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.6 "SSE transport" (the complete skeletons).
- `docs/technical_specification.md` § 6.1 "SseTransport" (the local-only emit split, the
  op:'disconnect' producer, the heartbeat-as-comment note, the teardown via `close$`/`takeUntil`).
- `docs/technical_specification.md` § 7.4 "EventReplayBuffer" (injects the options token; the
  parenthesized cap).
- `docs/technical_specification.md` § 10.1 "Last-Event-ID".
- `docs/technical_specification.md` § 11.2 "Flow with pub/sub" (why remote messages dispatch to *Local).

TASK
Create in `src/server/transports/sse/`:

1. `event-replay-buffer.ts` — `@Injectable() class EventReplayBuffer` keyed by `userId`
   (`Map<string, MessageEvent[]>`). It MUST inject the options token:
   `constructor(@Inject(REALTIME_OPTIONS_TOKEN) private readonly opts: BymaxRealtimeModuleOptions) {}`.
   `append(userId, event)`: push, then evict FIFO using a PARENTHESIZED cap —
   `const cap = this.opts.sse?.replayBufferSize ?? 100; if (buf.length > cap) buf.shift()`
   (never `buf.length > this.opts.sse?.replayBufferSize ?? 100`, which leaves the buffer unbounded).
   `since(userId, lastEventId)`: return the events after `lastEventId` (empty array on a miss).
   JSDoc with an `@example` showing a reconnect scenario.

2. `heartbeat.service.ts` — `@Injectable() class HeartbeatService` with
   `start(connectionId: string, res: Response, intervalMs: number): void` that writes the raw SSE
   comment `: keepalive\n\n` DIRECTLY to the response stream (`res.write(': keepalive\n\n')`) on a
   `setInterval`, tracking the timer in a `Map<string, NodeJS.Timeout>` keyed by `connectionId`, and
   `stop(connectionId): void` that clears the interval. The heartbeat is a true SSE comment — NOT a
   `MessageEvent`, NOT a named event, and out of the event-id space (it never corrupts Last-Event-ID).

3. `sse.transport.ts` — `@Injectable() class SseTransport implements ITransport` with
   `readonly kind = 'sse' as const`. Constructor injects `ConnectionRegistry`, `RoomRegistry`,
   `EventReplayBuffer`, `EventIdGenerator`, `@Inject(REALTIME_AUTHENTICATOR_TOKEN) auth`,
   `@Inject(REALTIME_PUBSUB_TOKEN) pubsub`. Implement:
   - `onModuleInit()`: subscribe to `pubsub`; dispatch each remote message by `op` to the matching
     `*Local` method ONLY (`emitToUserLocal`/`emitToTenantLocal`/`emitToRoomLocal`/`broadcastLocal`/
     `disconnectLocal`). Self-filter by `origin` (skip messages this instance published) so the
     single-instance default never double-delivers.
   - Public `emitToUser`/`emitToTenant`/`emitToRoom`/`broadcast`: generate an id via `EventIdGenerator`,
     call the matching `*Local` method (local delivery), then publish ONCE. NEVER publish from a `*Local`.
   - `*Local` methods: build the `MessageEvent`, `replayBuffer.append(...)` for user-scoped emits,
     and `subject.next(...)` to each target connection — with a per-connection try/catch so one
     failing connection does not block the others. NO publish here.
   - `joinRoom`/`leaveRoom`: delegate to `RoomRegistry`.
   - `disconnect(connectionId, reason?)`: if the connection is owned by THIS instance, call
     `disconnectLocal`; otherwise publish `op:'disconnect'` so the owning instance closes it.
   - `disconnectLocal(connectionId, reason?)`: `close$.next()` then `close$.complete()` (tears down
     the @Sse stream), then `ConnectionRegistry.unregister` and `RoomRegistry.leaveAll`. NO re-publish.
   - `onApplicationShutdown()`: unsubscribe and tear down all SSE connections.

   Note: `EventReplayBuffer` is the GLOBAL per-user buffer (injected) — it is NOT instantiated
   per-connection.

Constraints:
- `kind = 'sse' as const`; no `any`; `import type` for type-only imports.
- A failure in one connection must not block the others (per-connection try/catch).
- Functions ≤ 50 lines; files ≤ 800; English-only, timeless comments (reference spec §6.1 by section,
  never a phase name).

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -nE "kind = 'sse'" src/server/transports/sse/sse.transport.ts` — expected: match.
- `grep -n "keepalive" src/server/transports/sse/heartbeat.service.ts` — expected: the raw `: keepalive` comment.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.12 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.13 — `SseController` + factory + `RealtimeService` + `InMemoryPubSub` + `forRoot`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.9, 1.10, 1.11, 1.12

#### Description

The phase glue: a dynamic controller with `@Sse(endpoint)` (built by a factory so the endpoint is configurable), `RealtimeService` as the unified public API delegating to the active `ITransport`, the default single-instance `InMemoryPubSub`, and the synchronous `BymaxRealtimeModule.forRoot({ transport: 'sse' })`.

#### Acceptance criteria

- [ ] 4 files created.
- [ ] `forRoot({ transport: 'sse', authenticator })` returns a valid `DynamicModule`.
- [ ] The dynamic controller has `@Sse(endpoint)` applied and uses `@Res({ passthrough: true })` so the heartbeat can write to the response.
- [ ] `RealtimeService.emitToUser` (and the other 6 methods) delegate to the transport with arguments intact.
- [ ] `InMemoryPubSub.publish` invokes all handlers; `subscribe` returns a working unsubscribe.
- [ ] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/factories/sse-controller.factory.ts`
- `src/server/pubsub/in-memory-pubsub.ts`
- `src/server/services/realtime.service.ts`
- `src/server/realtime.module.ts`

#### Agent prompt

````
You are a senior NestJS architect working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport (SSE default),
3 npm subpaths, zero direct deps. Auth inverted behind `IConnectionAuthenticator`.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.13 of 16

PRECONDITIONS
- Tasks 1.9–1.12 are done: interfaces, DI tokens, registries, and the SSE core (`SseTransport`,
  `HeartbeatService`, `EventReplayBuffer`) all exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.6 (controller skeleton), § 2.7 (RealtimeService + InMemoryPubSub),
  § 2.8 (forRoot + factory).
- `docs/technical_specification.md` § 6.1 "SseTransport" (the controller skeleton: `@Sse`,
  `@Res({ passthrough: true })`, replay stream, `takeUntil(close$)` teardown).
- `docs/technical_specification.md` § 4.3 "Example forRoot — simple SSE".
- `docs/technical_specification.md` § 5.4 "IRealtimePubSub".
- `docs/technical_specification.md` § 7.1 "RealtimeService — unified public API".

TASK
Create:

1. `src/server/factories/sse-controller.factory.ts` — `function createSseController(endpoint: string): Type<unknown>`
   returning a dynamic controller class with `@Controller()` + a `@Sse(endpoint)` method that takes
   `@Req() req` and `@Res({ passthrough: true }) res`. The method:
   - builds the `ConnectionAuthContext` and calls `transport.authenticate(req)`; on failure throw
     `UnauthorizedException` (in this phase a permissive default authenticator may be wired — the real
     one is plugged later).
   - resolves `Last-Event-ID` from the request headers.
   - creates `connectionId = randomUUID()`, `subject = new Subject<MessageEvent>()`,
     `close$ = new Subject<void>()`, and registers the connection via `ConnectionRegistry`.
   - auto-joins `user:{id}` and `tenant:{id}` (when applicable) via `composeRoomId` + `RoomRegistry`.
   - starts the heartbeat (`HeartbeatService.start(connectionId, res, heartbeatMs)`) — a raw `: keepalive` comment.
   - emits an immediate `connection:established` event.
   - returns `merge(replayStream, subject.asObservable()).pipe(takeUntil(close$), finalize(cleanup))`
     where `cleanup` stops the heartbeat, `RoomRegistry.leaveAll`, and `ConnectionRegistry.unregister`.

2. `src/server/pubsub/in-memory-pubsub.ts` — `@Injectable() class InMemoryPubSub implements IRealtimePubSub`
   holding an internal `Set<handler>`. `publish` invokes every handler; `subscribe` adds the handler and
   returns an unsubscribe that removes it. This is the single-instance default; production multi-instance
   plugs a Redis-backed `IRealtimePubSub` later.

3. `src/server/services/realtime.service.ts` — `@Injectable() class RealtimeService` that injects
   `@Inject(REALTIME_TRANSPORT_TOKEN) transport: ITransport` and exposes `emitToUser`, `emitToTenant`,
   `emitToRoom`, `broadcast`, `joinRoom`, `leaveRoom`, `disconnect` — each delegating to the transport
   with arguments intact. This is the unified public API.

4. `src/server/realtime.module.ts` — `BymaxRealtimeModule` with `@Module({})` and
   `static forRoot(options: BymaxRealtimeModuleOptions): DynamicModule`:
   - validate `transport: 'sse'` (the only supported mode in this phase — `'websocket'`/`'both'` throw
     `REALTIME_INVALID_OPTIONS` until the WebSocket transport lands).
   - `authenticator` expected (warn when missing in this phase; it becomes a hard requirement that throws
     `REALTIME_NO_AUTHENTICATOR` once the auth wiring is complete).
   - `instanceId = randomUUID()` (constant per instance), provided under `REALTIME_INSTANCE_ID_TOKEN`.
   - Providers: `REALTIME_OPTIONS_TOKEN`, `REALTIME_INSTANCE_ID_TOKEN`, `REALTIME_AUTHENTICATOR_TOKEN`,
     `REALTIME_PUBSUB_TOKEN` (InMemoryPubSub default), `ConnectionRegistry`, `RoomRegistry`,
     `EventIdGenerator`, `EventReplayBuffer`, `HeartbeatService`, `SseTransport`,
     `{ provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport }`, `RealtimeService`.
   - Controllers: `[createSseController(options.sse?.endpoint ?? '/realtime/sse')]`.
   - Exports: `RealtimeService`, all public tokens, `ConnectionRegistry`.
   - `global: true` by default.

Constraints:
- No `any`; `import type` for type-only imports.
- The lib never imports a concrete auth library (auth inversion).
- Functions ≤ 50 lines; English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.13 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.14 — Unit specs: registries, id-gen, replay, transport, service, pubsub

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.11, 1.12, 1.13

#### Description

Unit specs covering every implementation file added in the phase, to the Bymax library standard: 100% line/branch coverage on every implemented file.

#### Acceptance criteria

- [ ] 7 spec files created.
- [ ] `pnpm test src/server/` passes with 0 failures.
- [ ] Coverage is 100% line/branch on every file implemented in the phase (`pnpm test:cov`).

#### Files to create / modify

- `src/server/services/event-id-generator.service.spec.ts`
- `src/server/services/connection-registry.service.spec.ts`
- `src/server/services/room-registry.service.spec.ts`
- `src/server/transports/sse/event-replay-buffer.spec.ts`
- `src/server/transports/sse/sse.transport.spec.ts`
- `src/server/services/realtime.service.spec.ts`
- `src/server/pubsub/in-memory-pubsub.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport, 3 npm subpaths,
zero direct deps. Bymax library standard: 100% line/branch coverage per implemented file.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.14 of 16

PRECONDITIONS
- Tasks 1.11–1.13 are done: registries, id-gen, SSE core, controller, RealtimeService, InMemoryPubSub,
  and the module all exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.9 (the phase test strategy + sample specs).
- `docs/development_plan.md` § 1.7 (the coverage standard — 100% per implemented file).

TASK
Create the matching spec files (same path + `.spec.ts`). Use the AAA pattern; English throughout;
add a one-line comment on each `describe`/`it` explaining intent.

1. `event-id-generator.service.spec.ts`:
   - first call returns `{ms}-000001`.
   - two calls within the same ms return monotonic ids.
   - a call after the ms changes resets the counter to 1.
   - 1000 consecutive ids are all unique and lexicographically ordered.

2. `connection-registry.service.spec.ts`:
   - `register` adds to all 3 indices.
   - `byUser` returns only that user's connections.
   - `byTenant` filters by tenant.
   - `unregister` removes from all 3 indices.
   - `unregister` of a non-existent connection is a no-op (returns undefined).
   - `count`, `countUsers` are correct.
   - `allByTransport('sse')` filters by transport.
   - isolation: two different connections coexist independently.

3. `room-registry.service.spec.ts`:
   - `join` creates the room when new.
   - `leave` removes the member and removes the room when empty.
   - `members` returns a snapshot.
   - `leaveAll` removes the connection from all rooms (test with 3+ rooms).
   - isolation: two connections in different rooms do not interfere.
   - `countRooms` is correct after operations.

4. `event-replay-buffer.spec.ts`:
   - `append` adds an event for the user.
   - `since(userId, lastEventId)` returns events after `lastEventId`.
   - `since(userId, 'nonexistent')` returns an empty array (miss).
   - the ring buffer evicts FIFO when it exceeds `replayBufferSize`.
   - `since` after eviction returns only the events still in the buffer.

5. `sse.transport.spec.ts` (mock the registries, heartbeat, and pub/sub):
   - `emitToUser` calls `Subject.next` on every connection of the user.
   - `emitToTenant` filters by tenant.
   - public emit does local delivery AND publishes exactly once; a remote message dispatches to the
     matching `*Local` method only (no re-publish).
   - `disconnect` of a local connection completes `close$` before unregistering; a non-local
     `disconnect` publishes `op:'disconnect'`.
   - a failure in one connection does not block the others (per-connection try/catch).
   - `joinRoom`/`leaveRoom` delegate to `RoomRegistry`.

6. `realtime.service.spec.ts` (mock the transport):
   - all 7 methods delegate to the transport with arguments intact.

7. `in-memory-pubsub.spec.ts`:
   - `publish` invokes all handlers.
   - `subscribe` adds a handler and returns an unsubscribe.
   - the unsubscribe removes the handler (a subsequent publish does not invoke it).

Constraints:
- 100% line/branch coverage on every implemented file (do NOT settle for less).
- English-only, timeless comments; no `any` in test code.

Verification:
- `pnpm test src/server/` — expected: 0 failures.
- `pnpm test:cov` — expected: 100% line/branch on every implemented file.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.14 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.15 — Phase validation + barrel + integration smoke

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1…1.14

#### Description

Cumulative phase validation: write the `src/server/index.ts` barrel, then run typecheck, lint, coverage, build, and the bundle-size gate, plus an import smoke test that the built artifact exposes the public surface. Close with a code review and apply findings.

#### Acceptance criteria

- [ ] `src/server/index.ts` updated with the phase's public barrel (internals NOT exported).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm build`, `pnpm size` all pass.
- [ ] The smoke test prints `BymaxRealtimeModule` and `RealtimeService` from the built `dist/server/index.mjs`.
- [ ] `/bymax-quality:code-review` run over the phase's `src/server/` with no open CRITICAL/HIGH findings.
- [ ] No task of this phase is left pending.

#### Files to create / modify

- `src/server/index.ts`

#### Agent prompt

````
You are a senior NestJS code reviewer working on the nest-realtime project.

PROJECT: @bymax-one/nest-realtime — NestJS real-time library, dual transport (SSE default),
3 npm subpaths, zero direct deps.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.15 of 16 (LAST — phase validation)

PRECONDITIONS
- Tasks 1.1–1.14 are done: scaffold, contracts, registries, SSE core, glue, and unit specs all exist.

REQUIRED READING (only these sections — do not load more):
- `docs/development_plan.md` § 2.9 (the Phase 1 barrel export list) and § 2.10 (the Phase 1 validation steps).
- `docs/technical_specification.md` § 3.3 "Exports per subpath" (what `.` must expose).

TASK
1. Update `src/server/index.ts` with the public barrel:
   - `export { BymaxRealtimeModule } from './realtime.module'`.
   - `export { RealtimeService } from './services/realtime.service'` and
     `export { ConnectionRegistry } from './services/connection-registry.service'`.
     (RoomRegistry, EventIdGenerator, HeartbeatService, EventReplayBuffer, SseTransport, and the
     SSE controller factory are INTERNAL — do NOT export them.)
   - `export { InMemoryPubSub } from './pubsub/in-memory-pubsub'`.
   - `export type { ... }` for the public interfaces (`ITransport`, `IConnectionAuthenticator`,
     `AuthenticationResult`, `ConnectionAuthContext`, `IConnectionLifecycleHooks`,
     `ConnectionEventMeta`, `IRealtimePubSub`, `RealtimePubSubMessage`, `IOfflineQueueStorage`,
     `OfflineQueuedEvent`, `IPresenceStorage`, `BymaxRealtimeModuleOptions`,
     `BymaxRealtimeModuleAsyncOptions`, `BymaxRealtimeModuleOptionsFactory`, `SseOptions`,
     `WebSocketOptions`, `CorsConfig`, `ReauthenticationPolicy`).
   - `export { ...the 8 DI tokens... } from './constants/injection-tokens.constants'`.
   - `export { composeRoomId } from './utils/compose-room-id'`.
   - Convenience re-exports from `../shared`: the types (`TransportMode`, `RealtimeEvent`,
     `PublicConnectionMeta`, `RoomPrefix`, `ReservedEventName`, `RealtimeErrorCode`) and the runtime
     constants (`ROOM_PREFIXES`, `RESERVED_EVENT_NAMES`, `REALTIME_ERROR_CODES`).

2. Run and confirm green:
   ```bash
   pnpm typecheck   # zero errors
   pnpm lint        # zero warnings
   pnpm test:cov    # 100% line/branch on every implemented file
   pnpm build       # 3 subpaths in dist/
   pnpm size        # server ≤ 18 KB brotli, shared ≤ 3 KB, react ≤ 4 KiB (react still empty here)
   ```

3. Integration smoke test — from the repo root:
   ```bash
   node -e "import('./dist/server/index.mjs').then(m => console.log(m.BymaxRealtimeModule.name, m.RealtimeService.name))"
   ```
   Expected: `BymaxRealtimeModule RealtimeService`.

4. Run `/bymax-quality:code-review` over the phase's `src/server/` and apply all findings (no open
   CRITICAL or HIGH).

Constraints:
- Internals stay internal (do NOT export `SseTransport`, the controller factory, `EventReplayBuffer`,
  `HeartbeatService`, `RoomRegistry`, `EventIdGenerator`).
- English-only, timeless comments.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` — expected: all pass.
- The smoke `node -e` command — expected: prints the two class names.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.15 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 1.16 — CI skeleton (`ci.yml` + `codeql.yml` + `scorecard.yml` + `dependabot.yml`)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.3, 1.4, 1.5, 1.6

#### Description

Create the GitHub Actions CI skeleton so **every PR runs green CI from the first one** — the quality loop that gates the AI-agent build of all later phases. This mirrors the rust-auth gold standard (its foundation-phase "CI skeleton workflow" runs every gate green on the stubs). All gates are incremental-safe: they pass on the current scaffold (empty source tree → barrels build, `jest --passWithNoTests`, coverage on implemented files only) and tighten automatically as real code lands. The heavyweight `release.yml` and the scheduled cross-instance e2e workflow are added in Phase 6; `codeql.yml`/`scorecard.yml`/`dependabot.yml` are created here so supply-chain scanning is on from day one. Although listed last in this phase, it has no dependency on the source tasks (1.7–1.15) — run it right after the build config (1.3–1.6) so CI gates every subsequent PR.

#### Acceptance criteria

- [ ] `.github/workflows/ci.yml` runs on `pull_request` + `push` to `main` + `workflow_dispatch`; top-level `permissions: { contents: read }`; `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
- [ ] `ci.yml` job steps (Node `24.x`, `pnpm/action-setup` pinned to `11.0.0`, `actions/setup-node` with `cache: pnpm`): `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test:cov` → `pnpm build` → `pnpm size`; plus `actions/dependency-review-action` on `pull_request`.
- [ ] The `test:e2e` step is incremental-safe: `jest.e2e.config.ts` carries `passWithNoTests: true` (no e2e specs exist until later phases), and the per-PR e2e step excludes the flaky cross-instance suite (`--testPathIgnorePatterns=cross-instance`).
- [ ] All gates pass green on the current scaffold (no source yet): build emits the 3 empty barrels, coverage passes on implemented files, size is within budget.
- [ ] `.github/workflows/codeql.yml` runs CodeQL (JavaScript/TypeScript) on `pull_request` + weekly `schedule`.
- [ ] `.github/workflows/scorecard.yml` runs OpenSSF Scorecard weekly + on `branch_protection_rule`, with `id-token: write` for publishing results.
- [ ] `.github/dependabot.yml` (v2) updates the `npm` and `github-actions` ecosystems weekly (Monday), with an `open-pull-requests-limit` and a `dependencies` label.
- [ ] All third-party actions are pinned (major version or SHA); least-privilege `permissions` on every workflow.
- [ ] No `.gitkeep` / placeholder files are created.

#### Files to create / modify

- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/scorecard.yml`
- `.github/dependabot.yml`
- `jest.e2e.config.ts` (ensure `passWithNoTests: true`)
- `package.json` (ensure the `typecheck`/`lint`/`test:cov`/`build`/`size`/`test:e2e` scripts the workflow calls exist — added in 1.1–1.5)

#### Agent prompt

````
You are a senior CI/release engineer working on the @bymax-one/nest-realtime project.

PROJECT: @bymax-one/nest-realtime — a public, dual-transport (SSE default / WebSocket opt-in) NestJS realtime library.
Node 24, pnpm 11, TypeScript strict, tsup build to 3 subpaths (., ./shared, ./react), Jest + Stryker.

CURRENT PHASE: 1 (Foundation + SSE Transport) — Task 1.16 of 16 (LAST). It has no dependency on the
source tasks (1.7–1.15); it depends only on the build config (1.3–1.6) and should make CI green on the
scaffold so every subsequent PR is gated.

PRECONDITIONS
- Tasks 1.1–1.6 are done: package.json defines the scripts `typecheck`, `lint`, `test:cov`, `build`, `size`
  (and `test:e2e`); tsconfig/tsup/eslint/jest/stryker/check-size configs exist; the 3 barrels build to dist/.
- The source tree is otherwise empty (real code lands in 1.7–1.15 and later phases). CI MUST be green NOW.

REQUIRED READING (only these — do not load more):
- docs/development_plan.md § 1.7 "Global per-phase Done criteria" (the CI-green criterion) and § 7.3 "CI workflows — finalize"
  (what is created here vs. in Phase 6).
- docs/development_plan.md § 1.9 "Expected end file structure" (the .github/ layout).
- The reference workflows in the sibling lib: ../nest-auth/.github/workflows/{ci,codeql,scorecard}.yml and
  ../nest-auth/.github/dependabot.yml — copy and adapt (replace nest-auth → nest-realtime; least-privilege).

TASK
Create the CI skeleton so `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` and the
supply-chain scans all run GREEN on the current scaffold, and stay green incrementally as code lands.

DELIVERABLES
1. .github/workflows/ci.yml — triggers: pull_request, push (main), workflow_dispatch. Top-level
   `permissions: { contents: read }`. `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
   One `build` job on ubuntu-latest, Node 24.x:
     - actions/checkout@v4
     - pnpm/action-setup@v6 with { version: 11.0.0 }
     - actions/setup-node@v4 with { node-version: 24.x, cache: pnpm }
     - pnpm install --frozen-lockfile
     - pnpm typecheck
     - pnpm lint
     - pnpm test:cov           # jest passWithNoTests:true → green with no specs; coverage on implemented files
     - pnpm test:e2e -- --testPathIgnorePatterns=cross-instance   # passWithNoTests:true on jest.e2e.config.ts
     - pnpm build              # emits dist/{server,shared,react}/index.{mjs,cjs,d.ts}
     - pnpm size               # brotli budgets (server 18 KB, shared 3 KB, react 4 KiB)
   - A separate `dependency-review` step/job using actions/dependency-review-action, gated to pull_request.
2. .github/workflows/codeql.yml — CodeQL for javascript-typescript on pull_request + weekly schedule;
   `permissions: { security-events: write, contents: read }`; pinned actions.
3. .github/workflows/scorecard.yml — OpenSSF Scorecard weekly + on branch_protection_rule;
   `permissions: { id-token: write, security-events: write, contents: read }`; pinned actions.
4. .github/dependabot.yml — version: 2; updates for `npm` and `github-actions`, schedule weekly (Monday),
   open-pull-requests-limit set, labels: [dependencies]. No auto-merge.
5. Ensure jest.e2e.config.ts has `passWithNoTests: true` (extend from Task 1.4 if needed) so the e2e step
   is green before any e2e spec exists.

Constraints:
- Least-privilege `permissions` on every workflow; pin every third-party action (major tag or SHA).
- Node 24.x, pnpm 11.0.0 everywhere — no pnpm@10, no action-setup@v3.
- English-only, timeless comments — no Phase/Task references inside any committed file.
- Do NOT create release.yml or e2e-cross-instance.yml here (Phase 6 Task 6.5). Do NOT create .gitkeep/placeholders.

Verification:
- `act` or a pushed branch: ci.yml passes all steps green on the scaffold.
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` — expected: all pass locally.
- `grep -Rn "passWithNoTests" jest.config.ts jest.e2e.config.ts` — expected: both true.
- YAML lint: every workflow is valid; `permissions:` present and least-privilege on each.
- `find .github -name .gitkeep` — expected: no output.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 1.16 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 1.1 ✅ 2026-06-27 — project scaffold + package.json + pnpm workspace
- 1.2 ✅ 2026-06-27 — tsconfig variants + tsup config (3 subpath entries)
- 1.3 ✅ 2026-06-27 — ESLint + Prettier + .gitignore + .npmignore
- 1.4 ✅ 2026-06-27 — Jest configs (unit/coverage/e2e/stryker); v8 coverage + test source maps
- 1.5 ✅ 2026-06-27 — scripts/check-size.mjs brotli bundle-size gate
- 1.6 ✅ 2026-06-27 — source-layout barrels + build-output integrity (3 subpaths)
- 1.7 ✅ 2026-06-27 — shared types (TransportMode, RealtimeEvent, PublicConnectionMeta)
- 1.8 ✅ 2026-06-27 — shared constants (ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES)
- 1.9 ✅ 2026-06-27 — seven server interfaces + barrel (auth inversion lands in code)
- 1.10 ✅ 2026-06-27 — DI tokens (Symbol) + composeRoomId utility
- 1.11 ✅ 2026-06-27 — EventIdGenerator + ConnectionRegistry + RoomRegistry
- 1.12 ✅ 2026-06-27 — EventReplayBuffer + HeartbeatService + SseTransport
- 1.13 ✅ 2026-06-27 — SseController factory + RealtimeService + InMemoryPubSub + forRoot
- 1.14 ✅ 2026-06-27 — unit specs at 100% line+branch coverage
- 1.15 ✅ 2026-06-27 — phase validation, barrel integrity, review fixes
- 1.16 ✅ 2026-06-27 — CI skeleton (ci/codeql/scorecard/dependabot)
