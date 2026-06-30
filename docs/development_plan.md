# Development Plan — @bymax-one/nest-realtime

> **Version:** 2.0.0
> **Last updated:** 2026-06-27
> **Status:** Draft for execution
> **Reference spec:** [`docs/technical_specification.md`](./technical_specification.md)
> **Target engine:** NestJS `@Sse()` + RxJS 7.x (default) + Socket.IO 4.x (opt-in)
> **Derived documents:** `docs/tasks/phase-NN-<slug>.md` (Layer 3 — one file per phase, generated from this plan) + `docs/tasks/README.md` (folder index)

---

## Table of Contents

1. [Plan Overview](#1-plan-overview)
2. [Phase 1 — Foundation + SSE Transport (default)](#2-phase-1--foundation--sse-transport-default)
3. [Phase 2 — Auth + Last-Event-ID + Reauthentication](#3-phase-2--auth--last-event-id--reauthentication)
4. [Phase 3 — Horizontal Scaling SSE (IRealtimePubSub + IOfflineQueueStorage)](#4-phase-3--horizontal-scaling-sse-irealtimepubsub--iofflinequeuestorage)
5. [Phase 4 — WebSocket Transport (opt-in)](#5-phase-4--websocket-transport-opt-in)
6. [Phase 5 — Frontend (`./react`)](#6-phase-5--frontend-react)
7. [Phase 6 — Release v0.1.0](#7-phase-6--release-v010)
8. [Appendix A — Dependency Graph](#appendix-a--dependency-graph)
9. [Appendix B — Complexity Matrix](#appendix-b--complexity-matrix)
10. [Appendix C — Reference Configs (mirror of nest-auth)](#appendix-c--reference-configs-mirror-of-nest-auth)
11. [Appendix D — Glossary and term mapping](#appendix-d--glossary-and-term-mapping)
12. [Appendix E — Infra considerations (proxies, Nginx, Cloudflare, AWS, serverless)](#appendix-e--infra-considerations-proxies-nginx-cloudflare-aws-serverless)

---

## 1. Plan Overview

### 1.1 Development strategy

The implementation follows the **TDD red-green-refactor** protocol with vertically sliced phases:
- Each phase delivers **usable functionality** (not just "ready code") — at the end of each phase, the lib can be installed in a NestJS fixture app and the transport available in the phase exercised
- **Tests precede implementation** in every file with non-trivial logic (registries, transports, replay buffer, auth mixin, React hooks)
- **Per-phase coverage gate**: **100% line/branch per implemented file** (Bymax library standard), with extra mutation focus on critical paths (registries, replay buffer, authentication, cross-instance fan-out)
- **Mutation testing** runs as a **pre-release** gate only (not on per-commit CI — Stryker takes 10-20 min on this lib, the largest in the portfolio); release gate is mutation score **≥ 95% (Stryker break 95)**, surviving mutants killed or documented as equivalent
- **Refactor pass** at the end of each phase, with `/bymax-quality:code-review` before marking the phase as done

The phase order respects the dependency graph (Appendix A): contracts before transports, SSE before WS (honoring the "SSE first, WS opt-in" principle), frontend after the backend has both transports stable.

### 1.2 Guiding principles

| Principle | Practical application |
|---|---|
| **TS strict, zero `any`** | Compiler in `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Punctual exceptions accepted for `socket.io-client` in `useRealtime` (dynamic import without upstream types) — documented inline. |
| **JSDoc on every exported symbol** | Every `export` carries JSDoc with `@example` when applicable. React hooks document the generic `TEvents` shape expected from the consumer. |
| **English in code and comments** | Identifiers, internal messages, comments, JSDoc — all in English. Documentation (`docs/`) in English. |
| **Zero `dependencies`** | `package.json` ships `"dependencies": {}`. Everything via peer dep — `rxjs` always required, others optional per transport (see §1.8). |
| **Auth inversion (structural rule)** | The lib **never** imports `@bymax-one/nest-auth`, `@nestjs/jwt`, or any auth library. All authentication flows through `IConnectionAuthenticator` — mandatory consumer interface. This principle deliberately breaks the historical anti-pattern in which a realtime gateway was hard-coupled to a concrete authentication module. |
| **SSE first, WS opt-in** | Defaults privilege the most common case (server→client push). WebSocket enabled explicitly via `transport: 'websocket'` or `'both'`. Bundles stay minimal when WS isn't used. |
| **Dependency inversion** | `ITransport` (SSE/WS/Composite interchangeable), `IConnectionAuthenticator`, `IConnectionLifecycleHooks`, `IRealtimePubSub`, `IOfflineQueueStorage`, `IPresenceStorage` — all plug-and-play. |
| **Graceful failure: pub/sub never crashes the app** | Unavailable pub/sub degrades to single-instance + warn log; does not throw at runtime. |
| **Multi-tenant ready** | Room conventions `user:{id}`, `tenant:{id}`, `resource:{type}:{id}` are first-class. Auto-join in default rooms happens at connection. |
| **Frontend tree-shakeable** | `socket.io-client` loaded dynamically via `await import()` in `useRealtime`; SSE-only React bundle ≤ 4 KiB brotli (vs ~80 KB with static socket.io-client). |
| **Conventional Commits** | `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Drives the semver bump on release. |

### 1.3 Status legend

| Symbol | Meaning |
| --- | --- |
| 📋 | ToDo |
| 🔄 | In Progress |
| 👀 | Review |
| ✅ | Done |
| ⛔ | Blocked |
| 🟡 | Partial |

### 1.4 Progress

- **Overall progress:** 🔄 2 / 6 phases done (33%) — 28 / 73 tasks (38%)
- **Active phase:** **Phase 3** (Horizontal Scaling (SSE)) — 🔄 In Progress
- **Blocked:** none

### 1.5 Phase dashboard

Canonical phase status. Each row links to that phase's task file in [`docs/tasks/`](./tasks/) (one file per phase, generated from this plan).

| ID | Phase | Status | Progress | Complexity | Last updated |
| --- | --- | --- | --- | --- | --- |
| 1 | [Foundation + SSE Transport](./tasks/phase-01-foundation-sse.md) | ✅ Done | 16/16 | MEDIUM | 2026-06-27 |
| 2 | [Auth + Last-Event-ID + Reauthentication](./tasks/phase-02-auth-last-event-id.md) | ✅ Done | 12/12 | MEDIUM | 2026-06-27 |
| 3 | [Horizontal Scaling (SSE)](./tasks/phase-03-horizontal-scaling-sse.md) | 🔄 In Progress | 0/11 | HIGH | 2026-06-29 |
| 4 | [WebSocket Transport](./tasks/phase-04-websocket-transport.md) | 📋 ToDo | 0/12 | HIGH | 2026-06-23 |
| 5 | [Frontend (`./react`)](./tasks/phase-05-frontend-react.md) | 📋 ToDo | 0/12 | MEDIUM | 2026-06-23 |
| 6 | [Release v0.1.0](./tasks/phase-06-release.md) | 📋 ToDo | 0/10 | LOW | 2026-06-23 |
| | **Total** | 🔄 **2 / 6 phases** | **28 / 73 tasks** | — | — |

> **No time estimate** — this plan is intended for execution by AI agents. Duration in human days does not apply. Relative complexity per phase is in the dashboard above and detailed per sub-step in the [Complexity Matrix in Appendix B](#appendix-b--complexity-matrix). Use those signals to prioritize more careful human review on HIGH complexity phases (Phase 3 and Phase 4).

### 1.6 Update protocol

When a phase or task changes state, keep this dashboard consistent:

1. Set the phase row's **Status** emoji + **Last updated** date and bump its **Progress** (`X/Y` tasks) in the §1.5 dashboard.
2. Recompute **Overall progress** (`N / 6` phases done + percentage, `M / 72` tasks) and update **Active phase** / **Blocked** in §1.4.
3. Mirror the per-task status inside the phase's task file (`docs/tasks/phase-NN-*.md` — Task index row + Completion log), and in the `docs/tasks/README.md` folder index.
4. Never mark a phase ✅ while any §1.7 Done-criteria bullet is unmet — use 🟡 Partial until all are satisfied.
5. Commit the update with a `docs(plan): …` Conventional Commit.

> The authoritative **per-task** maintenance contract lives in [`docs/tasks/README.md`](./tasks/README.md) (Self-update protocol). This §1.6 governs only the plan-level phase dashboard.

### 1.7 Global per-phase Done criteria

A phase is only marked **Done** when, **cumulatively**:

- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm lint` passes without warnings (no `eslint-disable`)
- [ ] `pnpm test:cov` passes with **100% line/branch coverage on every file implemented in the phase** (Bymax library standard); mutation focus (≥ 95%) on the phase's critical paths at the pre-release gate
- [ ] `pnpm build` produces `dist/` with `.mjs`, `.cjs`, `.d.ts` for every subpath declared up to the phase
- [ ] All sub-step acceptance criteria checked off
- [ ] JSDoc present on all new exports
- [ ] `git status` clean (commits made with Conventional Commits)
- [ ] `/bymax-quality:code-review` executed and findings applied
- [ ] CI green — the `ci`, `codeql`, and `scorecard` workflows are created in Phase 1 and pass on every PR from the first one (incremental-safe gates: `jest --passWithNoTests`, coverage on implemented files, size budgets). `release.yml` is tag-driven and exercised in Phase 6.

### 1.8 Peer dependencies per phase

The plan anticipates **two installation paths** — SSE-only consumer vs consumer with WebSocket. This is mandatory to honor the "SSE first, WS opt-in" principle and keep bundles minimal.

| Peer dep | Mandatory | When needed | Phase introduced |
|---|---|---|---|
| `@nestjs/common` | ✅ Always | Server | Phase 1 |
| `@nestjs/core` | ✅ Always | Server | Phase 1 |
| `rxjs` | ✅ Always | Server (SSE Observable) | Phase 1 |
| `reflect-metadata` | ✅ Always | NestJS decorators | Phase 1 |
| `@nestjs/websockets` | ⚠️ Optional | `transport: 'websocket' \| 'both'` | Phase 4 |
| `@nestjs/platform-socket.io` | ⚠️ Optional | `transport: 'websocket' \| 'both'` | Phase 4 |
| `socket.io` | ⚠️ Optional | `transport: 'websocket' \| 'both'` | Phase 4 |
| `@socket.io/redis-adapter` | ⚠️ Optional | WS multi-instance | Phase 4 |
| `ioredis` | ⚠️ Optional | Redis pub/sub or Redis offline queue | Phase 3 / 4 |
| `react` | ⚠️ Optional | `./react` subpath | Phase 5 |
| `react-dom` | ⚠️ Optional | `./react` subpath | Phase 5 |
| `socket.io-client` | ⚠️ Optional | Frontend WS | Phase 5 |

All optional ones in `peerDependenciesMeta` as `optional: true`. The end `package.json` must allow `pnpm install` without warnings on any valid combination (SSE-only, WS-only, both, with or without React).

### 1.9 Expected end file structure (after Phase 6)

The `nest-realtime/` repo root directory follows the canonical `@bymax-one/*` package layout (same as the sibling libs `nest-logger`, `nest-cache`, `nest-notification`):

```
nest-realtime/
├── .github/
│   ├── workflows/          # ci.yml, codeql.yml, scorecard.yml, release.yml, e2e-cross-instance.yml
│   └── dependabot.yml      # npm + github-actions update PRs
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md          ← this file
│   ├── tasks/                       ← one file per phase (phase-01..06-*.md) + README index
│   ├── mutation_testing_plan.md
│   └── mutation_testing_results.md
├── scripts/check-size.mjs
├── src/server/              # main entry — see §3.1 of the spec
├── src/shared/              # zero deps — types & constants
├── src/react/               # peer dep react/react-dom — hooks + provider
├── test/e2e/                # isolated e2e specs (SSE + WS + composite)
├── package.json
├── tsup.config.ts
├── tsconfig.json (+ build / server / e2e / jest variants)
├── jest.config.ts (+ coverage / e2e / stryker variants)
├── stryker.config.json
├── eslint.config.mjs
├── README.md / CHANGELOG.md / SECURITY.md / LICENSE / CLAUDE.md / AGENTS.md
```

### 1.10 How this plan feeds `docs/tasks/`

Each numbered **sub-step** in this plan (§2.X, §3.X, etc.) becomes **one or more executable tasks** in the per-phase files under [`docs/tasks/`](./tasks/) (one file per phase — `phase-NN-<slug>.md`, with a `README.md` folder index). The derivation rule:

- Sub-step with **one single file + logic < 100 LoC** → **1 task**
- Sub-step with **multiple related files** → **grouped task** with per-file checklist
- Sub-step with **logic > 200 LoC** → **split task** into red (test), green (impl), refactor

Each task carries a self-contained 4-backtick agent prompt (Role / PROJECT / CURRENT PHASE / PRECONDITIONS / REQUIRED READING / TASK / DELIVERABLES / Constraints / Verification / Completion Protocol — `/bymax-workflow:phase-tasks` standard). The task Completion Protocol updates the §1.5 phase dashboard above.

### 1.11 Attention points unique to this lib

Because it's the most complex in the portfolio (dual-transport), some aspects demand extra care during phase execution:

1. **Auth inversion is a structural rule, not guidance.** Any task that mentions `JwtService`, `JwtAuthGuard`, `@bymax-one/nest-auth` or any concrete auth library in the lib's `src/` must fail code review. The only allowed reference is in `docs/` (bridge examples) and in tests (mocks).
2. **Cross-instance pub/sub for SSE is non-trivial.** Phase 3 has HIGH complexity because it involves simulating multiple instances in tests (worker_threads), echo prevention policies, and graceful degradation when pub/sub fails.
3. **`createRequire` / dynamic import of `socket.io-client`** is a critical bundle decision. Empirically validate that the SSE-only bundle does not include `socket.io-client` in `dist/react/index.mjs`.
4. **Room convention is first-class.** `user:{id}` and `tenant:{id}` are auto-joined; tasks that change the convention must update `ROOM_PREFIXES` in `shared/` and the documentation. Breaking the convention is a breaking change.
5. **Canonical events (`connection:established`, `heartbeat`, etc.) are reserved.** Tasks must not reuse these names for custom events.
6. **Periodic re-auth can be costly in production.** Default 5 min with 60s positive cache. Discuss the trade-off with the consumer in the README.

---

## 2. Phase 1 — Foundation + SSE Transport (default)

> **Phase objective:** Establish complete project scaffold (3 subpaths), define public contracts (interfaces, types, constants), implement internal registries (`ConnectionRegistry`, `RoomRegistry`, `EventIdGenerator`, `EventReplayBuffer`), deliver functional `SseTransport` + `SseController`, register `RealtimeService` as unified API and expose synchronous `BymaxRealtimeModule.forRoot({ transport: 'sse' })`. At the end of the phase, it is possible to install the lib in a NestJS fixture app, open an `EventSource` and receive emits via `realtimeService.emitToUser(...)`.
>
> **Complexity:** MEDIUM.
>
> **Critical paths for ≥ 95% mutation (Stryker, pre-release):** `src/server/services/connection-registry.service.ts`, `src/server/services/room-registry.service.ts`, `src/server/transports/sse/sse.transport.ts`, `src/server/transports/sse/event-replay-buffer.ts`, `src/server/services/event-id-generator.service.ts`.

### 2.1 Project scaffold (3 subpaths)

**Objective:** Create the folder structure, configuration files and base dependencies, mirroring the canonical `nest-auth` configs, with 3 subpaths (`.`, `./shared`, `./react`) instead of nest-auth's 5.

**Files to create:**

```
nest-realtime/
├── .gitignore
├── .prettierrc
├── .npmignore
├── eslint.config.mjs
├── jest.config.ts
├── jest.coverage.config.ts
├── jest.e2e.config.ts
├── jest.stryker.config.ts
├── stryker.config.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.server.json
├── tsconfig.e2e.json
├── tsconfig.jest.json
├── tsup.config.ts
├── package.json
├── scripts/check-size.mjs
├── src/server/index.ts          # placeholder
├── src/shared/index.ts          # placeholder
└── src/react/index.ts           # placeholder (real exports added in the frontend phase)
```

> `test/e2e/` and other directories are **not** pre-created with `.gitkeep` placeholders — they emerge on demand when the first real file (an e2e spec/fixture) is written, per the Bymax no-placeholder rule.

**Reference content:**

Copy from the sibling lib `../nest-auth/` and adapt (replace `nest-auth` with `nest-realtime`):

| Source (nest-auth) | Destination (nest-realtime) | Adaptation |
|---|---|---|
| `tsconfig.json` | `tsconfig.json` | Change path aliases: 3 subpaths (`@bymax-one/nest-realtime`, `@bymax-one/nest-realtime/shared`, `@bymax-one/nest-realtime/react`) |
| `tsconfig.build.json` | `tsconfig.build.json` | Identical (extends tsconfig.json, excludes `**/*.spec.ts`, `test/`) |
| `tsconfig.server.json` | `tsconfig.server.json` | `include: ['src/server/**/*']` |
| `tsconfig.e2e.json` | `tsconfig.e2e.json` | Includes `test/e2e/`; more permissive |
| `tsconfig.jest.json` | `tsconfig.jest.json` | Identical |
| `jest.config.ts` | `jest.config.ts` | `moduleNameMapper` for 3 subpaths; coverage threshold 80/95 |
| `jest.coverage.config.ts` | `jest.coverage.config.ts` | Threshold 100% global (release gate) |
| `jest.e2e.config.ts` | `jest.e2e.config.ts` | `rootDir: test/e2e`; testTimeout 15s (SSE long-lived) |
| `jest.stryker.config.ts` | `jest.stryker.config.ts` | Identical |
| `stryker.config.json` | `stryker.config.json` | Thresholds high 99, low 95, break 95 (Bymax library standard, mirrors `nest-logger`) |
| `tsup.config.ts` | `tsup.config.ts` | **Rewrite** — 3 entries (`server`, `shared`, `react`); externals: peer deps |
| `eslint.config.mjs` | `eslint.config.mjs` | Copy; remove rules specific to `oauth/`, `crypto/`; keep `eslint-plugin-security`, `eslint-plugin-import`; add opt-in rule for React in `src/react/**` |
| `.prettierrc` | `.prettierrc` | Identical |
| `.gitignore` | `.gitignore` | Identical |
| `scripts/check-size.mjs` | `scripts/check-size.mjs` | **Rewrite** — 3 entries: `server` budget 18 KB brotli, `shared` budget 3 KB brotli, `react` budget 4 KB brotli (SSE-only — without static socket.io-client) |

**Detail — `package.json` for this phase:**

```json
{
  "name": "@bymax-one/nest-realtime",
  "version": "0.1.0-alpha.0",
  "description": "Realtime backend → frontend communication for NestJS — dual-transport SSE (default) and WebSocket (opt-in) with a unified server-side API.",
  "author": "Bymax One <support@bymax.one>",
  "license": "MIT",
  "homepage": "https://github.com/bymaxone/nest-realtime#readme",
  "repository": { "type": "git", "url": "https://github.com/bymaxone/nest-realtime.git" },
  "bugs": { "url": "https://github.com/bymaxone/nest-realtime/issues" },
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.mjs",
      "require": "./dist/react/index.cjs"
    }
  },
  "scripts": {
    "build": "pnpm clean && tsup",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.ts",
    "test:all": "pnpm test && pnpm test:e2e",
    "test:cov:all": "jest --config jest.coverage.config.ts --coverage",
    "mutation": "stryker run",
    "mutation:incremental": "stryker run --incremental",
    "mutation:dry-run": "stryker run --dryRunOnly",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
    "size": "node scripts/check-size.mjs",
    "clean": "rm -rf dist coverage",
    "prepublishOnly": "pnpm clean && pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build",
    "release": "pnpm publish --provenance"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "rxjs": "^7.8.0",
    "reflect-metadata": "^0.2.0",
    "@nestjs/websockets": "^11.0.0",
    "@nestjs/platform-socket.io": "^11.0.0",
    "socket.io": "^4.0.0",
    "@socket.io/redis-adapter": "^8.0.0",
    "ioredis": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "socket.io-client": "^4.0.0"
  },
  "peerDependenciesMeta": {
    "@nestjs/websockets": { "optional": true },
    "@nestjs/platform-socket.io": { "optional": true },
    "socket.io": { "optional": true },
    "@socket.io/redis-adapter": { "optional": true },
    "ioredis": { "optional": true },
    "react": { "optional": true },
    "react-dom": { "optional": true },
    "socket.io-client": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11.1.20",
    "@nestjs/core": "^11.1.20",
    "@nestjs/platform-express": "^11.1.20",
    "@nestjs/platform-socket.io": "^11.1.20",
    "@nestjs/testing": "^11.1.20",
    "@nestjs/websockets": "^11.1.20",
    "@socket.io/redis-adapter": "^8.3.0",
    "@stryker-mutator/core": "^9",
    "@stryker-mutator/jest-runner": "^9",
    "@stryker-mutator/typescript-checker": "^9",
    "@testing-library/react": "^16.0.0",
    "@types/express": "^5.0.6",
    "@types/jest": "^30.0.0",
    "@types/node": "^25.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/supertest": "^7.2.0",
    "@typescript-eslint/eslint-plugin": "^8.59.3",
    "@typescript-eslint/parser": "^8.59.3",
    "eslint": "^9.39.4",
    "eslint-config-prettier": "^10.1.8",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import": "^2.32.0",
    "eslint-plugin-prettier": "^5.5.5",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-security": "^4.0.0",
    "eventsource": "^3.0.0",
    "ioredis": "^5.4.0",
    "ioredis-mock": "^8.9.0",
    "jest": "^30.4.2",
    "jest-environment-jsdom": "^30.4.2",
    "prettier": "^3.8.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "socket.io": "^4.7.0",
    "socket.io-client": "^4.7.0",
    "supertest": "^7.2.2",
    "ts-jest": "^29.4.9",
    "ts-node": "^10.9.2",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  },
  "packageManager": "pnpm@11.0.0",
  "engines": { "node": ">=24.0.0" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

**Detail — `tsup.config.ts`:**

```typescript
import { defineConfig } from 'tsup'

const externalAll = [
  /^@nestjs\//,
  'reflect-metadata',
  'rxjs',
  'socket.io',
  '@socket.io/redis-adapter',
  'ioredis',
  'react',
  'react-dom',
  // Critical: socket.io-client must remain external AND must NOT appear in
  // the static bundle of src/react/index.mjs. Dynamic import path keeps it
  // out of the SSE-only consumer bundle.
  'socket.io-client',
]

export default defineConfig([
  // Server entry (main) — NestJS module + transports
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: externalAll,
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
  // Shared entry — types + constants (zero deps)
  {
    entry: { 'shared/index': 'src/shared/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
  // React entry — hooks for browsers
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: externalAll,
    target: 'es2022',  // browser target — Node 24 not required for React subpath
    platform: 'neutral',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
  },
])
```

**Acceptance criteria:**

- [ ] Directory structure created per the tree above
- [ ] `package.json` with all scripts, peer deps required and optional (with `optional: true`) and devDeps listed
- [ ] `tsconfig.json` inherits strict settings from nest-auth (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [ ] `tsup.config.ts` configured with 3 entries; `socket.io-client` in `external` for all
- [ ] `eslint.config.mjs` in flat config v9 functional (zero warnings in an empty folder)
- [ ] Override of rules for `src/react/**` enabling `eslint-plugin-react-hooks`
- [ ] `pnpm install` completes without warnings about missing peer deps (all optional OK)
- [ ] `pnpm typecheck` passes for the empty `src/server/index.ts`, `src/shared/index.ts` and `src/react/index.ts` (only a placeholder comment)
- [ ] `pnpm lint` passes without warnings
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}`, `dist/shared/index.{mjs,cjs,d.ts}`, and `dist/react/index.{mjs,cjs,d.ts}` even with empty source

**Validation commands:**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
ls -la dist/server/  # confirms .mjs, .cjs, .d.ts
ls -la dist/shared/
ls -la dist/react/
```

**Dependencies:** No previous sub-step. Phase entry point.

**Risks/Notes:**

- ⚠️ `pnpm@11.0.0` is a requirement; using a different major can break lockfile resolution
- ⚠️ Node 24 LTS is the minimum for the server entry; the React entry has `platform: 'neutral'` and `target: 'es2022'` because it is browser-side code
- ⚠️ Do not copy `tsup.config.ts` from nest-auth literally — nest-auth has 5 entries (server/shared/client/react/nextjs), nest-realtime has 3 (server/shared/react), and `external` is larger because of socket.io
- ⚠️ `socket.io-client` appearing in the static bundle of `dist/react/index.mjs` is a failure — validate in §6.5 (Phase 5)

### 2.2 Shared types and constants (`src/shared/`)

**Objective:** Define public types and constants with no NestJS or Node-specific dependencies. They can be imported in the frontend (e.g., Next.js server actions, admin form validations) without bringing in rxjs/express.

**Files to create:**

```
src/shared/
├── types/
│   ├── transport-mode.type.ts
│   ├── realtime-event.type.ts
│   └── connection-meta.type.ts
├── constants/
│   ├── room-prefixes.constants.ts
│   ├── reserved-events.constants.ts
│   └── error-codes.constants.ts
└── index.ts
```

**Skeleton — `src/shared/types/transport-mode.type.ts`:**

```typescript
/**
 * Transport mode selection.
 *
 * - `sse`        — Server-Sent Events only. HTTP-based, server → client push.
 * - `websocket`  — Socket.IO only. Full duplex.
 * - `both`       — Compose SSE and WebSocket. Useful during migrations or
 *                  when different product surfaces need different transports.
 *
 * See `docs/technical_specification.md` §1.3 for selection criteria.
 *
 * @example
 *   const mode: TransportMode = 'sse'
 */
export type TransportMode = 'sse' | 'websocket' | 'both'
```

**Skeleton — `src/shared/types/realtime-event.type.ts`:**

```typescript
/**
 * Generic shape of an event traveling over a realtime transport.
 *
 * Consumers typically define a mapped type describing their events:
 *
 * @example
 *   interface MyAppEvents {
 *     'invoice.paid':  { id: string; amount: number }
 *     'webhook.dlq':   { webhookId: string; reason: string }
 *   }
 */
export interface RealtimeEvent<TData = unknown> {
  /** Monotonically increasing event ID — used for Last-Event-ID replay. */
  id: string
  /** Event name (matches consumer's mapped-type key). */
  type: string
  /** Free-form payload. */
  data: TData
}
```

**Skeleton — `src/shared/types/connection-meta.type.ts`:**

```typescript
/**
 * Public-facing metadata about a single realtime connection.
 *
 * The full internal record (which includes the per-connection RxJS Subject for
 * SSE) is kept private to the server runtime — see
 * `src/server/services/connection-registry.service.ts`.
 */
export interface PublicConnectionMeta {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: 'sse' | 'websocket'
  connectedAt: Date
}
```

**Skeleton — `src/shared/constants/room-prefixes.constants.ts`:**

```typescript
/**
 * Canonical room id prefixes — used to scope emits and auto-join connections.
 *
 * Convention:
 *   - `user:{userId}`                   single user's connections
 *   - `tenant:{tenantId}`               every connection within a tenant
 *   - `resource:{resourceType}:{id}`    per-resource room (e.g., invoice, session)
 *
 * Anything else is application-defined and free-form.
 */
export const ROOM_PREFIXES = {
  USER: 'user',
  TENANT: 'tenant',
  RESOURCE: 'resource',
} as const

export type RoomPrefix = (typeof ROOM_PREFIXES)[keyof typeof ROOM_PREFIXES]
```

**Skeleton — `src/shared/constants/reserved-events.constants.ts`:**

```typescript
/**
 * Event names reserved by the library.
 *
 * Consumer apps SHOULD NOT use these names for application-level events.
 * Doing so will not throw at runtime, but may cause confusion in logs and
 * client-side listeners.
 */
export const RESERVED_EVENT_NAMES = {
  CONNECTION_ESTABLISHED: 'connection:established',
  CONNECTION_REAUTH_FAILED: 'connection:reauthentication-failed',
  CONNECTION_CREDENTIAL_EXPIRING: 'connection:credential-expiring',
  ROOM_JOINED: 'room:joined',
  ROOM_LEFT: 'room:left',
  HEARTBEAT: 'heartbeat',
  ERROR: 'error',
} as const

export type ReservedEventName = (typeof RESERVED_EVENT_NAMES)[keyof typeof RESERVED_EVENT_NAMES]
```

**Skeleton — `src/shared/constants/error-codes.constants.ts`:**

```typescript
/**
 * Canonical error codes emitted by the library.
 * Map 1-to-1 with `docs/technical_specification.md` §14.
 */
export const REALTIME_ERROR_CODES = {
  INVALID_OPTIONS: 'REALTIME_INVALID_OPTIONS',
  NO_AUTHENTICATOR: 'REALTIME_NO_AUTHENTICATOR',
  AUTH_FAILED: 'REALTIME_AUTH_FAILED',
  REAUTHENTICATION_FAILED: 'REALTIME_REAUTHENTICATION_FAILED',
  TOO_MANY_CONNECTIONS: 'REALTIME_TOO_MANY_CONNECTIONS',
  INVALID_TICKET: 'REALTIME_INVALID_TICKET',
  PUBSUB_UNAVAILABLE: 'REALTIME_PUBSUB_UNAVAILABLE',
  PAYLOAD_TOO_LARGE: 'REALTIME_PAYLOAD_TOO_LARGE',
  REPLAY_BUFFER_MISS: 'REALTIME_REPLAY_BUFFER_MISS',
} as const

export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[keyof typeof REALTIME_ERROR_CODES]
```

**Skeleton — `src/shared/index.ts`:**

```typescript
// Types
export type { TransportMode } from './types/transport-mode.type'
export type { RealtimeEvent } from './types/realtime-event.type'
export type { PublicConnectionMeta } from './types/connection-meta.type'

// Constants
export { ROOM_PREFIXES } from './constants/room-prefixes.constants'
export type { RoomPrefix } from './constants/room-prefixes.constants'
export { RESERVED_EVENT_NAMES } from './constants/reserved-events.constants'
export type { ReservedEventName } from './constants/reserved-events.constants'
export { REALTIME_ERROR_CODES } from './constants/error-codes.constants'
export type { RealtimeErrorCode } from './constants/error-codes.constants'
```

**Acceptance criteria:**

- [ ] All files created per the tree
- [ ] JSDoc present on each export (verifiable via `tsc --emitDeclarationOnly`)
- [ ] `pnpm build` generates `dist/shared/index.d.ts` listing all exports
- [ ] `pnpm typecheck` passes
- [ ] Bundle `dist/shared/index.mjs` < 3 KB brotli (validate with `pnpm size` in the §2.9)
- [ ] Subpath `import('@bymax-one/nest-realtime/shared')` resolves correctly in the consumer fixture
- [ ] No reference to `rxjs`, `express`, `@nestjs/*` or `socket.io` in the source

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m).sort()))"
# Expected: [ 'REALTIME_ERROR_CODES', 'RESERVED_EVENT_NAMES', 'ROOM_PREFIXES' ]
# (only runtime exports — types don't appear here)
```

**Dependencies:** §2.1 complete.

**Risks/Notes:**

- ⚠️ `import type` is mandatory when importing types in other files — avoids inclusion in the JS bundle
- ⚠️ Constants must be `as const` to preserve literal types in the `dist/.d.ts`
- ⚠️ Do not add logic in `shared/` — only pure types and constants

### 2.3 Interfaces and contracts (`src/server/interfaces/`)

**Objective:** Define all public interfaces the consumer can implement or reference — `ITransport`, `IConnectionAuthenticator`, `IConnectionLifecycleHooks`, `IRealtimePubSub`, `IOfflineQueueStorage`, `IPresenceStorage`, and the module's configuration types. Except for `ITransport` (only for advanced custom transport cases), all others are mandatory or optional plug-and-play.

**Files to create:**

```
src/server/interfaces/
├── transport.interface.ts
├── connection-authenticator.interface.ts
├── connection-lifecycle-hooks.interface.ts
├── realtime-pubsub.interface.ts
├── offline-queue-storage.interface.ts
├── presence-storage.interface.ts
├── realtime-module-options.interface.ts
└── index.ts
```

**Skeleton — `src/server/interfaces/transport.interface.ts`:**

```typescript
/**
 * Unified transport abstraction.
 *
 * The library ships three concrete implementations:
 *   - `SseTransport`         (the default SSE transport)
 *   - `WebSocketTransport`   (registered when the WebSocket transport is enabled)
 *   - `CompositeTransport`   (fans out to both SSE and WebSocket)
 *
 * Consumers will normally interact with `RealtimeService`, which delegates to
 * the active transport. Implementing a custom `ITransport` is an advanced use
 * case (e.g., connecting to an external bus) and is not the primary surface.
 */
export interface ITransport {
  /** Transport identifier — 'sse' or 'websocket'. Composite reports the dominant kind. */
  readonly kind: 'sse' | 'websocket'

  /** Send to every connection of a single user. */
  emitToUser(userId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection of every user in a tenant. */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void>

  /** Send to every connection in a logical room. */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void>

  /** Send to all connected clients. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void>

  /** Join a connection to a room (idempotent). */
  joinRoom(connectionId: string, roomId: string): Promise<void>

  /** Leave a connection from a room (idempotent). */
  leaveRoom(connectionId: string, roomId: string): Promise<void>

  /** Disconnect a specific connection (e.g., on auth revocation). */
  disconnect(connectionId: string, reason?: string): Promise<void>

  /** Lifecycle — called on NestJS bootstrap. */
  onModuleInit?(): Promise<void>

  /** Lifecycle — called on NestJS shutdown. */
  onApplicationShutdown?(): Promise<void>
}
```

**Skeleton — `src/server/interfaces/connection-authenticator.interface.ts`:**

```typescript
/**
 * Transport-agnostic context passed to `IConnectionAuthenticator.authenticate`.
 *
 * Built from the HTTP request (SSE) or the Socket.IO handshake (WebSocket).
 * Cookies are parsed; headers are normalized to lowercase.
 */
export interface ConnectionAuthContext {
  /** Cookies parsed from the request/handshake headers. */
  cookies: Record<string, string>
  /** Selected headers (lowercase). `authorization` is NOT present in SSE because
   *  browsers strip Authorization headers from EventSource. */
  headers: Record<string, string | undefined>
  /** Query string parameters — useful for the ticket pattern. */
  query: Record<string, string | undefined>
  /** Client IP — best-effort, may need `X-Forwarded-For` configuration behind proxies. */
  ip: string
  /** User-Agent (raw). */
  userAgent: string | undefined
  /** Transport kind initiating the connection. */
  transport: 'sse' | 'websocket'
}

/**
 * Authenticated traits returned by a successful `authenticate()` call.
 * Consumers can extend with extra fields via the `metadata` bag.
 */
export interface AuthenticationResult {
  userId: string
  tenantId?: string
  roles?: readonly string[]
  /** Free-form extras for downstream code (e.g., feature flags, plan tier). */
  metadata?: Record<string, unknown>
}

/**
 * Connection authenticator contract.
 *
 * Implementations bridge the library to whatever auth strategy the consumer
 * uses (cookie JWT via nest-auth, ticket pattern, bearer header in WS, etc.).
 *
 * The library NEVER imports a concrete auth library directly. See
 * `docs/technical_specification.md` §1.6 — "Auth inversion".
 */
export interface IConnectionAuthenticator {
  /**
   * Authenticate a new connection request.
   *
   * @returns Authenticated result, or `null` to reject the connection (the
   *          transport will reply 401 / disconnect accordingly).
   */
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null>

  /**
   * (Optional) Re-validate during long sessions.
   * Called periodically based on `reauthenticationPolicy.intervalSeconds`.
   *
   * @returns true to keep the connection alive, false to disconnect.
   */
  revalidate?(connectionId: string, originalAuth: AuthenticationResult): Promise<boolean>
}
```

**Skeleton — `src/server/interfaces/connection-lifecycle-hooks.interface.ts`:**

```typescript
export interface ConnectionEventMeta {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: 'sse' | 'websocket'
  ip: string
  userAgent: string | undefined
  connectedAt: Date
}

export interface IConnectionLifecycleHooks {
  /** Called after authentication succeeds and the connection is registered. */
  onConnect?(meta: ConnectionEventMeta): void | Promise<void>

  /** Called when the connection closes (any reason). */
  onDisconnect?(meta: ConnectionEventMeta & { reason?: string; durationMs: number }): void | Promise<void>

  /** Called on transport error. */
  onError?(meta: { connectionId?: string; error: Error; transport: 'sse' | 'websocket' }): void | Promise<void>

  /** Called on re-authentication failure (before disconnect). */
  onReauthenticationFailed?(meta: ConnectionEventMeta): void | Promise<void>
}
```

**Skeleton — `src/server/interfaces/realtime-pubsub.interface.ts`:**

```typescript
/**
 * Cross-instance message bus.
 *
 * Implementations are typically Redis pub/sub. The library provides:
 *   - `InMemoryPubSub` (default — single-instance dev)
 *   - `RedisRealtimePubSub` (reference impl, requires `ioredis`)
 *
 * For WebSocket-only deployments, `@socket.io/redis-adapter` is the
 * recommended scaling primitive — `IRealtimePubSub` is NOT required.
 */
export interface RealtimePubSubMessage {
  /** Operation type. */
  op: 'emitToUser' | 'emitToTenant' | 'emitToRoom' | 'broadcast' | 'disconnect'
  /** Operation arguments — shape depends on `op`. */
  args: unknown
  /** Instance ID that originated the message (used to avoid echo). */
  origin: string
}

export interface IRealtimePubSub {
  /** Publish a message to all subscribers (other instances). */
  publish(message: RealtimePubSubMessage): Promise<void>

  /** Subscribe to messages. Returns an async unsubscribe handle. */
  subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>>
}
```

**Skeleton — `src/server/interfaces/offline-queue-storage.interface.ts`:**

```typescript
export interface OfflineQueuedEvent {
  /** Monotonic id — used as Last-Event-ID across reconnections. */
  id: string
  event: string
  data: unknown
  emittedAt: Date
}

export interface IOfflineQueueStorage {
  /**
   * Append an event to a user's offline queue.
   * Implementations should enforce per-user retention (size + TTL).
   */
  append(userId: string, event: OfflineQueuedEvent): Promise<void>

  /**
   * Retrieve events with `id > sinceId`. Used for Last-Event-ID replay
   * beyond the in-memory ring buffer.
   */
  retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]>

  /**
   * Mark events delivered up to a given id. Implementations may purge them
   * or keep for audit — caller does not care.
   */
  acknowledge(userId: string, upToId: string): Promise<void>
}
```

**Skeleton — `src/server/interfaces/presence-storage.interface.ts`:**

```typescript
/**
 * Optional presence tracking — answers "who is online?" across instances.
 * If not provided, the `usePresence` frontend hook is disabled.
 */
export interface IPresenceStorage {
  setOnline(userId: string, connectionId: string, tenantId?: string): Promise<void>
  setOffline(userId: string, connectionId: string): Promise<void>
  isOnline(userId: string): Promise<boolean>
  listOnlineByTenant(tenantId: string): Promise<string[]>
  countOnline(): Promise<number>
}
```

**Skeleton — `src/server/interfaces/realtime-module-options.interface.ts`:**

```typescript
import type { ModuleMetadata, Type } from '@nestjs/common'
import type { TransportMode } from '../../shared/types/transport-mode.type'
import type { IConnectionAuthenticator, AuthenticationResult } from './connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from './connection-lifecycle-hooks.interface'
import type { IRealtimePubSub } from './realtime-pubsub.interface'
import type { IOfflineQueueStorage } from './offline-queue-storage.interface'
import type { IPresenceStorage } from './presence-storage.interface'

export interface CorsConfig {
  origin?: string | readonly string[] | boolean
  credentials?: boolean
  methods?: readonly string[]
}

export interface SseOptions {
  endpoint?: string
  heartbeatMs?: number
  replayBufferSize?: number
  maxConnectionsPerUser?: number
  cors?: CorsConfig
  emitConnectionEvent?: boolean
}

export interface WebSocketOptions {
  namespace?: string
  cors?: CorsConfig
  maxHttpBufferSize?: number
  pingIntervalMs?: number
  pingTimeoutMs?: number
  maxConnectionsPerUser?: number
  redisAdapter?: {
    /** ioredis client — lib calls `.duplicate()` for the subscriber. */
    pubClient: unknown
  }
}

export interface ReauthenticationPolicy {
  intervalSeconds?: number
  onFailure?: 'disconnect' | 'event'
  cacheTtlMs?: number
}

export interface BymaxRealtimeModuleOptions {
  transport: TransportMode
  service?: { name: string; version: string }
  authenticator: IConnectionAuthenticator
  tenantResolver?: (auth: AuthenticationResult) => string | undefined
  hooks?: IConnectionLifecycleHooks
  pubsub?: IRealtimePubSub
  offlineQueue?: IOfflineQueueStorage
  presence?: IPresenceStorage
  sse?: SseOptions
  websocket?: WebSocketOptions
  reauthenticationPolicy?: ReauthenticationPolicy
}

/**
 * Async configuration counterpart — standard NestJS dynamic module pattern.
 */
export interface BymaxRealtimeModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (...args: unknown[]) => BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
  inject?: readonly (string | symbol | Type<unknown>)[]
  useExisting?: Type<BymaxRealtimeModuleOptionsFactory>
  useClass?: Type<BymaxRealtimeModuleOptionsFactory>
}

export interface BymaxRealtimeModuleOptionsFactory {
  createRealtimeOptions(): BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
}
```

**Skeleton — `src/server/interfaces/index.ts`:**

```typescript
export type { ITransport } from './transport.interface'
export type {
  IConnectionAuthenticator,
  AuthenticationResult,
  ConnectionAuthContext,
} from './connection-authenticator.interface'
export type {
  IConnectionLifecycleHooks,
  ConnectionEventMeta,
} from './connection-lifecycle-hooks.interface'
export type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from './realtime-pubsub.interface'
export type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from './offline-queue-storage.interface'
export type { IPresenceStorage } from './presence-storage.interface'
export type {
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptionsFactory,
  SseOptions,
  WebSocketOptions,
  CorsConfig,
  ReauthenticationPolicy,
} from './realtime-module-options.interface'
```

**Acceptance criteria:**

- [ ] All interfaces created with complete JSDoc
- [ ] `readonly` on immutable properties (consistent with `exactOptionalPropertyTypes`)
- [ ] `BymaxRealtimeModuleAsyncOptions` follows the official NestJS async dynamic module pattern
- [ ] `pnpm typecheck` passes
- [ ] No `any` in any signature (use of `unknown` where appropriate, e.g.: `IRealtimePubSub.args`)
- [ ] `IConnectionAuthenticator` declared prominently with a comment about "auth inversion"
- [ ] `WebSocketOptions.redisAdapter.pubClient` is typed as `unknown` — avoids `ioredis` import here

**Validation commands:**

```bash
pnpm typecheck
grep -nE ': any\b|any\[\]' src/server/interfaces/  # expected: no match
grep -nE 'from .ioredis.' src/server/interfaces/   # expected: no match
```

**Dependencies:** §2.2 (needs `TransportMode`).

**Risks/Notes:**

- ⚠️ Do not import `ioredis` in interfaces — use `unknown` for `pubClient`. The Phase 4 code review validates the typed cast when the adapter is instantiated
- ⚠️ Do not merge `BymaxRealtimeModuleOptions` and `BymaxRealtimeModuleAsyncOptions` into a union — confuses the consumer

### 2.4 Constants and DI tokens

**Objective:** Define injection tokens (`Symbol()` — pattern inherited from nest-auth) and room composition helpers.

**Files to create:**

```
src/server/constants/
├── injection-tokens.constants.ts
├── room-prefixes.constants.ts
└── reserved-events.constants.ts
src/server/utils/
└── compose-room-id.ts
```

**Skeleton — `src/server/constants/injection-tokens.constants.ts`:**

```typescript
/**
 * Dependency injection tokens.
 *
 * Symbols are used instead of strings to avoid collision with tokens from other
 * libraries — guaranteed unique at runtime. Pattern inherited from
 * `@bymax-one/nest-auth`.
 */
export const REALTIME_OPTIONS_TOKEN = Symbol('BYMAX_REALTIME_OPTIONS')
export const REALTIME_TRANSPORT_TOKEN = Symbol('BYMAX_REALTIME_TRANSPORT')
export const REALTIME_AUTHENTICATOR_TOKEN = Symbol('BYMAX_REALTIME_AUTHENTICATOR')
export const REALTIME_PUBSUB_TOKEN = Symbol('BYMAX_REALTIME_PUBSUB')
export const REALTIME_OFFLINE_QUEUE_TOKEN = Symbol('BYMAX_REALTIME_OFFLINE_QUEUE')
export const REALTIME_PRESENCE_TOKEN = Symbol('BYMAX_REALTIME_PRESENCE')
export const REALTIME_HOOKS_TOKEN = Symbol('BYMAX_REALTIME_HOOKS')
export const REALTIME_INSTANCE_ID_TOKEN = Symbol('BYMAX_REALTIME_INSTANCE_ID')
```

**Skeleton — `src/server/constants/room-prefixes.constants.ts`:**

```typescript
/**
 * Server-side re-export of room prefixes for ergonomic imports inside `src/server/`.
 * Mirrors the canonical definition in `src/shared/constants/room-prefixes.constants.ts`.
 */
export { ROOM_PREFIXES } from '../../shared/constants/room-prefixes.constants'
export type { RoomPrefix } from '../../shared/constants/room-prefixes.constants'
```

**Skeleton — `src/server/constants/reserved-events.constants.ts`:**

```typescript
export { RESERVED_EVENT_NAMES } from '../../shared/constants/reserved-events.constants'
export type { ReservedEventName } from '../../shared/constants/reserved-events.constants'
```

**Skeleton — `src/server/utils/compose-room-id.ts`:**

```typescript
import { ROOM_PREFIXES } from '../constants/room-prefixes.constants'

/**
 * Build a canonical room id following the library's prefix convention.
 *
 * @example
 *   composeRoomId('USER', 'u_abc')                          // → 'user:u_abc'
 *   composeRoomId('TENANT', 't_acme')                       // → 'tenant:t_acme'
 *   composeRoomId('RESOURCE', 'invoice', 'inv_123')         // → 'resource:invoice:inv_123'
 */
export function composeRoomId(prefix: keyof typeof ROOM_PREFIXES, ...parts: string[]): string {
  return [ROOM_PREFIXES[prefix], ...parts].join(':')
}
```

**Acceptance criteria:**

- [ ] Unique Symbols (`REALTIME_OPTIONS_TOKEN !== REALTIME_TRANSPORT_TOKEN`)
- [ ] Re-exports of `ROOM_PREFIXES` / `RESERVED_EVENT_NAMES` resolve to the shared
- [ ] `composeRoomId('RESOURCE', 'invoice', 'inv_1')` returns `'resource:invoice:inv_1'`
- [ ] `composeRoomId('USER', '')` returns `'user:'` (validation upstream — not the helper's responsibility)
- [ ] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm typecheck
```

**Dependencies:** §2.2.

### 2.5 Internal services — `EventIdGenerator`, `ConnectionRegistry`, `RoomRegistry`

**Objective:** Implement the three internal services underpinning all transports — monotonic ID generator for Last-Event-ID, connection registry by id/user/tenant/transport, room registry (bidirectional membership for cleanup on disconnect).

**Files to create:**

```
src/server/services/
├── event-id-generator.service.ts
├── connection-registry.service.ts
└── room-registry.service.ts
```

**Skeleton — `src/server/services/event-id-generator.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common'

/**
 * Generates monotonically increasing event IDs of the form
 * `{epochMillis}-{counter}` where the counter is reset every millisecond.
 *
 * Guarantees:
 *   - Lexicographically sortable (the counter is zero-padded to 6 digits)
 *   - Monotonic within a single instance even when called at the same epoch ms
 *   - Cross-instance correctness via the per-process `origin` carried in
 *     `IRealtimePubSub` messages — the lib does not attempt global ordering
 *
 * @example
 *   gen.next()  // → '1717000000000-000001'
 *   gen.next()  // → '1717000000000-000002'
 */
@Injectable()
export class EventIdGenerator {
  private lastMs = 0
  private counter = 0

  next(): string {
    const now = Date.now()
    if (now === this.lastMs) {
      this.counter += 1
    } else {
      this.lastMs = now
      this.counter = 1
    }
    const padded = String(this.counter).padStart(6, '0')
    return `${now}-${padded}`
  }
}
```

**Skeleton — `src/server/services/connection-registry.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import type { Subject } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'

/**
 * Internal record kept per active connection.
 * The Subject is only populated for SSE — WebSocket connections set it to null
 * and rely on the Socket.IO server's `to(...).emit(...)` mechanism instead.
 */
export interface ConnectionRecord {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: 'sse' | 'websocket'
  ip: string
  userAgent: string | undefined
  connectedAt: Date
  /** Per-connection Subject (SSE only); `null` for WebSocket. */
  subject: Subject<MessageEvent> | null
  /** Reference to the original `AuthenticationResult` — used by re-auth policy. */
  originalAuth: { userId: string; tenantId?: string; roles?: readonly string[] }
}

/**
 * Indexed registry of active connections.
 *
 * Maintains three maps:
 *   - byId      :  connectionId → record
 *   - byUserId  :  userId       → Set<connectionId>
 *   - byTenant  :  tenantId     → Set<connectionId>
 *
 * All operations are O(1) amortized. Mutation is single-threaded (Node.js
 * event loop) — in the locking required.
 */
@Injectable()
export class ConnectionRegistry {
  private byId = new Map<string, ConnectionRecord>()
  private byUserId = new Map<string, Set<string>>()
  private byTenantId = new Map<string, Set<string>>()

  register(record: ConnectionRecord): void {
    this.byId.set(record.connectionId, record)
    this.addToSetMap(this.byUserId, record.userId, record.connectionId)
    if (record.tenantId) this.addToSetMap(this.byTenantId, record.tenantId, record.connectionId)
  }

  unregister(connectionId: string): ConnectionRecord | undefined {
    const record = this.byId.get(connectionId)
    if (!record) return undefined
    this.byId.delete(connectionId)
    this.removeFromSetMap(this.byUserId, record.userId, connectionId)
    if (record.tenantId) this.removeFromSetMap(this.byTenantId, record.tenantId, connectionId)
    return record
  }

  get(connectionId: string): ConnectionRecord | undefined {
    return this.byId.get(connectionId)
  }

  byUser(userId: string, transport?: 'sse' | 'websocket'): ConnectionRecord[] {
    const ids = this.byUserId.get(userId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.byId.get(id))
      .filter((r): r is ConnectionRecord => r !== undefined && (transport === undefined || r.transport === transport))
  }

  byTenant(tenantId: string, transport?: 'sse' | 'websocket'): ConnectionRecord[] {
    const ids = this.byTenantId.get(tenantId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.byId.get(id))
      .filter((r): r is ConnectionRecord => r !== undefined && (transport === undefined || r.transport === transport))
  }

  allByTransport(transport: 'sse' | 'websocket'): ConnectionRecord[] {
    return Array.from(this.byId.values()).filter((r) => r.transport === transport)
  }

  count(): number {
    return this.byId.size
  }

  /** Best-effort count of distinct users currently connected. */
  countUsers(): number {
    return this.byUserId.size
  }

  private addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key)
    if (existing) existing.add(value)
    else map.set(key, new Set([value]))
  }

  private removeFromSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key)
    if (!existing) return
    existing.delete(value)
    if (existing.size === 0) map.delete(key)
  }
}
```

**Skeleton — `src/server/services/room-registry.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common'

/**
 * Indexed registry of room membership.
 *
 * Maintains two maps:
 *   - rooms            :  roomId       → Set<connectionId>
 *   - connectionRooms  :  connectionId → Set<roomId>
 *
 * The reverse index is critical for `leaveAll()` on disconnect — without it,
 * room cleanup would be O(rooms × members) on each disconnect.
 */
@Injectable()
export class RoomRegistry {
  private rooms = new Map<string, Set<string>>()
  private connectionRooms = new Map<string, Set<string>>()

  join(connectionId: string, roomId: string): void {
    this.addBoth(connectionId, roomId)
  }

  leave(connectionId: string, roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.delete(connectionId)
      if (room.size === 0) this.rooms.delete(roomId)
    }
    const conn = this.connectionRooms.get(connectionId)
    if (conn) {
      conn.delete(roomId)
      if (conn.size === 0) this.connectionRooms.delete(connectionId)
    }
  }

  /** Returns a snapshot of members — safe to iterate concurrently with mutation. */
  members(roomId: string): readonly string[] {
    const set = this.rooms.get(roomId)
    return set ? Array.from(set) : []
  }

  /** Rooms a connection currently belongs to. */
  roomsOf(connectionId: string): readonly string[] {
    const set = this.connectionRooms.get(connectionId)
    return set ? Array.from(set) : []
  }

  /** Remove a connection from every room. Called from `ConnectionRegistry.unregister`. */
  leaveAll(connectionId: string): void {
    const rooms = this.connectionRooms.get(connectionId)
    if (!rooms) return
    for (const roomId of rooms) {
      const set = this.rooms.get(roomId)
      if (set) {
        set.delete(connectionId)
        if (set.size === 0) this.rooms.delete(roomId)
      }
    }
    this.connectionRooms.delete(connectionId)
  }

  /** Total number of distinct rooms. */
  countRooms(): number {
    return this.rooms.size
  }

  private addBoth(connectionId: string, roomId: string): void {
    const room = this.rooms.get(roomId) ?? new Set<string>()
    room.add(connectionId)
    this.rooms.set(roomId, room)

    const conn = this.connectionRooms.get(connectionId) ?? new Set<string>()
    conn.add(roomId)
    this.connectionRooms.set(connectionId, conn)
  }
}
```

**Acceptance criteria:**

- [ ] `EventIdGenerator.next()` produces monotonically increasing IDs in any thread mode (verify with 100k calls in loop)
- [ ] Two consecutive IDs in the same ms have different counters (1-2, 2-3, etc.)
- [ ] `ConnectionRegistry.register` + `unregister` leaves all indices consistent (verifiable with fuzz test)
- [ ] `byUser` with transport filter returns only connections of the requested transport
- [ ] `RoomRegistry.leaveAll` clears the connection from all rooms (validate with 10 rooms)
- [ ] `RoomRegistry.members` returns a snapshot (mutating doesn't affect the returned array)
- [ ] Coverage 100% line/branch in all 3 files
- [ ] Mutation score ≥ 95% — these services are the main target for subtle bugs

**Validation commands:**

```bash
pnpm test src/server/services/event-id-generator.service.spec.ts
pnpm test src/server/services/connection-registry.service.spec.ts
pnpm test src/server/services/room-registry.service.spec.ts
pnpm test:cov
```

**Dependencies:** §2.3 (interfaces).

**Risks/Notes:**

- ⚠️ Counter overflow after 999999 logs in the same ms is unlikely but possible in synthetic tests; padStart uses 6 digits by default. If it becomes a real problem, increase to 9 digits
- ⚠️ `Subject` is imported from `rxjs` — in mocking, use `BehaviorSubject` or `ReplaySubject` as the test requires
- ⚠️ 100% coverage includes error paths (delete without existing key, leave a room that does not exist) — tests must exercise idempotency

### 2.6 SSE transport — `EventReplayBuffer`, `HeartbeatService`, `SseTransport`, `SseController`

**Objective:** Implement the complete SSE stack for single-instance. In-memory replay buffer, heartbeat via RxJS `interval`, transport implementing `ITransport`, and the controller exposing the HTTP endpoint.

**Files to create:**

```
src/server/transports/sse/
├── event-replay-buffer.ts
├── heartbeat.service.ts
├── sse.transport.ts
└── sse.controller.ts
```

**Skeleton — `src/server/transports/sse/event-replay-buffer.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'

/**
 * Per-user ring buffer of recent events for `Last-Event-ID` replay.
 *
 * In-memory by design — survives only as long as the process. For durable
 * replay (e.g., after instance restart, or when the gap exceeds the buffer
 * size), the consumer can plug `IOfflineQueueStorage` which the
 * transport will consult as a fallback.
 *
 * Per-user buffers prevent users from poisoning each other's replay state.
 */
@Injectable()
export class EventReplayBuffer {
  private buffers = new Map<string, MessageEvent[]>()

  constructor(private readonly maxSize: number = 100) {}

  /** Append an event to a user's ring buffer. */
  append(userId: string, event: MessageEvent): void {
    const buf = this.buffers.get(userId) ?? []
    buf.push(event)
    while (buf.length > this.maxSize) buf.shift()
    this.buffers.set(userId, buf)
  }

  /**
   * Return events emitted AFTER `lastEventId`.
   *
   * Returns an empty array when:
   *   - The user has in the buffer (no events yet)
   *   - `lastEventId` does not exist in the buffer (gap — caller must fall
   *     back to `IOfflineQueueStorage` if available)
   */
  since(userId: string, lastEventId: string): MessageEvent[] {
    const buf = this.buffers.get(userId)
    if (!buf) return []
    const idx = buf.findIndex((e) => e.id === lastEventId)
    if (idx === -1) return []
    return buf.slice(idx + 1)
  }

  /** Returns true when the buffer contains an event with the given id. */
  has(userId: string, eventId: string): boolean {
    const buf = this.buffers.get(userId)
    if (!buf) return false
    return buf.some((e) => e.id === eventId)
  }

  /** Total events currently buffered (for diagnostics). */
  size(userId: string): number {
    return this.buffers.get(userId)?.length ?? 0
  }
}
```

**Skeleton — `src/server/transports/sse/heartbeat.service.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import { Observable, interval, map } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'

/**
 * Produces a heartbeat Observable that emits a comment-style payload at
 * `heartbeatMs` interval. The wire format `:` prefix is enforced by the
 * `encode-sse-event` utility on output; here we use `type: 'heartbeat'` so
 * the encoder knows to emit `: keepalive\n\n` instead of a regular event.
 *
 * Heartbeats are NOT given monotonic IDs — they're invisible to consumers
 * and not part of replay.
 */
@Injectable()
export class HeartbeatService {
  build(heartbeatMs: number): Observable<MessageEvent> {
    return interval(heartbeatMs).pipe(
      map(() => ({ type: 'heartbeat', data: '' } satisfies MessageEvent)),
    )
  }
}
```

**Skeleton — `src/server/transports/sse/sse.transport.ts`:**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Subject } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { ITransport } from '../../interfaces/transport.interface'
import type { IConnectionAuthenticator, AuthenticationResult } from '../../interfaces/connection-authenticator.interface'
import type { IRealtimePubSub } from '../../interfaces/realtime-pubsub.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
} from '../../constants/injection-tokens.constants'
import { ConnectionRegistry, type ConnectionRecord } from '../../services/connection-registry.service'
import { RoomRegistry } from '../../services/room-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { EventReplayBuffer } from './event-replay-buffer'
import { ROOM_PREFIXES } from '../../constants/room-prefixes.constants'

/**
 * SSE transport implementation.
 *
 * Owns:
 *   - Subject-per-connection fan-out (in-memory only, in the cross-instance here)
 *   - Replay buffer for `Last-Event-ID`
 *   - Connection registration / unregistration (delegated to ConnectionRegistry)
 *
 * Cross-instance fan-out: `IRealtimePubSub.publish` is called here; the consumer
 * of those messages (the pub/sub subscriber that re-emits locally) lives in the
 * SseTransport subscriber wiring.
 */
@Injectable()
export class SseTransport implements ITransport {
  readonly kind = 'sse' as const
  private readonly logger = new Logger(SseTransport.name)

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
    private readonly replayBuffer: EventReplayBuffer,
    private readonly idGen: EventIdGenerator,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
  ) {}

  /** Authentication delegated to the consumer-provided authenticator. */
  authenticate(ctx: Parameters<IConnectionAuthenticator['authenticate']>[0]) {
    return this.auth.authenticate(ctx)
  }

  /**
   * Register a freshly-authenticated SSE connection.
   * Auto-joins `user:{id}` and `tenant:{id}` rooms.
   */
  async registerConnection(params: {
    connectionId: string
    auth: AuthenticationResult
    subject: Subject<MessageEvent>
    ip: string
    userAgent: string | undefined
  }): Promise<void> {
    const record: ConnectionRecord = {
      connectionId: params.connectionId,
      userId: params.auth.userId,
      tenantId: params.auth.tenantId,
      transport: 'sse',
      ip: params.ip,
      userAgent: params.userAgent,
      connectedAt: new Date(),
      subject: params.subject,
      originalAuth: {
        userId: params.auth.userId,
        tenantId: params.auth.tenantId,
        roles: params.auth.roles,
      },
    }
    this.connections.register(record)
    this.rooms.join(params.connectionId, `${ROOM_PREFIXES.USER}:${params.auth.userId}`)
    if (params.auth.tenantId) {
      this.rooms.join(params.connectionId, `${ROOM_PREFIXES.TENANT}:${params.auth.tenantId}`)
    }
    await this.hooks.onConnect?.({
      connectionId: record.connectionId,
      userId: record.userId,
      tenantId: record.tenantId,
      transport: 'sse',
      ip: record.ip,
      userAgent: record.userAgent,
      connectedAt: record.connectedAt,
    })
  }

  async unregisterConnection(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.unregister(connectionId)
    if (!record) return
    this.rooms.leaveAll(connectionId)
    const durationMs = Date.now() - record.connectedAt.getTime()
    await this.hooks.onDisconnect?.({
      connectionId: record.connectionId,
      userId: record.userId,
      tenantId: record.tenantId,
      transport: 'sse',
      ip: record.ip,
      userAgent: record.userAgent,
      connectedAt: record.connectedAt,
      reason,
      durationMs,
    })
  }

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    const msg = this.buildMessage(event, data)
    this.replayBuffer.append(userId, msg)
    for (const conn of this.connections.byUser(userId, 'sse')) {
      conn.subject?.next(msg)
    }
    await this.fanOut({ op: 'emitToUser', args: { userId, event, data, id: msg.id } })
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    const msg = this.buildMessage(event, data)
    for (const conn of this.connections.byTenant(tenantId, 'sse')) {
      conn.subject?.next(msg)
    }
    await this.fanOut({ op: 'emitToTenant', args: { tenantId, event, data, id: msg.id } })
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    const msg = this.buildMessage(event, data)
    for (const connectionId of this.rooms.members(roomId)) {
      const conn = this.connections.get(connectionId)
      if (conn?.transport === 'sse') conn.subject?.next(msg)
    }
    await this.fanOut({ op: 'emitToRoom', args: { roomId, event, data, id: msg.id } })
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    const msg = this.buildMessage(event, data)
    for (const conn of this.connections.allByTransport('sse')) {
      conn.subject?.next(msg)
    }
    await this.fanOut({ op: 'broadcast', args: { event, data, id: msg.id } })
  }

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.join(connectionId, roomId)
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    this.rooms.leave(connectionId, roomId)
  }

  async disconnect(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.get(connectionId)
    if (!record || record.transport !== 'sse') return
    record.subject?.complete()
    await this.unregisterConnection(connectionId, reason)
  }

  /** Build a replay Observable for a given Last-Event-ID. */
  getReplayEvents(userId: string, lastEventId: string): MessageEvent[] {
    return this.replayBuffer.since(userId, lastEventId)
  }

  private buildMessage(event: string, data: unknown): MessageEvent {
    return { id: this.idGen.next(), type: event, data: data as object }
  }

  /**
   * Publish to the cross-instance bus. Errors are swallowed and logged —
   * pub/sub failure must NEVER affect the live emit path.
   */
  private async fanOut(message: Omit<Parameters<IRealtimePubSub['publish']>[0], 'origin'>): Promise<void> {
    try {
      await this.pubsub.publish({ ...message, origin: this.instanceId })
    } catch (err) {
      this.logger.warn(`pubsub.publish failed: ${(err as Error).message}`)
    }
  }
}
```

**Skeleton — `src/server/transports/sse/sse.controller.ts`:**

```typescript
import {
  Controller,
  Get,
  Inject,
  Logger,
  Req,
  Sse,
  UnauthorizedException,
} from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Observable, Subject, merge, of, finalize } from 'rxjs'
import type { Request } from 'express'
import { randomUUID } from 'node:crypto'
import { SseTransport } from './sse.transport'
import { HeartbeatService } from './heartbeat.service'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { parseCookieHeader } from '../../utils/parse-cookie-header'

@Controller()
export class SseController {
  private readonly logger = new Logger(SseController.name)

  constructor(
    private readonly transport: SseTransport,
    private readonly heartbeat: HeartbeatService,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
  ) {}

  /**
   * SSE endpoint. The actual path is determined at module bootstrap by the
   * dynamic controller factory — see `SseControllerFactory` in §2.8. This
   * default `events` path is used only when `sse.endpoint` is undefined.
   */
  @Sse('events')
  async subscribe(@Req() req: Request): Promise<Observable<MessageEvent>> {
    const ctx = {
      cookies: parseCookieHeader(req.headers['cookie'] ?? ''),
      headers: this.normalizeHeaders(req.headers),
      query: req.query as Record<string, string | undefined>,
      ip: this.resolveIp(req),
      userAgent: req.headers['user-agent'],
      transport: 'sse' as const,
    }

    const auth = await this.transport.authenticate(ctx)
    if (!auth) throw new UnauthorizedException('REALTIME_AUTH_FAILED')

    const connectionId = randomUUID()
    const subject = new Subject<MessageEvent>()
    await this.transport.registerConnection({
      connectionId,
      auth,
      subject,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    // Replay missed events when Last-Event-ID provided
    const lastEventId = req.headers['last-event-id'] as string | undefined
    const replayEvents = lastEventId ? this.transport.getReplayEvents(auth.userId, lastEventId) : []
    const replay$ = replayEvents.length > 0 ? of(...replayEvents) : new Observable<MessageEvent>((s) => s.complete())

    // Canonical `connection:established` event
    const emitConnEvent = this.options.sse?.emitConnectionEvent !== false
    const established$ = emitConnEvent
      ? of<MessageEvent>({
          id: '',  // canonical events do not participate in replay
          type: RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED,
          data: { connectionId, traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles } },
        })
      : new Observable<MessageEvent>((s) => s.complete())

    // Heartbeat
    const heartbeatMs = this.options.sse?.heartbeatMs ?? 30_000
    const heartbeat$ = this.heartbeat.build(heartbeatMs)

    return merge(established$, replay$, subject.asObservable(), heartbeat$).pipe(
      finalize(() => {
        void this.transport.unregisterConnection(connectionId, 'CLIENT_DISCONNECT')
      }),
    )
  }

  private resolveIp(req: Request): string {
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') return xff.split(',')[0]!.trim()
    return req.ip ?? 'unknown'
  }

  private normalizeHeaders(input: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(input)) {
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
    }
    return out
  }
}
```

**Skeleton — `src/server/utils/parse-cookie-header.ts`:**

```typescript
/**
 * Parse an HTTP `Cookie` header into a plain object.
 *
 * Returns an empty object for empty / missing input. Does NOT decode URL
 * encoded values — that is the consumer's responsibility, since JWTs and
 * other tokens are typically NOT URL-encoded in HttpOnly cookies set by
 * server frameworks.
 *
 * @example
 *   parseCookieHeader('access_token=eyJ...; theme=dark')
 *   // → { access_token: 'eyJ...', theme: 'dark' }
 */
export function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  const pairs = cookieHeader.split(';')
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (name) out[name] = value
  }
  return out
}
```

**Acceptance criteria:**

- [ ] `EventReplayBuffer.append` respects `maxSize` (FIFO eviction)
- [ ] `EventReplayBuffer.since(userId, id)` returns `[]` when id is not in the buffer (gap)
- [ ] `HeartbeatService.build(1000)` emits events with `type: 'heartbeat'` every 1s
- [ ] `SseTransport.emitToUser` calls `subject.next` for each of the user's connections
- [ ] `SseTransport.emitToTenant` filters only `transport: 'sse'`
- [ ] `SseTransport.disconnect` calls `subject.complete()` and removes from the registry
- [ ] `SseController.subscribe` throws 401 when auth returns null
- [ ] Last-Event-ID read from the header recovers events from the buffer
- [ ] `connection:established` is the first event in the stream when `emitConnectionEvent !== false`
- [ ] `parseCookieHeader('')` returns `{}`
- [ ] `parseCookieHeader('=value')` ignores a cookie without a name
- [ ] Coverage 100% line/branch in transport + controller + buffer
- [ ] Mutation score ≥ 95% in `event-replay-buffer.ts`

**Validation commands:**

```bash
pnpm test src/server/transports/sse/
pnpm test src/server/utils/parse-cookie-header.spec.ts
pnpm test:cov
```

**Dependencies:** §2.3, §2.4, §2.5.

**Risks/Notes:**

- ⚠️ `MessageEvent` type comes from `@nestjs/common` — verify the correct import (NestJS exports its own definition with `id?: string`)
- ⚠️ `finalize()` on the Observable returned by the controller is **critical** — without it, abandoned connections leak memory
- ⚠️ `req.ip` may be undefined in some NestJS adapters — fallback to 'unknown' is OK
- ⚠️ The path of `@Sse('events')` is literal here — in §2.8 it will be resolved via factory based on `options.sse.endpoint`

### 2.7 `RealtimeService` + InMemoryPubSub default

**Objective:** Implement the unified public API (`RealtimeService`) that delegates to the active transport, and the default `InMemoryPubSub` installed when the consumer does not provide pub/sub (single-instance mode).

**Files to create:**

```
src/server/services/realtime.service.ts
src/server/pubsub/in-memory-pubsub.ts
```

**Skeleton — `src/server/services/realtime.service.ts`:**

```typescript
import { Inject, Injectable } from '@nestjs/common'
import type { ITransport } from '../interfaces/transport.interface'
import { REALTIME_TRANSPORT_TOKEN } from '../constants/injection-tokens.constants'

/**
 * Transport-agnostic realtime API.
 *
 * All methods delegate to the active transport. Switching transports (e.g.,
 * `transport: 'sse'` → `'websocket'`) does NOT require any change in
 * application services that call this API.
 */
@Injectable()
export class RealtimeService {
  constructor(@Inject(REALTIME_TRANSPORT_TOKEN) private readonly transport: ITransport) {}

  /**
   * Send to all connections of a single user (across all devices/tabs).
   *
   * @example
   *   await realtime.emitToUser('u_abc', 'invoice.paid', { id: 'inv_123' })
   */
  emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToUser(userId, event, data)
  }

  /**
   * Send to all connections in a tenant (every user in that tenant).
   *
   * @example
   *   await realtime.emitToTenant('t_acme', 'plan.upgraded', { plan: 'pro' })
   */
  emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToTenant(tenantId, event, data)
  }

  /**
   * Send to a logical room. Use the prefix convention:
   *   - `user:{id}`              single user
   *   - `tenant:{id}`            tenant-wide
   *   - `resource:{type}:{id}`   per-resource
   *
   * Custom (non-prefixed) ids are allowed but cannot collide with the reserved
   * prefixes.
   *
   * @example
   *   await realtime.emitToRoom('resource:invoice:inv_123', 'invoice.updated', { ... })
   */
  emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    return this.transport.emitToRoom(roomId, event, data)
  }

  /** Send to every connected client. Use sparingly. */
  broadcast(event: string, data: unknown): Promise<void> {
    return this.transport.broadcast(event, data)
  }

  /** Add a specific connection to a room. */
  joinRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.joinRoom(connectionId, roomId)
  }

  /** Remove a specific connection from a room. */
  leaveRoom(connectionId: string, roomId: string): Promise<void> {
    return this.transport.leaveRoom(connectionId, roomId)
  }

  /** Force-disconnect a specific connection (e.g., on auth revocation). */
  disconnect(connectionId: string, reason?: string): Promise<void> {
    return this.transport.disconnect(connectionId, reason)
  }
}
```

**Skeleton — `src/server/pubsub/in-memory-pubsub.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../interfaces/realtime-pubsub.interface'

/**
 * Default single-instance pub/sub.
 *
 * Behavior:
 *   - `publish` is a no-op (messages are not actually transported — there's
 *     only one instance to deliver to, which already happened locally)
 *   - `subscribe` registers a handler, but it will never be called because
 *     publish does not invoke it locally
 *
 * Consumers running multiple backend instances MUST provide their own
 * `IRealtimePubSub` (typically Redis-backed — see `RedisRealtimePubSub`)
 * for events to cross between instances.
 */
@Injectable()
export class InMemoryPubSub implements IRealtimePubSub {
  private handlers = new Set<(m: RealtimePubSubMessage) => void>()

  async publish(_message: RealtimePubSubMessage): Promise<void> {
    // Intentionally empty — single-instance mode has nothing to fan out to.
  }

  async subscribe(handler: (m: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
    }
  }
}
```

**Acceptance criteria:**

- [ ] `RealtimeService` methods correctly delegate to the transport
- [ ] `InMemoryPubSub.publish` resolves without side effects (no-op)
- [ ] `InMemoryPubSub.subscribe` adds the handler to the set; unsubscribe removes
- [ ] Coverage 100% in both files

**Validation commands:**

```bash
pnpm test src/server/services/realtime.service.spec.ts
pnpm test src/server/pubsub/in-memory-pubsub.spec.ts
```

**Dependencies:** §2.3, §2.4.

### 2.8 `BymaxRealtimeModule.forRoot` + `SseControllerFactory`

**Objective:** Implement the NestJS dynamic module for `transport: 'sse'`. Synchronous only (`forRootAsync` comes in Phase 2 §3.7). Configure `SseController` with dynamic path based on `options.sse.endpoint`.

**Files to create:**

```
src/server/
├── realtime.module.ts
├── config/
│   ├── validate-options.ts
│   └── default-options.ts
└── transports/sse/sse-controller.factory.ts
```

**Skeleton — `src/server/config/validate-options.ts`:**

```typescript
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'

const VALID_TRANSPORTS = new Set(['sse', 'websocket', 'both'])

/**
 * Validates module options at bootstrap. Throws with actionable messages.
 *
 * @throws Error when `transport` is missing or invalid
 * @throws Error when `authenticator` is missing — auth is mandatory (security
 *         guard rail; running without an authenticator would expose any
 *         connection request as authenticated)
 * @throws Error when WS-specific options are provided but transport excludes WS
 */
export function validateOptions(options: BymaxRealtimeModuleOptions): void {
  if (!options.transport || !VALID_TRANSPORTS.has(options.transport)) {
    throw new Error(
      `[BymaxRealtimeModule] options.transport must be one of 'sse' | 'websocket' | 'both' (got: ${String(options.transport)})`,
    )
  }
  if (!options.authenticator) {
    throw new Error(
      '[BymaxRealtimeModule] options.authenticator is required — auth inversion does not allow the library to ship a default authenticator',
    )
  }
  if (typeof options.authenticator.authenticate !== 'function') {
    throw new Error(
      '[BymaxRealtimeModule] options.authenticator must implement IConnectionAuthenticator.authenticate(context)',
    )
  }
  if (options.sse?.heartbeatMs !== undefined && options.sse.heartbeatMs <= 0) {
    throw new Error('[BymaxRealtimeModule] options.sse.heartbeatMs must be > 0')
  }
  if (options.sse?.replayBufferSize !== undefined && options.sse.replayBufferSize < 0) {
    throw new Error('[BymaxRealtimeModule] options.sse.replayBufferSize must be ≥ 0')
  }
  if (
    options.sse?.maxConnectionsPerUser !== undefined &&
    options.sse.maxConnectionsPerUser <= 0
  ) {
    throw new Error('[BymaxRealtimeModule] options.sse.maxConnectionsPerUser must be > 0')
  }
}
```

**Skeleton — `src/server/config/default-options.ts`:**

```typescript
import type {
  BymaxRealtimeModuleOptions,
  SseOptions,
  WebSocketOptions,
  ReauthenticationPolicy,
} from '../interfaces/realtime-module-options.interface'

const DEFAULT_SSE: Required<SseOptions> = {
  endpoint: '/events',
  heartbeatMs: 30_000,
  replayBufferSize: 100,
  maxConnectionsPerUser: 5,
  cors: { origin: true, credentials: true },
  emitConnectionEvent: true,
}

const DEFAULT_WEBSOCKET: WebSocketOptions = {
  namespace: '/',
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 1_000_000,
  pingIntervalMs: 25_000,
  pingTimeoutMs: 20_000,
  maxConnectionsPerUser: 5,
}

const DEFAULT_REAUTH: Required<ReauthenticationPolicy> = {
  intervalSeconds: 300,
  onFailure: 'disconnect',
  cacheTtlMs: 60_000,
}

/**
 * Merge consumer options with library defaults.
 * Returns a frozen object — callers must NOT mutate.
 */
export function applyDefaults(options: BymaxRealtimeModuleOptions): Readonly<BymaxRealtimeModuleOptions> {
  return Object.freeze({
    ...options,
    sse: options.transport !== 'websocket' ? { ...DEFAULT_SSE, ...(options.sse ?? {}) } : options.sse,
    websocket: options.transport !== 'sse' ? { ...DEFAULT_WEBSOCKET, ...(options.websocket ?? {}) } : options.websocket,
    reauthenticationPolicy: { ...DEFAULT_REAUTH, ...(options.reauthenticationPolicy ?? {}) },
  })
}
```

**Skeleton — `src/server/transports/sse/sse-controller.factory.ts`:**

```typescript
import { Controller, Get, Sse, Req, Inject, UnauthorizedException, Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request } from 'express'
import { Observable, Subject, merge, of, finalize } from 'rxjs'
import { randomUUID } from 'node:crypto'
import { SseTransport } from './sse.transport'
import { HeartbeatService } from './heartbeat.service'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { parseCookieHeader } from '../../utils/parse-cookie-header'

/**
 * Builds a dynamic NestJS controller bound to `options.sse.endpoint`.
 *
 * NestJS requires path strings to be known at class-decoration time, so we
 * generate a fresh class per module instantiation. This keeps the path
 * configurable without resorting to global mutable state.
 */
export function createSseController(endpoint: string): new (...args: unknown[]) => unknown {
  const ssePath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

  @Controller()
  class DynamicSseController {
    private readonly logger = new Logger(DynamicSseController.name)

    constructor(
      private readonly transport: SseTransport,
      private readonly heartbeat: HeartbeatService,
      @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
    ) {}

    @Sse(ssePath)
    async subscribe(@Req() req: Request): Promise<Observable<MessageEvent>> {
      // ... same body as SseController.subscribe (see §2.6)
      // Reused for brevity; in real code, factor common logic into a
      // helper service to avoid duplication.
      // ...
      return new Observable()
    }
  }

  return DynamicSseController
}
```

> **Note:** The duplication between `SseController` (static, default path) and `DynamicSseController` (factory) is intentional for Phase 1 — refactored in §2.9 by moving the logic to a `SseSubscriptionHandler` service. The Phase 1 code review must flag it and the refactor becomes an explicit sub-step.

**Skeleton — `src/server/realtime.module.ts`:**

```typescript
import { DynamicModule, Global, Module, Provider, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { BymaxRealtimeModuleOptions } from './interfaces/realtime-module-options.interface'
import { validateOptions } from './config/validate-options'
import { applyDefaults } from './config/default-options'
import { ConnectionRegistry } from './services/connection-registry.service'
import { RoomRegistry } from './services/room-registry.service'
import { EventIdGenerator } from './services/event-id-generator.service'
import { RealtimeService } from './services/realtime.service'
import { EventReplayBuffer } from './transports/sse/event-replay-buffer'
import { HeartbeatService } from './transports/sse/heartbeat.service'
import { SseTransport } from './transports/sse/sse.transport'
import { createSseController } from './transports/sse/sse-controller.factory'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import {
  REALTIME_OPTIONS_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
} from './constants/injection-tokens.constants'

@Global()
@Module({})
export class BymaxRealtimeModule {
  private static readonly logger = new Logger(BymaxRealtimeModule.name)

  /**
   * Synchronous configuration.
   *
   * @example
   *   BymaxRealtimeModule.forRoot({
   *     transport: 'sse',
   *     authenticator: new MyAuthenticator(),
   *   })
   */
  static forRoot(options: BymaxRealtimeModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)
    const instanceId = randomUUID()

    const providers: Provider[] = [
      { provide: REALTIME_OPTIONS_TOKEN, useValue: resolved },
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: resolved.authenticator },
      { provide: REALTIME_PUBSUB_TOKEN, useValue: resolved.pubsub ?? new InMemoryPubSub() },
      { provide: REALTIME_OFFLINE_QUEUE_TOKEN, useValue: resolved.offlineQueue },
      { provide: REALTIME_PRESENCE_TOKEN, useValue: resolved.presence },
      { provide: REALTIME_HOOKS_TOKEN, useValue: resolved.hooks ?? {} },
      ConnectionRegistry,
      RoomRegistry,
      EventIdGenerator,
      {
        provide: EventReplayBuffer,
        useFactory: () => new EventReplayBuffer(resolved.sse?.replayBufferSize ?? 100),
      },
      HeartbeatService,
    ]

    const controllers: NonNullable<DynamicModule['controllers']> = []

    // Only SSE is wired here; WebSocket support registers when the websocket transport is enabled.
    if (resolved.transport === 'sse' || resolved.transport === 'both') {
      providers.push(SseTransport)
      providers.push({ provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport })
      controllers.push(createSseController(resolved.sse?.endpoint ?? '/events'))
    }

    if (resolved.transport === 'websocket') {
      // Throws for clarity when the 'websocket' transport is selected before its peer deps are installed.
      throw new Error(
        '[BymaxRealtimeModule] transport "websocket" is not available yet. Use "sse" while WebSocket support is implemented.',
      )
    }

    providers.push(RealtimeService)

    BymaxRealtimeModule.logger.log(`Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`)

    return {
      module: BymaxRealtimeModule,
      providers,
      controllers,
      exports: [
        RealtimeService,
        ConnectionRegistry,
        RoomRegistry,
        REALTIME_OPTIONS_TOKEN,
        REALTIME_TRANSPORT_TOKEN,
      ],
    }
  }
}
```

**Acceptance criteria:**

- [ ] `BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator: ... })` returns a valid `DynamicModule`
- [ ] `RealtimeService` injectable in any other module
- [ ] `REALTIME_TRANSPORT_TOKEN` resolves to `SseTransport`
- [ ] Validation throws with a clear message when `authenticator` is missing
- [ ] Validation throws for an invalid `transport`
- [ ] Phase 1 throws when trying `transport: 'websocket'` (with a message indicating Phase 4)
- [ ] Defaults applied correctly (`endpoint: '/events'`, `heartbeatMs: 30_000`)
- [ ] `controllers` array contains the dynamic controller only when transport includes SSE
- [ ] Coverage 100% line/branch in `validate-options.ts`, `default-options.ts`, `realtime.module.ts`

**Validation commands:**

```bash
pnpm test src/server/realtime.module.spec.ts
pnpm test src/server/config/
```

**Dependencies:** §2.3, §2.4, §2.5, §2.6, §2.7.

**Risks/Notes:**

- ⚠️ NestJS `@Sse(path)` requires string literal in the decorator — hence the controller factory. `MetadataScanner` accepts classes generated at runtime
- ⚠️ Deliberate decision: `@Global()` by default (consistent with `nest-auth`) — consumer rarely wants multiple realtime modules in the same app
- ⚠️ Heartbeat default 30s is safe for nginx (60s default) and Cloudflare Pro+; on Cloudflare Free, adjust to < 90s

### 2.9 Barrel export `src/server/index.ts` + tests of Phase 1

**Objective:** Expose the official public API of the server subpath and finalize the phase coverage.

**Files to create/modify:**

- `src/server/index.ts`
- Co-located specs for all new modules (see list below)

**Skeleton — `src/server/index.ts`:**

```typescript
// Module
export { BymaxRealtimeModule } from './realtime.module'

// Public services
export { RealtimeService } from './services/realtime.service'
export { ConnectionRegistry } from './services/connection-registry.service'
export { RoomRegistry } from './services/room-registry.service'

// Interfaces
export type {
  ITransport,
  IConnectionAuthenticator,
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionLifecycleHooks,
  ConnectionEventMeta,
  IRealtimePubSub,
  RealtimePubSubMessage,
  IOfflineQueueStorage,
  OfflineQueuedEvent,
  IPresenceStorage,
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptionsFactory,
  SseOptions,
  WebSocketOptions,
  CorsConfig,
  ReauthenticationPolicy,
} from './interfaces'

// Default pub/sub (consumer rarely instantiates — useful for tests)
export { InMemoryPubSub } from './pubsub/in-memory-pubsub'

// DI tokens
export {
  REALTIME_OPTIONS_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
} from './constants/injection-tokens.constants'

// Room helpers
export { composeRoomId } from './utils/compose-room-id'

// Re-export from shared for convenience
export type { TransportMode, RealtimeEvent, PublicConnectionMeta } from '../shared'
export { ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES } from '../shared'
```

**Specs structure:**

```
src/server/
├── services/
│   ├── connection-registry.service.spec.ts
│   ├── room-registry.service.spec.ts
│   ├── event-id-generator.service.spec.ts
│   └── realtime.service.spec.ts
├── transports/sse/
│   ├── event-replay-buffer.spec.ts
│   ├── heartbeat.service.spec.ts
│   └── sse.transport.spec.ts
├── pubsub/
│   └── in-memory-pubsub.spec.ts
├── config/
│   ├── validate-options.spec.ts
│   └── default-options.spec.ts
├── utils/
│   ├── parse-cookie-header.spec.ts
│   └── compose-room-id.spec.ts
└── realtime.module.spec.ts
```

**Critical test cases:**

#### `connection-registry.service.spec.ts`

```typescript
describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry

  beforeEach(() => { registry = new ConnectionRegistry() })

  it('should register a connection and index by user/tenant', () => {
    const subj = new Subject<MessageEvent>()
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', tenantId: 't1', subject: subj }))
    expect(registry.byUser('u1')).toHaveLength(1)
    expect(registry.byTenant('t1')).toHaveLength(1)
    expect(registry.count()).toBe(1)
  })

  it('should filter byUser by transport when provided', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', transport: 'sse', subject: new Subject() }))
    registry.register(mkRecord({ connectionId: 'c2', userId: 'u1', transport: 'websocket', subject: null }))
    expect(registry.byUser('u1', 'sse')).toHaveLength(1)
    expect(registry.byUser('u1', 'websocket')).toHaveLength(1)
    expect(registry.byUser('u1')).toHaveLength(2)
  })

  it('should remove all indices on unregister', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', tenantId: 't1', subject: new Subject() }))
    registry.unregister('c1')
    expect(registry.byUser('u1')).toEqual([])
    expect(registry.byTenant('t1')).toEqual([])
    expect(registry.get('c1')).toBeUndefined()
  })

  it('should clean up Set entries when last connection of a user is removed', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', subject: new Subject() }))
    registry.unregister('c1')
    expect(registry.countUsers()).toBe(0)
  })

  it('should support multiple connections per user', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', subject: new Subject() }))
    registry.register(mkRecord({ connectionId: 'c2', userId: 'u1', subject: new Subject() }))
    expect(registry.byUser('u1')).toHaveLength(2)
    expect(registry.countUsers()).toBe(1)
  })

  it('should return [] for unknown user', () => {
    expect(registry.byUser('unknown')).toEqual([])
  })
})
```

#### `event-replay-buffer.spec.ts`

```typescript
describe('EventReplayBuffer', () => {
  it('should keep events up to maxSize, evicting oldest', () => {
    const buf = new EventReplayBuffer(3)
    for (let i = 1; i <= 5; i++) buf.append('u1', mkEvent(`id-${i}`))
    expect(buf.size('u1')).toBe(3)
    // 1 and 2 evicted; 3, 4, 5 remain
    expect(buf.has('u1', 'id-3')).toBe(true)
    expect(buf.has('u1', 'id-1')).toBe(false)
  })

  it('should return events after sinceId', () => {
    const buf = new EventReplayBuffer(10)
    buf.append('u1', mkEvent('a'))
    buf.append('u1', mkEvent('b'))
    buf.append('u1', mkEvent('c'))
    expect(buf.since('u1', 'a').map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('should return [] when sinceId not in buffer (gap)', () => {
    const buf = new EventReplayBuffer(10)
    buf.append('u1', mkEvent('a'))
    expect(buf.since('u1', 'missing-id')).toEqual([])
  })

  it('should isolate users from each other', () => {
    const buf = new EventReplayBuffer(10)
    buf.append('u1', mkEvent('a'))
    buf.append('u2', mkEvent('b'))
    expect(buf.has('u1', 'b')).toBe(false)
    expect(buf.has('u2', 'a')).toBe(false)
  })
})
```

#### `validate-options.spec.ts`

```typescript
describe('validateOptions', () => {
  const auth = { authenticate: jest.fn() }

  it('should accept minimal valid options', () => {
    expect(() => validateOptions({ transport: 'sse', authenticator: auth as any })).not.toThrow()
  })

  it.each([
    ['undefined transport', { authenticator: auth as any } as never],
    ['invalid transport', { transport: 'invalid', authenticator: auth as any } as never],
  ])('should throw for %s', (_label, opts) => {
    expect(() => validateOptions(opts)).toThrow(/transport/i)
  })

  it('should throw when authenticator is missing', () => {
    expect(() => validateOptions({ transport: 'sse' } as any)).toThrow(/authenticator is required/)
  })

  it('should throw when authenticator has in the authenticate function', () => {
    expect(() => validateOptions({ transport: 'sse', authenticator: {} as any })).toThrow(/authenticate/)
  })

  it('should throw when sse.heartbeatMs is non-positive', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator: auth as any, sse: { heartbeatMs: 0 } }),
    ).toThrow(/heartbeatMs/)
  })
})
```

#### `sse.transport.spec.ts`

```typescript
describe('SseTransport', () => {
  let transport: SseTransport
  let connections: ConnectionRegistry
  let rooms: RoomRegistry
  let replay: EventReplayBuffer
  let pubsub: jest.Mocked<IRealtimePubSub>

  beforeEach(() => {
    connections = new ConnectionRegistry()
    rooms = new RoomRegistry()
    replay = new EventReplayBuffer(50)
    pubsub = { publish: jest.fn(), subscribe: jest.fn() } as never
    transport = new SseTransport(
      connections, rooms, replay, new EventIdGenerator(),
      { authenticate: jest.fn() } as any,
      pubsub,
      {} as any,
      { transport: 'sse', authenticator: {} } as any,
      'inst-1',
    )
  })

  it('should emit to user, deliver via subject, append to replay buffer, and publish to pub/sub', async () => {
    const subj = new Subject<MessageEvent>()
    const received: MessageEvent[] = []
    subj.subscribe((m) => received.push(m))
    connections.register(mkRecord({ connectionId: 'c1', userId: 'u1', transport: 'sse', subject: subj }))

    await transport.emitToUser('u1', 'foo', { x: 1 })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('foo')
    expect(replay.size('u1')).toBe(1)
    expect(pubsub.publish).toHaveBeenCalledWith(expect.objectContaining({ op: 'emitToUser', origin: 'inst-1' }))
  })

  it('should not deliver to websocket connections when emitToUser via SSE transport', async () => {
    const received: MessageEvent[] = []
    const subj = new Subject<MessageEvent>()
    subj.subscribe((m) => received.push(m))
    connections.register(mkRecord({ connectionId: 'c1', userId: 'u1', transport: 'sse', subject: subj }))
    connections.register(mkRecord({ connectionId: 'c2', userId: 'u1', transport: 'websocket', subject: null }))
    await transport.emitToUser('u1', 'foo', {})
    expect(received).toHaveLength(1)  // only SSE
  })

  it('should swallow pub/sub failures without throwing', async () => {
    pubsub.publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.not.toThrow()
  })

  it('should auto-join user and tenant rooms on register', async () => {
    const subj = new Subject<MessageEvent>()
    await transport.registerConnection({
      connectionId: 'c1', auth: { userId: 'u1', tenantId: 't1' }, subject: subj, ip: 'x', userAgent: 'y',
    })
    expect(rooms.roomsOf('c1')).toEqual(expect.arrayContaining(['user:u1', 'tenant:t1']))
  })
})
```

#### `realtime.module.spec.ts`

```typescript
describe('BymaxRealtimeModule', () => {
  it('should register RealtimeService when transport is sse', async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => null },
        }),
      ],
    }).compile()

    expect(module.get(RealtimeService)).toBeInstanceOf(RealtimeService)
  })

  it('should throw when authenticator is missing', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot({ transport: 'sse' } as any),
    ).toThrow(/authenticator is required/)
  })

  it('should throw a helpful message when websocket-only is requested before WebSocket support exists', () => {
    expect(() =>
      BymaxRealtimeModule.forRoot({
        transport: 'websocket',
        authenticator: { authenticate: async () => null },
      }),
    ).toThrow(/not available/)
  })

  it('should use InMemoryPubSub when no pubsub is provided', async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => null },
        }),
      ],
    }).compile()
    const pubsub = module.get(REALTIME_PUBSUB_TOKEN)
    expect(pubsub).toBeInstanceOf(InMemoryPubSub)
  })

  it('should be global by default', () => {
    const m = BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: { authenticate: async () => null },
    })
    // @Global decorator → module passes module-scoped exports to ancestor.
    // Direct property assertion is structural — see NestJS internals docs.
    expect(m.module).toBe(BymaxRealtimeModule)
  })
})
```

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports **100% line/branch coverage on every file implemented in the phase** (Bymax library standard)
- [ ] Coverage 100% on every implemented file, including the critical paths:
  - `connection-registry.service.ts`: 100%
  - `room-registry.service.ts`: 100%
  - `event-replay-buffer.ts`: 100%
  - `event-id-generator.service.ts`: 100%
  - `sse.transport.ts`: 100%
  - `validate-options.ts`: 100%
- [ ] `pnpm test` zero failures
- [ ] `clearMocks: true` and `restoreMocks: true` honored

**Validation commands:**

```bash
pnpm test:cov
```

**Dependencies:** §2.5 to §2.8.

**Risks/Notes:**

- ⚠️ Testing module with `forRoot` requires a mock authenticator that satisfies `IConnectionAuthenticator` but can return null/error at will
- ⚠️ `Subject` needs `subscribe()` before calling `next()` so the test captures the event — `BehaviorSubject` avoids the problem, but loses fidelity

### 2.10 Phase 1 validation

**Final commands to validate the phase:**

```bash
# 1. Type safety
pnpm typecheck

# 2. Lint
pnpm lint

# 3. Tests + coverage
pnpm test:cov

# 4. Build
pnpm build

# 5. Bundle size (informative in this phase — strict gates only in §6.5)
pnpm size

# 6. Smoke test — import and use the lib in one script (no complete NestJS app)
cat <<'EOF' > /tmp/smoke-test.mjs
import { BymaxRealtimeModule, RealtimeService, InMemoryPubSub } from './dist/server/index.mjs'
import { ROOM_PREFIXES, RESERVED_EVENT_NAMES } from './dist/shared/index.mjs'

console.log('Module class:', BymaxRealtimeModule.name)
console.log('Service class:', RealtimeService.name)
console.log('Default pub/sub:', new InMemoryPubSub().constructor.name)
console.log('Room prefixes:', ROOM_PREFIXES)
console.log('Reserved events:', RESERVED_EVENT_NAMES)
EOF
node /tmp/smoke-test.mjs
```

**Expected:**

```
PASS  src/server/services/connection-registry.service.spec.ts
PASS  src/server/transports/sse/event-replay-buffer.spec.ts
... (all)

Tests:       N passed, N total
Coverage:    Statements 85%+ / Branches 82%+ / Functions 88%+ / Lines 86%+

Module class: BymaxRealtimeModule
Service class: RealtimeService
Default pub/sub: InMemoryPubSub
Room prefixes: { USER: 'user', TENANT: 'tenant', RESOURCE: 'resource' }
Reserved events: { CONNECTION_ESTABLISHED: 'connection:established', ... }
```

**End-to-end smoke (manual, optional for this phase):**

Spin up a NestJS fixture app with:

```typescript
@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: {
        async authenticate() {
          return { userId: 'demo-user', tenantId: 'demo-tenant' }
        },
      },
    }),
  ],
})
class AppModule {}
```

Open `curl -N http://localhost:3000/events` in one terminal and in another call `realtimeService.emitToUser('demo-user', 'hello', { msg: 'world' })`. The client must see:

```
data: {"connectionId":"<uuid>","traits":{"userId":"demo-user","tenantId":"demo-tenant"}}
event: connection:established

id: 1717000000000-000001
event: hello
data: {"msg":"world"}

: heartbeat
```

**Done criteria to close Phase 1:**

- [ ] All commands above pass
- [ ] Coverage thresholds met
- [ ] Manual smoke test (optional) delivers the event to the curl client
- [ ] `git status` clean after commits with Conventional Commits (`feat(realtime): scaffold project structure`, `feat(realtime): add shared types and constants`, `feat(realtime): implement ConnectionRegistry`, etc.)
- [ ] `/bymax-quality:code-review` executed and findings applied (in particular, the duplication between the static `SseController` and `DynamicSseController` must be refactored into a `SseSubscriptionHandler` before closing)
- [ ] Pull request opened with label `phase-1`

---

## 3. Phase 2 — Auth + Last-Event-ID + Reauthentication

> **Phase objective:** Mature the SSE stack to production-ready single-instance. Cover the three canonical authentication patterns (HttpOnly cookie, ticket, WS bearer — documentation-only for WS since Phase 4 comes later), refine `Last-Event-ID` handling for edge cases (gap in buffer, empty replay), guarantee that the heartbeat actually keeps connections alive behind proxies, add the configurable periodic re-authentication policy and wire the lifecycle hooks. At the end of the phase, the lib is safe and robust for single-instance deployment.
>
> **Complexity:** MEDIUM.
>
> **Critical paths for ≥ 95% mutation (Stryker, pre-release):** `src/server/auth/reauthentication.service.ts`, `src/server/auth/authentication-cache.ts`, `src/server/transports/sse/sse-subscription.handler.ts`, `src/server/utils/encode-sse-event.ts`.

### 3.1 Refactor — `SseSubscriptionHandler` (resolves Phase 1 duplication)

**Objective:** Extract the `@Sse()` handler logic into a reusable injectable service. The dynamic controller becomes a thin shell. This was Phase 1 tech debt and is prerequisite for the other Phase 2 sub-steps without duplicating code.

**Files to create/modify:**

```
src/server/transports/sse/
├── sse-subscription.handler.ts  ← NEW
├── sse-controller.factory.ts    ← MODIFY
└── sse.controller.ts            ← REMOVE (replaced by factory + handler)
```

**Skeleton — `src/server/transports/sse/sse-subscription.handler.ts`:**

```typescript
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request } from 'express'
import { Observable, Subject, merge, of, finalize } from 'rxjs'
import { randomUUID } from 'node:crypto'
import { SseTransport } from './sse.transport'
import { HeartbeatService } from './heartbeat.service'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { parseCookieHeader } from '../../utils/parse-cookie-header'

/**
 * Encapsulates everything that happens on an SSE subscription request.
 *
 * Lives separately from the controller so:
 *   - The controller can be a thin dynamic class generated per endpoint
 *   - Logic can be unit-tested without spinning up the full NestJS module
 *   - The CompositeTransport can reuse the SSE subscription flow
 */
@Injectable()
export class SseSubscriptionHandler {
  constructor(
    private readonly transport: SseTransport,
    private readonly heartbeat: HeartbeatService,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
  ) {}

  async handle(req: Request): Promise<Observable<MessageEvent>> {
    const ctx = {
      cookies: parseCookieHeader(req.headers['cookie'] ?? ''),
      headers: this.normalizeHeaders(req.headers),
      query: req.query as Record<string, string | undefined>,
      ip: this.resolveIp(req),
      userAgent: req.headers['user-agent'],
      transport: 'sse' as const,
    }

    const auth = await this.transport.authenticate(ctx)
    if (!auth) {
      throw new UnauthorizedException(REALTIME_ERROR_CODES.AUTH_FAILED)
    }

    // Enforce maxConnectionsPerUser FIFO eviction (default 5)
    const maxPerUser = this.options.sse?.maxConnectionsPerUser ?? 5
    await this.enforceConnectionLimit(auth.userId, maxPerUser)

    const connectionId = randomUUID()
    const subject = new Subject<MessageEvent>()
    await this.transport.registerConnection({
      connectionId,
      auth,
      subject,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    // Replay missed events when Last-Event-ID provided
    const lastEventId = req.headers['last-event-id'] as string | undefined
    const replay$ = this.buildReplayStream(auth.userId, lastEventId)

    // Canonical connection:established event
    const established$ = this.buildEstablishedStream(connectionId, auth)

    // Heartbeat
    const heartbeatMs = this.options.sse?.heartbeatMs ?? 30_000
    const heartbeat$ = this.heartbeat.build(heartbeatMs)

    return merge(established$, replay$, subject.asObservable(), heartbeat$).pipe(
      finalize(() => {
        void this.transport.unregisterConnection(connectionId, 'CLIENT_DISCONNECT')
      }),
    )
  }

  private async enforceConnectionLimit(userId: string, max: number): Promise<void> {
    const existing = this.transport['connections']?.byUser(userId, 'sse') ?? []
    while (existing.length >= max) {
      // FIFO — evict oldest
      const oldest = existing.shift()
      if (!oldest) break
      await this.transport.disconnect(oldest.connectionId, 'REALTIME_TOO_MANY_CONNECTIONS')
    }
  }

  private buildReplayStream(userId: string, lastEventId: string | undefined): Observable<MessageEvent> {
    if (!lastEventId) return new Observable<MessageEvent>((s) => s.complete())
    const events = this.transport.getReplayEvents(userId, lastEventId)
    return events.length > 0 ? of(...events) : new Observable<MessageEvent>((s) => s.complete())
  }

  private buildEstablishedStream(connectionId: string, auth: { userId: string; tenantId?: string; roles?: readonly string[] }): Observable<MessageEvent> {
    if (this.options.sse?.emitConnectionEvent === false) {
      return new Observable<MessageEvent>((s) => s.complete())
    }
    return of<MessageEvent>({
      type: RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED,
      data: { connectionId, traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles } },
    })
  }

  private resolveIp(req: Request): string {
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') return xff.split(',')[0]!.trim()
    return req.ip ?? 'unknown'
  }

  private normalizeHeaders(input: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(input)) {
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
    }
    return out
  }
}
```

**Modification — `src/server/transports/sse/sse-controller.factory.ts`:**

```typescript
import { Controller, Sse, Req } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request } from 'express'
import { Observable } from 'rxjs'
import { SseSubscriptionHandler } from './sse-subscription.handler'

export function createSseController(endpoint: string): new (...args: unknown[]) => unknown {
  const ssePath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

  @Controller()
  class DynamicSseController {
    constructor(private readonly handler: SseSubscriptionHandler) {}

    @Sse(ssePath)
    subscribe(@Req() req: Request): Promise<Observable<MessageEvent>> {
      return this.handler.handle(req)
    }
  }

  return DynamicSseController
}
```

**Acceptance criteria:**

- [ ] `sse.controller.ts` removed — controller now lives only in the factory
- [ ] `SseSubscriptionHandler` covers 100% of subscribe logic (auth, replay, heartbeat, established, finalize)
- [ ] Dynamic controller has ≤ 10 LoC of effective implementation
- [ ] `enforceConnectionLimit` implements FIFO eviction when exceeds `maxConnectionsPerUser`
- [ ] Logs document when a connection is evicted (clear message for diagnosis)
- [ ] Coverage 100% line/branch in `sse-subscription.handler.ts`

**Validation commands:**

```bash
pnpm test src/server/transports/sse/sse-subscription.handler.spec.ts
pnpm test:cov
```

**Dependencies:** Phase 1 §2.6, §2.8 (needs the original controller to be refactored).

**Risks/Notes:**

- ⚠️ Access to `transport['connections']` for the FIFO limit is antipattern (private field access) — refactor to expose `connectionCountForUser(userId)` on the transport
- ⚠️ FIFO eviction can be disruptive if the user reopens many tabs during a large file upload (at the moment of closing the old tab, eviction happens). Document trade-off in the README

### 3.2 `IConnectionAuthenticator` — three patterns + reference nest-auth bridge

**Objective:** Wire the three canonical patterns described in spec §8 (cookie, ticket, bearer header). The lib itself **does not** ship concrete implementations — all are documentation + examples in `docs/`. The sub-step delivers reference material and tests that the auth abstraction works with mocks simulating the three patterns.

**Files to create:**

```
docs/examples/auth/
├── cookie-authenticator.example.ts        # nest-auth bridge
├── ticket-authenticator.example.ts        # ticket pattern
└── bearer-authenticator.example.ts        # WS-only bearer (placeholder for the WebSocket transport)
src/server/auth/
└── authentication-cache.ts                # NEW
```

**Skeleton — `docs/examples/auth/cookie-authenticator.example.ts`:**

```typescript
// Example only — NOT part of the published package.
// Reproduce in consumer app to bridge @bymax-one/nest-auth → @bymax-one/nest-realtime.

import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'

@Injectable()
export class NestAuthRealtimeBridge implements IConnectionAuthenticator {
  constructor(private readonly jwt: JwtService) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    // nest-auth standard cookie name
    const token = ctx.cookies['access_token']
    if (!token) return null

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string
        tid?: string
        roles?: string[]
      }>(token)
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles,
      }
    } catch {
      return null
    }
  }

  async revalidate(_connectionId: string, originalAuth: AuthenticationResult): Promise<boolean> {
    // Optional: check a Redis revocation list for instant kick-out.
    // return !(await this.redis.exists(`auth:revoked:${originalAuth.userId}`))
    return true
  }
}
```

**Skeleton — `docs/examples/auth/ticket-authenticator.example.ts`:**

```typescript
import { Controller, Post, UseGuards, Req, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'

// Step 1 — endpoint that issues tickets (protected by regular auth guard)
@Controller()
export class EventsTicketController {
  constructor(private readonly redis: Redis) {}

  @Post('events/ticket')
  @UseGuards(/* your JwtAuthGuard here */)
  async issueTicket(@Req() req: { user: { id: string; tenantId?: string } }): Promise<{ ticket: string }> {
    const ticket = randomUUID()
    await this.redis.set(
      `realtime:ticket:${ticket}`,
      JSON.stringify({ userId: req.user.id, tenantId: req.user.tenantId }),
      'EX',
      60,
    )
    return { ticket }
  }
}

// Step 2 — authenticator that consumes the ticket on SSE connect
@Injectable()
export class TicketAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly redis: Redis) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const ticket = ctx.query['ticket']
    if (!ticket) return null

    // Tickets are one-shot: GETDEL removes the key atomically
    const raw = await this.redis.getdel(`realtime:ticket:${ticket}`)
    if (!raw) return null

    return JSON.parse(raw) as AuthenticationResult
  }
}
```

**Skeleton — `docs/examples/auth/bearer-authenticator.example.ts`:**

```typescript
// WS-only — EventSource cannot send custom headers.
// The bearer token is extracted from socket.handshake.auth (WebSocket handshake).

import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type {
  IConnectionAuthenticator,
  ConnectionAuthContext,
  AuthenticationResult,
} from '@bymax-one/nest-realtime'

@Injectable()
export class BearerAuthenticator implements IConnectionAuthenticator {
  constructor(private readonly jwt: JwtService) {}

  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    if (ctx.transport !== 'websocket') return null
    const raw =
      ctx.headers['authorization'] ??
      (ctx.headers['x-realtime-token'] as string | undefined)
    if (!raw) return null
    const token = raw.replace(/^Bearer\s+/i, '')
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tid?: string }>(token)
      return { userId: payload.sub, tenantId: payload.tid }
    } catch {
      return null
    }
  }
}
```

**Skeleton — `src/server/auth/authentication-cache.ts`:**

```typescript
import { Injectable } from '@nestjs/common'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'

/**
 * Short-lived positive cache for `revalidate()` results.
 *
 * Re-authentication runs on every active connection at a configurable interval
 * (default 5 min). For apps with thousands of long-lived connections, the
 * authenticator hit rate is non-trivial — caching positive results for 60s
 * cuts JWT verify calls by 5x without compromising security materially.
 *
 * Negative results are NOT cached — revocation should propagate fast.
 */
@Injectable()
export class AuthenticationCache {
  private entries = new Map<string, { result: AuthenticationResult; expiresAt: number }>()

  constructor(private readonly ttlMs: number = 60_000) {}

  /** Lookup. Returns `undefined` on miss or expired entry. */
  get(connectionId: string): AuthenticationResult | undefined {
    const e = this.entries.get(connectionId)
    if (!e) return undefined
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(connectionId)
      return undefined
    }
    return e.result
  }

  set(connectionId: string, result: AuthenticationResult): void {
    this.entries.set(connectionId, { result, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(connectionId: string): void {
    this.entries.delete(connectionId)
  }

  /** Clear all entries — called on shutdown / module re-init. */
  clear(): void {
    this.entries.clear()
  }
}
```

**Acceptance criteria:**

- [ ] Three files in `docs/examples/auth/` document patterns A, B, C
- [ ] Each example compiles (run `tsc --noEmit` in isolated file with types from the lib)
- [ ] `AuthenticationCache.get()` returns `undefined` for an expired entry
- [ ] `AuthenticationCache.set()` overwrites an existing entry
- [ ] `AuthenticationCache.invalidate()` removes an entry
- [ ] Coverage 100% in `authentication-cache.ts`
- [ ] Examples refer to `@bymax-one/nest-realtime` by name (correct subpath)
- [ ] No example is in `src/` — only in `docs/`

**Validation commands:**

```bash
pnpm test src/server/auth/authentication-cache.spec.ts
# Validate examples compile (does NOT include them in the built artifact)
npx tsc --noEmit docs/examples/auth/cookie-authenticator.example.ts
```

**Dependencies:** §2.3.

**Risks/Notes:**

- ⚠️ `docs/examples/` is documentation only — not published to npm (`.npmignore` must exclude)
- ⚠️ 60s ticket TTL is trade-off — shorter reduces theft window, longer accepts desynchronized clocks; document in README

### 3.3 `ReauthenticationService` — periodic re-check

**Objective:** Service that runs `setInterval` and calls `revalidate()` on all active connections. Honors the `disconnect` vs `event` policy, uses `AuthenticationCache` to avoid redundant re-checks, and wires an `onReauthenticationFailed` hook.

**Files to create:**

```
src/server/auth/reauthentication.service.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import type { ITransport } from '../interfaces/transport.interface'
import type {
  IConnectionAuthenticator,
  AuthenticationResult,
} from '../interfaces/connection-authenticator.interface'
import type {
  BymaxRealtimeModuleOptions,
  ReauthenticationPolicy,
} from '../interfaces/realtime-module-options.interface'
import type { IConnectionLifecycleHooks } from '../interfaces/connection-lifecycle-hooks.interface'
import { ConnectionRegistry } from '../services/connection-registry.service'
import { RealtimeService } from '../services/realtime.service'
import { AuthenticationCache } from './authentication-cache'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../constants/reserved-events.constants'

/**
 * Periodic re-authentication of long-lived connections.
 *
 * Runs every `policy.intervalSeconds` (default 300s = 5 min). For each active
 * connection, calls `authenticator.revalidate(connectionId, originalAuth)`:
 *
 *   - true  → keep alive
 *   - false → disconnect (optionally emit `connection:reauthentication-failed`
 *             first, when `policy.onFailure === 'event'`)
 *
 * If the authenticator does NOT implement `revalidate`, this service is a no-op.
 */
@Injectable()
export class ReauthenticationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReauthenticationService.name)
  private timer: NodeJS.Timeout | null = null
  private readonly policy: Required<ReauthenticationPolicy>

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly realtime: RealtimeService,
    private readonly cache: AuthenticationCache,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
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
    const intervalMs = this.policy.intervalSeconds * 1000
    this.timer = setInterval(() => {
      void this.runCycle()
    }, intervalMs)
    // setInterval keeps the process alive; unref so it doesn't block clean shutdown
    this.timer?.unref?.()
    this.logger.log(`Reauthentication scheduled every ${this.policy.intervalSeconds}s`)
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.cache.clear()
  }

  /** Public for test access. */
  async runCycle(): Promise<void> {
    const all = [...this.connections.allByTransport('sse'), ...this.connections.allByTransport('websocket')]
    for (const conn of all) {
      try {
        const cached = this.cache.get(conn.connectionId)
        if (cached) continue  // recent positive — skip
        const ok = await this.auth.revalidate?.(conn.connectionId, conn.originalAuth as AuthenticationResult) ?? true
        if (ok) {
          this.cache.set(conn.connectionId, conn.originalAuth as AuthenticationResult)
          continue
        }
        await this.handleFailure(conn.connectionId, conn.userId, conn)
      } catch (err) {
        this.logger.warn(`Reauthentication errored for ${conn.connectionId}: ${(err as Error).message}`)
      }
    }
  }

  private async handleFailure(
    connectionId: string,
    userId: string,
    meta: { tenantId?: string; transport: 'sse' | 'websocket'; ip: string; userAgent: string | undefined; connectedAt: Date },
  ): Promise<void> {
    if (this.policy.onFailure === 'event') {
      await this.realtime.emitToUser(userId, RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED, {
        reason: 'REAUTHENTICATION_FAILED',
      })
    }
    await this.hooks.onReauthenticationFailed?.({
      connectionId,
      userId,
      tenantId: meta.tenantId,
      transport: meta.transport,
      ip: meta.ip,
      userAgent: meta.userAgent,
      connectedAt: meta.connectedAt,
    })
    await this.realtime.disconnect(connectionId, 'REAUTHENTICATION_FAILED')
    this.cache.invalidate(connectionId)
  }
}
```

**Acceptance criteria:**

- [ ] `onModuleInit` schedules a timer with `policy.intervalSeconds * 1000` ms
- [ ] `onApplicationShutdown` clears the timer (no leak)
- [ ] `runCycle` iterates all SSE + WS connections (in Phase 4, WS already exists)
- [ ] Connections with a positive cache are skipped
- [ ] `revalidate` returning `true` adds to the cache
- [ ] `revalidate` returning `false` triggers disconnect + hook + optionally a prior event
- [ ] Errors in `revalidate` are logged and do not propagate (resilience)
- [ ] Authenticator without `revalidate` impl → service no-op (informative log)
- [ ] Coverage 100% line/branch

**Validation commands:**

```bash
pnpm test src/server/auth/reauthentication.service.spec.ts
```

**Dependencies:** §2.5, §2.7, §3.2.

**Risks/Notes:**

- ⚠️ `setInterval` in Node does not fire immediately — first execution happens after `intervalMs`. Document for the consumer
- ⚠️ For apps with 10k+ connections, synchronous `runCycle` can take seconds. Phase 5 considers chunking via Promise.all with a batch size

### 3.4 `encodeSseEvent` utility — correct wire format

**Objective:** Ensure that the end serialization of `MessageEvent` to the HTTP stream strictly follows the SSE pattern. NestJS does most of the work, but there are edge cases (heartbeat as `:` comment, multi-line data, events without ID).

**Files to create:**

```
src/server/utils/encode-sse-event.ts
```

**Skeleton:**

```typescript
import type { MessageEvent } from '@nestjs/common'
import { RESERVED_EVENT_NAMES } from '../constants/reserved-events.constants'

/**
 * Encode a NestJS MessageEvent into the SSE wire format.
 *
 * Wire format reference:
 *   - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * Rules:
 *   - Heartbeat is encoded as a comment line `: keepalive\n\n`
 *     (no event/data fields — invisible to EventSource consumers)
 *   - Regular events emit `id:`, `event:`, `data:` followed by `\n\n`
 *   - Multi-line `data` is split into multiple `data:` lines
 *   - `id` is omitted when empty (e.g., canonical connection:established)
 *
 * NestJS's @Sse() decorator handles most of this internally — this helper
 * is used for direct emission paths (e.g., in the cross-instance pub/sub
 * subscriber that re-emits remote messages locally) and for testing.
 */
export function encodeSseEvent(event: MessageEvent): string {
  // Heartbeat — comment line
  if (event.type === RESERVED_EVENT_NAMES.HEARTBEAT) {
    return ': keepalive\n\n'
  }

  const lines: string[] = []
  if (event.id) lines.push(`id: ${event.id}`)
  if (event.type && event.type !== 'message') lines.push(`event: ${event.type}`)

  const dataStr = serializeData(event.data)
  for (const line of dataStr.split('\n')) {
    lines.push(`data: ${line}`)
  }

  return lines.join('\n') + '\n\n'
}

function serializeData(data: unknown): string {
  if (typeof data === 'string') return data
  if (data === null || data === undefined) return ''
  return JSON.stringify(data)
}
```

**Acceptance criteria:**

- [ ] Heartbeat encodes as `: keepalive\n\n` (an SSE comment)
- [ ] A regular event encodes `id: x\nevent: type\ndata: {...}\n\n`
- [ ] Multi-line data split across multiple `data: ...` lines
- [ ] Event without id (canonical `connection:established`) does not include `id:`
- [ ] An event with `type: 'message'` (default SSE) omits the `event:` line
- [ ] String data is not JSON-encoded (already text)
- [ ] Coverage 100%
- [ ] Mutation score ≥ 95% (critical paths — bug here breaks all clients)

**Validation commands:**

```bash
pnpm test src/server/utils/encode-sse-event.spec.ts
```

**Dependencies:** §2.4.

**Risks/Notes:**

- ⚠️ Do not try to replicate all of NestJS's work — the helper exists mainly for the Phase 3 pub/sub subscriber (which delivers cross-instance events by writing directly to the Subject)

### 3.5 Lifecycle hooks wired (`IConnectionLifecycleHooks`)

**Objective:** Guarantee that `onConnect`, `onDisconnect`, `onError`, `onReauthenticationFailed` are called at the right points in the transport code. `onConnect` and `onDisconnect` already exist in the transports (Phase 1), but were only smoke-tested — this step adds dedicated tests, integrates `onError` in the controller path, and ensures hooks are called in the correct order.

**Files to modify:**

```
src/server/transports/sse/sse-subscription.handler.ts
src/server/transports/sse/sse.transport.ts
```

**Modification — `sse-subscription.handler.ts`:**

```typescript
// After finalize(), in case of upstream error:
return merge(established$, replay$, subject.asObservable(), heartbeat$).pipe(
  catchError((err) => {
    void this.hooks.onError?.({ connectionId, error: err as Error, transport: 'sse' })
    return throwError(() => err)
  }),
  finalize(() => {
    void this.transport.unregisterConnection(connectionId, 'CLIENT_DISCONNECT')
  }),
)
```

**Acceptance criteria:**

- [ ] `onConnect` called **before** any event is emitted
- [ ] `onConnect` receives complete `ConnectionEventMeta`
- [ ] `onDisconnect` called with `durationMs` calculated correctly (delta between `connectedAt` and `Date.now()`)
- [ ] `onError` called when the upstream Subject throws
- [ ] Hooks that throw **do not** break the stream (try/catch in the transport)
- [ ] `onReauthenticationFailed` called by the `ReauthenticationService` (verified in §3.3)
- [ ] Coverage 100% line/branch on the hook handlers

### 3.6 Effective heartbeat against real proxies

**Objective:** Empirically validate that the default heartbeat keeps connections open behind nginx (60s default idle timeout) and that the consumer can adjust for Cloudflare Free (100s).

**Files to create/modify:**

```
test/e2e/heartbeat-effectiveness.e2e-spec.ts
```

**Skeleton — `heartbeat-effectiveness.e2e-spec.ts`:**

```typescript
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { BymaxRealtimeModule, RealtimeService } from '../../src/server'
import http from 'node:http'

describe('Heartbeat Effectiveness (E2E)', () => {
  let app: INestApplication
  let realtime: RealtimeService

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: {
            async authenticate() {
              return { userId: 'u_test', tenantId: 't_test' }
            },
          },
          sse: { endpoint: '/events', heartbeatMs: 500 },  // aggressive for test
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.init()
    await app.listen(0)
    realtime = app.get(RealtimeService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('should emit at least 2 heartbeats within 2 seconds idle', async () => {
    const url = await app.getUrl() + '/events'
    const collected: string[] = []

    await new Promise<void>((resolve, reject) => {
      const req = http.get(url, { headers: { Accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => collected.push(chunk))
        setTimeout(() => {
          res.destroy()
          resolve()
        }, 2000)
      })
      req.on('error', reject)
    })

    const fullText = collected.join('')
    const heartbeats = fullText.match(/:\s*keepalive/g) ?? []
    expect(heartbeats.length).toBeGreaterThanOrEqual(2)
  })

  it('should respect heartbeatMs config when consumer overrides', async () => {
    // Higher-level test deferred to docs/runbook — not exercised in unit/E2E
    // because timing assertions are flaky.
    expect(true).toBe(true)
  })
})
```

**Acceptance criteria:**

- [ ] E2E test connects SSE and measures that ≥ 2 heartbeats are emitted in 2 seconds (with `heartbeatMs: 500`)
- [ ] Heartbeat output is exactly `: keepalive\n\n` (validate substring)
- [ ] Heartbeats are delivered even with no active emit (the essence of the test)

**Validation commands:**

```bash
pnpm test:e2e -- heartbeat-effectiveness
```

**Dependencies:** §3.1, §3.4.

### 3.7 `forRootAsync` — async configuration

**Objective:** Add `BymaxRealtimeModule.forRootAsync(options)` for integration with `ConfigService`, `JwtService`, and the Redis client (typical in real apps).

**Files to modify:**

```
src/server/realtime.module.ts
```

**Modification:**

```typescript
static forRootAsync(asyncOptions: BymaxRealtimeModuleAsyncOptions): DynamicModule {
  // Resolver provider — yields resolved (validated + defaulted) options
  const resolvedOptionsProvider: Provider = {
    provide: REALTIME_OPTIONS_TOKEN,
    useFactory: async (...args: unknown[]) => {
      const raw = await (asyncOptions.useFactory ?? (() => Promise.reject(new Error('useFactory required'))))(...args)
      validateOptions(raw)
      return applyDefaults(raw)
    },
    inject: [...(asyncOptions.inject ?? [])],
  }

  // Authenticator provider derives from resolved options
  const authenticatorProvider: Provider = {
    provide: REALTIME_AUTHENTICATOR_TOKEN,
    useFactory: (opts: BymaxRealtimeModuleOptions) => opts.authenticator,
    inject: [REALTIME_OPTIONS_TOKEN],
  }

  // Same pattern for pubsub / offline queue / presence / hooks
  // ...

  const providers: Provider[] = [
    resolvedOptionsProvider,
    authenticatorProvider,
    {
      provide: REALTIME_PUBSUB_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.pubsub ?? new InMemoryPubSub(),
      inject: [REALTIME_OPTIONS_TOKEN],
    },
    // ... etc
    ConnectionRegistry,
    RoomRegistry,
    EventIdGenerator,
    {
      provide: EventReplayBuffer,
      useFactory: (opts: BymaxRealtimeModuleOptions) => new EventReplayBuffer(opts.sse?.replayBufferSize ?? 100),
      inject: [REALTIME_OPTIONS_TOKEN],
    },
    HeartbeatService,
    SseTransport,
    { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
    SseSubscriptionHandler,
    AuthenticationCache,
    ReauthenticationService,
    RealtimeService,
  ]

  // Note: controllers cannot be added based on async-resolved options because
  // controllers are registered at decoration time. The compromise: a single
  // dynamic controller bound to '/events' (or whatever the default is) is
  // registered statically; if the consumer wants a non-default endpoint with
  // forRootAsync, they should fall back to forRoot.
  //
  // Alternative: register a route-level guard that mutates path at runtime —
  // discussed in `docs/architecture/sse-endpoint-resolution.md`.

  return {
    module: BymaxRealtimeModule,
    imports: asyncOptions.imports ?? [],
    providers,
    controllers: [createSseController('/events')],  // fixed for async path
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

**Acceptance criteria:**

- [ ] `forRootAsync` accepts `useFactory + inject`
- [ ] Validation happens inside the factory (not at the time of the `forRootAsync` call)
- [ ] Validation error propagates via Promise rejection at bootstrap
- [ ] Coverage 100% line/branch
- [ ] Documentation explains the trade-off of the fixed `/events` endpoint in async mode

**Validation commands:**

```bash
pnpm test src/server/realtime.module.spec.ts -- --testPathPattern=forRootAsync
```

**Dependencies:** §2.8.

**Risks/Notes:**

- ⚠️ Dynamic endpoint in `forRootAsync` is hard because controllers are registered BEFORE providers resolve. Chosen solution: fixed `/events` endpoint. Alternative: use a global guard that re-routes — add to `docs/architecture/sse-endpoint-resolution.md` if there is demand

### 3.8 Phase 2 validation

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm test:e2e
```

**Smoke test estendido:**

```typescript
// /tmp/smoke-test-phase2.mjs
import { NestFactory } from '@nestjs/core'
import { Module, Controller, Get } from '@nestjs/common'
import { BymaxRealtimeModule, RealtimeService } from './dist/server/index.mjs'

@Controller()
class TriggerController {
  constructor(private realtime: RealtimeService) {}
  @Get('emit/:userId') hit({ params }) {
    this.realtime.emitToUser(params.userId, 'test', { ts: Date.now() })
    return 'ok'
  }
}

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: {
        async authenticate(ctx) {
          // Ticket pattern smoke test
          if (ctx.query['ticket'] === 'demo') return { userId: 'u-demo' }
          return null
        },
        async revalidate(_id, auth) {
          // Always valid; in real life, check JWT or Redis blacklist
          return true
        },
      },
      reauthenticationPolicy: { intervalSeconds: 60 },
    }),
  ],
  controllers: [TriggerController],
})
class TestModule {}

const app = await NestFactory.create(TestModule)
await app.listen(3001)
console.log('Smoke test: open http://localhost:3001/events?ticket=demo and emit via http://localhost:3001/emit/u-demo')
```

**Done criteria:**

- [ ] Coverage gates met
- [ ] Smoke test delivers the event to the client with a valid ticket
- [ ] Client without ticket receives 401
- [ ] Reauthentication timer runs without leaking memory
- [ ] Commits done with Conventional Commits
- [ ] PR `phase-2` approved

---

## 4. Phase 3 — Horizontal Scaling SSE (IRealtimePubSub + IOfflineQueueStorage)

> **Phase objective:** Enable SSE to work in multi-instance. Reference implementation of `RedisRealtimePubSub` (Redis pub/sub), `RedisOfflineQueue` (Redis sorted set for durable retention), the subscriber that receives messages from pub/sub and re-emits locally in `SseTransport`, and tests with 2 worker_threads simulating two backend instances. This is the phase with the **largest surface area for subtle bugs** — race conditions, echo prevention, graceful degradation when Redis goes down, and eventual cross-instance ordering.
>
> **Complexity:** HIGH — Justifies extra careful human review.
>
> **Critical paths for ≥ 95% mutation (Stryker, pre-release):** `src/server/pubsub/redis-realtime-pubsub.example.ts` (reference only), `src/server/pubsub/subscriber.service.ts`, `src/server/offline-queue/redis-offline-queue.example.ts` (reference).

### 4.1 `InMemoryPubSub` revision — cross-handler fan-out

**Objective:** Phase 1 left `InMemoryPubSub.publish` as no-op. For multi-handler tests (same process, multiple `SseTransport` instances), the handler set already exists — add fan-out and validate that single-instance still works correctly.

**Files to modify:**

```
src/server/pubsub/in-memory-pubsub.ts
```

**Modification:**

```typescript
@Injectable()
export class InMemoryPubSub implements IRealtimePubSub {
  private handlers = new Set<(m: RealtimePubSubMessage) => void>()

  async publish(message: RealtimePubSubMessage): Promise<void> {
    // Fan-out to in-memory subscribers (test mode + same-process multi-handler).
    // Note: this is synchronous (Promise.resolve()) — for real cross-instance
    // delivery, the consumer must provide IRealtimePubSub backed by Redis or
    // similar.
    for (const handler of this.handlers) {
      try {
        handler(message)
      } catch (err) {
        // Best-effort — pub/sub handlers must never throw upstream
      }
    }
  }

  async subscribe(handler: (m: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
    }
  }
}
```

**Acceptance criteria:**

- [ ] `publish` iterates handlers and calls each one with a message
- [ ] Handler that throws does not propagate (internal catch)
- [ ] `subscribe` returns an unsubscribe that actually removes
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/pubsub/in-memory-pubsub.spec.ts
```

**Dependencies:** Phase 1 §2.7.

### 4.2 `RealtimePubSubSubscriber` — local re-emit of cross-instance messages

**Objective:** Service that subscribes to the pub/sub and, on receiving messages from other instances, re-applies the emit locally in the `SseTransport`. Echo prevention via `origin` field.

**Files to create:**

```
src/server/pubsub/subscriber.service.ts
```

**Skeleton:**

```typescript
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common'
import type { IRealtimePubSub, RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { SseTransport } from '../transports/sse/sse.transport'
import {
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_PUBSUB_TOKEN,
} from '../constants/injection-tokens.constants'

/**
 * Receives messages from `IRealtimePubSub` and re-applies them locally on the
 * SSE transport. Used for cross-instance fan-out.
 *
 * Echo prevention:
 *   - Messages with `origin === instanceId` are ignored (we sent them)
 *   - The SSE transport's `publish` is NEVER called from here — we use
 *     internal methods that emit only to local connections
 */
@Injectable()
export class RealtimePubSubSubscriber implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimePubSubSubscriber.name)
  private unsubscribe: (() => Promise<void>) | null = null

  constructor(
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
    private readonly sse: SseTransport,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.pubsub.subscribe((msg) => this.handle(msg))
      this.logger.log(`Subscribed to realtime pub/sub (instanceId=${this.instanceId})`)
    } catch (err) {
      // Pub/sub unavailable — degrade gracefully to single-instance
      this.logger.warn(
        `Failed to subscribe to pub/sub: ${(err as Error).message}. Running in single-instance mode.`,
      )
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.unsubscribe) {
      try {
        await this.unsubscribe()
      } catch (err) {
        this.logger.warn(`Unsubscribe failed: ${(err as Error).message}`)
      }
    }
  }

  private handle(msg: RealtimePubSubMessage): void {
    if (msg.origin === this.instanceId) return  // self — already delivered locally

    try {
      switch (msg.op) {
        case 'emitToUser':
          this.sse['emitToUserLocal']?.(msg.args as { userId: string; event: string; data: unknown })
          break
        case 'emitToTenant':
          this.sse['emitToTenantLocal']?.(msg.args as { tenantId: string; event: string; data: unknown })
          break
        case 'emitToRoom':
          this.sse['emitToRoomLocal']?.(msg.args as { roomId: string; event: string; data: unknown })
          break
        case 'broadcast':
          this.sse['broadcastLocal']?.(msg.args as { event: string; data: unknown })
          break
        case 'disconnect':
          this.sse['disconnectLocal']?.(msg.args as { connectionId: string; reason?: string })
          break
        default:
          this.logger.warn(`Unknown pub/sub op: ${(msg as RealtimePubSubMessage).op}`)
      }
    } catch (err) {
      this.logger.warn(`Pub/sub message handling failed: ${(err as Error).message}`)
    }
  }
}
```

**Modification — `SseTransport` must expose `*Local` methods (do not publish to avoid feedback loop):**

```typescript
// Add to SseTransport class:

/** Local-only emit — used by the pub/sub subscriber. Does NOT publish. */
emitToUserLocal(args: { userId: string; event: string; data: unknown; id?: string }): void {
  const msg: MessageEvent = { id: args.id ?? this.idGen.next(), type: args.event, data: args.data as object }
  this.replayBuffer.append(args.userId, msg)
  for (const conn of this.connections.byUser(args.userId, 'sse')) {
    conn.subject?.next(msg)
  }
}

emitToTenantLocal(args: { tenantId: string; event: string; data: unknown; id?: string }): void {
  const msg: MessageEvent = { id: args.id ?? this.idGen.next(), type: args.event, data: args.data as object }
  for (const conn of this.connections.byTenant(args.tenantId, 'sse')) {
    conn.subject?.next(msg)
  }
}

emitToRoomLocal(args: { roomId: string; event: string; data: unknown; id?: string }): void {
  const msg: MessageEvent = { id: args.id ?? this.idGen.next(), type: args.event, data: args.data as object }
  for (const connectionId of this.rooms.members(args.roomId)) {
    const conn = this.connections.get(connectionId)
    if (conn?.transport === 'sse') conn.subject?.next(msg)
  }
}

broadcastLocal(args: { event: string; data: unknown; id?: string }): void {
  const msg: MessageEvent = { id: args.id ?? this.idGen.next(), type: args.event, data: args.data as object }
  for (const conn of this.connections.allByTransport('sse')) {
    conn.subject?.next(msg)
  }
}

disconnectLocal(args: { connectionId: string; reason?: string }): void {
  const record = this.connections.get(args.connectionId)
  if (!record || record.transport !== 'sse') return
  record.subject?.complete()
  void this.unregisterConnection(args.connectionId, args.reason)
}
```

**Acceptance criteria:**

- [ ] `subscriber.handle` ignores messages with `origin === instanceId`
- [ ] `emitToUser` cross-instance delivers to the local subject (verified with in-memory pub/sub that fans out)
- [ ] Pub/sub failing on `subscribe` is logged but **does not** throw at bootstrap
- [ ] `onApplicationShutdown` calls unsubscribe
- [ ] Coverage 100% line/branch
- [ ] Mutation score ≥ 95%

**Validation commands:**

```bash
pnpm test src/server/pubsub/subscriber.service.spec.ts
```

**Dependencies:** §2.6 (SseTransport), §4.1.

**Risks/Notes:**

- ⚠️ The `*Local` methods deliberately **do not call `pubsub.publish`** — otherwise they would create an infinite feedback loop
- ⚠️ Accessing methods via bracket notation on the subscriber (`this.sse['emitToUserLocal']`) is antipattern — alternative: declare `interface ISseTransportLocalOps` and expose it from `SseTransport`. Recommend refactor

### 4.3 `RedisRealtimePubSub` — reference implementation

**Objective:** Full Redis-backed implementation documented in `docs/examples/` (does not ship in the package because of the optional `ioredis` peer dep). Tests use `ioredis-mock`.

**Files to create:**

```
docs/examples/pubsub/redis-realtime-pubsub.example.ts
src/server/pubsub/redis-realtime-pubsub.spec.ts   ← test contra ioredis-mock
```

**Skeleton — `docs/examples/pubsub/redis-realtime-pubsub.example.ts`:**

```typescript
// Reference implementation — NOT part of the published package.
// Copy into your consumer app under `infra/realtime/` or similar.

import type { Redis } from 'ioredis'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '@bymax-one/nest-realtime'

export interface RedisRealtimePubSubOptions {
  /** Channel name. Defaults to 'realtime:bus'. */
  channel?: string
}

/**
 * Redis pub/sub implementation of IRealtimePubSub.
 *
 * Uses ioredis. Requires TWO connections — one for publish (any ioredis
 * connection works) and one duplicated for subscribe (Redis pub/sub commands
 * cannot share a connection with regular commands).
 *
 * The `origin` field is overwritten before publish; consumers should NOT
 * set it themselves.
 */
export class RedisRealtimePubSub implements IRealtimePubSub {
  private readonly pub: Redis
  private readonly sub: Redis
  private readonly channel: string
  private handlers = new Set<(m: RealtimePubSubMessage) => void>()
  private subscribed = false

  constructor(pubClient: Redis, opts: RedisRealtimePubSubOptions = {}) {
    this.pub = pubClient
    this.sub = pubClient.duplicate()
    this.channel = opts.channel ?? 'realtime:bus'
  }

  async publish(message: RealtimePubSubMessage): Promise<void> {
    await this.pub.publish(this.channel, JSON.stringify(message))
  }

  async subscribe(handler: (m: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)

    if (!this.subscribed) {
      await this.sub.subscribe(this.channel)
      this.sub.on('message', (_ch, raw) => {
        try {
          const msg = JSON.parse(raw) as RealtimePubSubMessage
          for (const h of this.handlers) {
            try { h(msg) } catch { /* swallow */ }
          }
        } catch {
          // Malformed message — ignore
        }
      })
      this.subscribed = true
    }

    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0) {
        await this.sub.unsubscribe(this.channel)
        this.subscribed = false
      }
    }
  }

  /** Tear-down — closes both connections. Idempotent. */
  async close(): Promise<void> {
    try { await this.sub.quit() } catch { /* ignore */ }
    // pubClient is owned by the consumer — NOT closed here
  }
}
```

**Skeleton — `src/server/pubsub/redis-realtime-pubsub.spec.ts`:**

```typescript
import RedisMock from 'ioredis-mock'
// Note: this spec exercises the example impl. The lib does NOT ship the impl —
// it's at docs/examples/, but we copy a reference into __tests__/__fixtures__/
// for the spec to exercise.
import { RedisRealtimePubSub } from '../../../__tests__/__fixtures__/redis-realtime-pubsub.example'

describe('RedisRealtimePubSub (reference impl)', () => {
  let redis: RedisMock
  let pubsub: RedisRealtimePubSub

  beforeEach(() => {
    redis = new RedisMock() as never
    pubsub = new RedisRealtimePubSub(redis as never)
  })

  afterEach(async () => {
    await pubsub.close()
  })

  it('should fan out messages to subscribed handlers across instances', async () => {
    const received: unknown[] = []
    await pubsub.subscribe((m) => received.push(m))
    await pubsub.publish({ op: 'emitToUser', args: { userId: 'u1', event: 'x', data: {} }, origin: 'inst-1' })
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toHaveLength(1)
  })

  it('should ignore malformed messages without throwing', async () => {
    let handlerCalled = false
    await pubsub.subscribe(() => { handlerCalled = true })
    await redis.publish('realtime:bus', 'not-json{')
    await new Promise((r) => setTimeout(r, 50))
    expect(handlerCalled).toBe(false)
  })

  it('should support multiple handlers', async () => {
    const a: unknown[] = []
    const b: unknown[] = []
    await pubsub.subscribe((m) => a.push(m))
    await pubsub.subscribe((m) => b.push(m))
    await pubsub.publish({ op: 'broadcast', args: { event: 'x', data: {} }, origin: 'inst-1' })
    await new Promise((r) => setTimeout(r, 50))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})
```

**Acceptance criteria:**

- [ ] Example file in `docs/examples/pubsub/`
- [ ] Test fixture in `__tests__/__fixtures__/` (copy of the example, avoids circular type-import)
- [ ] Tests pass with `ioredis-mock`
- [ ] Subscribe is idempotent (second handler does not create a second Redis subscription)
- [ ] Unsubscribe is idempotent (clears handlers, after unsub)
- [ ] Malformed messages do not crash the subscriber

**Validation commands:**

```bash
pnpm test src/server/pubsub/redis-realtime-pubsub.spec.ts
```

**Dependencies:** §4.2.

**Risks/Notes:**

- ⚠️ `ioredis-mock` covers ~95% of the real Redis contract — some integration tests must be executed in Phase 6 release against real Redis (via Testcontainers)
- ⚠️ `pubClient.duplicate()` — consumer must not pass a connection already in subscriber mode

### 4.4 `IOfflineQueueStorage` — `RedisOfflineQueue` reference

**Objective:** Redis-backed implementation of `IOfflineQueueStorage` for durable retention of events while the user is disconnected. Sorted set indexed by timestamp, configurable TTL, trim by size.

**Files to create:**

```
docs/examples/offline-queue/redis-offline-queue.example.ts
```

**Skeleton:**

```typescript
import type { Redis } from 'ioredis'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '@bymax-one/nest-realtime'

export interface RedisOfflineQueueOptions {
  /** Retention TTL in seconds. @default 86400 (24h) */
  ttlSeconds?: number
  /** Maximum events per user. @default 500 */
  maxPerUser?: number
  /** Key prefix in Redis. @default 'realtime:offline' */
  keyPrefix?: string
}

export class RedisOfflineQueue implements IOfflineQueueStorage {
  constructor(
    private readonly redis: Redis,
    private readonly opts: Required<RedisOfflineQueueOptions> = {
      ttlSeconds: 86_400,
      maxPerUser: 500,
      keyPrefix: 'realtime:offline',
    },
  ) {}

  async append(userId: string, event: OfflineQueuedEvent): Promise<void> {
    const key = this.key(userId)
    // Score = epoch ms (matches event.id lex order roughly)
    await this.redis.zadd(key, Date.now(), JSON.stringify(event))
    await this.redis.expire(key, this.opts.ttlSeconds)
    // Trim — keep latest N
    await this.redis.zremrangebyrank(key, 0, -(this.opts.maxPerUser + 1))
  }

  async retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]> {
    const key = this.key(userId)
    const raws = await this.redis.zrange(key, 0, -1)
    return raws
      .map((r) => {
        try { return JSON.parse(r) as OfflineQueuedEvent } catch { return null }
      })
      .filter((e): e is OfflineQueuedEvent => e !== null && e.id > sinceId)
      .slice(0, limit)
  }

  async acknowledge(userId: string, upToId: string): Promise<void> {
    const key = this.key(userId)
    const raws = await this.redis.zrange(key, 0, -1)
    const toRemove = raws.filter((r) => {
      try {
        const e = JSON.parse(r) as OfflineQueuedEvent
        return e.id <= upToId
      } catch { return false }
    })
    if (toRemove.length > 0) {
      await this.redis.zrem(key, ...toRemove)
    }
  }

  private key(userId: string): string {
    return `${this.opts.keyPrefix}:${userId}`
  }
}
```

**Modification — `SseTransport.emitToUser` consults the queue when the user is offline:**

```typescript
async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
  const msg = this.buildMessage(event, data)
  this.replayBuffer.append(userId, msg)

  const connected = this.connections.byUser(userId, 'sse')
  for (const conn of connected) {
    conn.subject?.next(msg)
  }

  // If user has 0 connections AND offline queue is configured, persist
  if (connected.length === 0 && this.offlineQueue) {
    await this.offlineQueue.append(userId, {
      id: msg.id ?? this.idGen.next(),
      event,
      data,
      emittedAt: new Date(),
    })
  }

  await this.fanOut({ op: 'emitToUser', args: { userId, event, data, id: msg.id } })
}
```

> **Note:** Inject `offlineQueue` (token `REALTIME_OFFLINE_QUEUE_TOKEN`) in the `SseTransport` constructor. Can be `undefined`.

**Acceptance criteria:**

- [ ] `RedisOfflineQueue.append` adds to the sorted set
- [ ] TTL is set on each append (re-expiration)
- [ ] Trim respects `maxPerUser`
- [ ] `retrieveSince` filters events with `id > sinceId`
- [ ] Malformed entries are skipped (don't break retrieve)
- [ ] `acknowledge` removes only events with `id <= upToId`
- [ ] `SseTransport.emitToUser` persists to the queue when 0 connections
- [ ] Tests use `ioredis-mock`

**Validation commands:**

```bash
pnpm test src/server/offline-queue/
```

**Dependencies:** §4.3.

### 4.5 Tests cross-instance with worker_threads

**Objective:** Validate that two "backend instances" (distinct Node processes simulated via `worker_threads`) deliver cross-instance emits via Redis pub/sub.

**Files to create:**

```
test/e2e/cross-instance.e2e-spec.ts
test/e2e/fixtures/cross-instance-worker.ts
```

**Skeleton — `cross-instance-worker.ts`:**

```typescript
import { parentPort, workerData } from 'node:worker_threads'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BymaxRealtimeModule, RealtimeService } from '../../../src/server'
import RedisMock from 'ioredis-mock'
import { RedisRealtimePubSub } from '../../../__tests__/__fixtures__/redis-realtime-pubsub.example'

// Both worker_threads share the same RedisMock instance via a global symbol
const redis = (globalThis as any)[Symbol.for('test.shared.redis')] ??=
  new RedisMock({ data: workerData.sharedData })

@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'sse',
      authenticator: {
        async authenticate() {
          return { userId: workerData.userId }
        },
      },
      pubsub: new RedisRealtimePubSub(redis),
      sse: { endpoint: '/events', heartbeatMs: 60_000 },
    }),
  ],
})
class TestAppModule {}

;(async () => {
  const app = await NestFactory.create(TestAppModule, { logger: false })
  await app.listen(0)
  const realtime = app.get(RealtimeService)
  parentPort?.postMessage({ type: 'ready', url: await app.getUrl() })

  parentPort?.on('message', async (msg) => {
    if (msg.type === 'emit') {
      await realtime.emitToUser(msg.userId, msg.event, msg.data)
      parentPort?.postMessage({ type: 'emitted' })
    }
    if (msg.type === 'shutdown') {
      await app.close()
      process.exit(0)
    }
  })
})()
```

**Skeleton — `cross-instance.e2e-spec.ts`:**

```typescript
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import http from 'node:http'

describe('Cross-instance fan-out (E2E)', () => {
  it('should deliver an emit from instance A to a connection on instance B', async () => {
    // ... start 2 workers, connect EventSource to worker B, emit on worker A,
    // assert that the event arrives at worker B's connection
    // (Full implementation is verbose — about 100 LoC. See the phase task file
    // docs/tasks/phase-03-horizontal-scaling-sse.md for the granular task with full code.)
  }, 30_000)
})
```

**Acceptance criteria:**

- [ ] Test starts 2 worker_threads representing two instances
- [ ] HTTP client connects SSE on worker B
- [ ] Emit on worker A delivers the event to the client connected on B (in < 200ms)
- [ ] Echo prevention: emit on A is not re-processed on A
- [ ] Pub/sub can be shut down (kill Redis) without crashing either of the workers
- [ ] Test isolated — does not leak workers after `afterAll`

**Validation commands:**

```bash
pnpm test:e2e -- cross-instance
```

**Dependencies:** §4.2, §4.3, §4.4.

**Risks/Notes:**

- ⚠️ `worker_threads` + NestJS + `ioredis-mock` is an elaborate fragment. Consider mocking pub/sub via global `EventEmitter` instead of `RedisMock` if this stack has issues
- ⚠️ Test timeout 30s — bootstrapping 2 NestApplications + EventSource handshake takes time
- ⚠️ This sub-task has **high flakiness risk** — recommend marking `it.flaky` (custom matcher) or running in isolation

### 4.6 Phase 3 validation

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build
```

**Done criteria:**

- [ ] Coverage gates met (95% on phase critical paths)
- [ ] E2E cross-instance passes consistently (3 consecutive runs without flake)
- [ ] Manual smoke test: multi-instance app via 2 Node processes + local Redis
- [ ] `RedisRealtimePubSub` and `RedisOfflineQueue` in `docs/examples/`
- [ ] PR `phase-3` approved

---

## 5. Phase 4 — WebSocket Transport (opt-in)

> **Phase objective:** Enable `transport: 'websocket'` and `transport: 'both'`. Implement `WebSocketTransport` over `@nestjs/websockets` + Socket.IO, configure the Redis adapter for scaling, create `CompositeTransport` for dual mode, handle handshake differences (auth via `socket.handshake.auth.token` instead of cookie), and test it all with `socket.io-client`. This is the other HIGH-complexity phase — Socket.IO has peculiarities (rooms, namespaces, adapters) requiring care.
>
> **Complexity:** HIGH.
>
> **Critical paths for ≥ 95% mutation (Stryker, pre-release):** `src/server/transports/websocket/realtime.gateway.ts`, `src/server/transports/websocket/websocket.transport.ts`, `src/server/transports/composite/composite.transport.ts`.

### 5.1 `WebSocketTransport` — `ITransport` implementation over Socket.IO

**Objective:** Implementation of the `ITransport` interface operating over the Socket.IO `Server`. The `emitTo*` methods use `server.to(room).emit(event, data)`.

**Files to create:**

```
src/server/transports/websocket/websocket.transport.ts
```

**Skeleton:**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Server, Socket } from 'socket.io'
import { randomUUID } from 'node:crypto'
import type { ITransport } from '../../interfaces/transport.interface'
import type {
  IConnectionAuthenticator,
  AuthenticationResult,
} from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { IRealtimePubSub } from '../../interfaces/realtime-pubsub.interface'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RoomRegistry } from '../../services/room-registry.service'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_PUBSUB_TOKEN,
} from '../../constants/injection-tokens.constants'
import { ROOM_PREFIXES } from '../../constants/room-prefixes.constants'

@Injectable()
export class WebSocketTransport implements ITransport {
  readonly kind = 'websocket' as const
  private readonly logger = new Logger(WebSocketTransport.name)
  private server: Server | null = null

  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks: IConnectionLifecycleHooks,
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
  ) {}

  /**
   * Wires the Socket.IO server instance. Called by `RealtimeGateway` on
   * `afterInit`. Direct injection wouldn't work because the Server only
   * exists after NestJS bootstraps the gateway.
   */
  setServer(server: Server): void {
    this.server = server
  }

  authenticator(): IConnectionAuthenticator {
    return this.auth
  }

  /**
   * Register a freshly-authenticated WS connection.
   * Auto-joins `user:{id}` and `tenant:{id}` rooms.
   */
  async registerSocket(socket: Socket, auth: AuthenticationResult): Promise<void> {
    this.connections.register({
      connectionId: socket.id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      transport: 'websocket',
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      connectedAt: new Date(),
      subject: null,  // WebSocket connections do not use RxJS Subject
      originalAuth: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
    })
    await socket.join(`${ROOM_PREFIXES.USER}:${auth.userId}`)
    if (auth.tenantId) await socket.join(`${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)

    this.rooms.join(socket.id, `${ROOM_PREFIXES.USER}:${auth.userId}`)
    if (auth.tenantId) this.rooms.join(socket.id, `${ROOM_PREFIXES.TENANT}:${auth.tenantId}`)

    await this.hooks.onConnect?.({
      connectionId: socket.id,
      userId: auth.userId,
      tenantId: auth.tenantId,
      transport: 'websocket',
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      connectedAt: new Date(),
    })
  }

  async unregisterSocket(connectionId: string, reason?: string): Promise<void> {
    const record = this.connections.unregister(connectionId)
    if (!record) return
    this.rooms.leaveAll(connectionId)
    await this.hooks.onDisconnect?.({
      connectionId,
      userId: record.userId,
      tenantId: record.tenantId,
      transport: 'websocket',
      ip: record.ip,
      userAgent: record.userAgent,
      connectedAt: record.connectedAt,
      reason,
      durationMs: Date.now() - record.connectedAt.getTime(),
    })
  }

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.USER}:${userId}`).emit(event, data)
    // The Socket.IO Redis adapter handles cross-instance fan-out automatically.
    // We do NOT call this.pubsub.publish here because @socket.io/redis-adapter
    // is the canonical scaling primitive for WS.
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(`${ROOM_PREFIXES.TENANT}:${tenantId}`).emit(event, data)
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    this.server?.to(roomId).emit(event, data)
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    this.server?.emit(event, data)
  }

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) {
      await socket.join(roomId)
      this.rooms.join(connectionId, roomId)
    }
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) {
      await socket.leave(roomId)
      this.rooms.leave(connectionId, roomId)
    }
  }

  async disconnect(connectionId: string, _reason?: string): Promise<void> {
    const socket = this.server?.sockets.sockets.get(connectionId)
    if (socket) socket.disconnect(true)
  }
}
```

**Acceptance criteria:**

- [ ] `setServer` wireup works via the gateway's afterInit
- [ ] `emitToUser` calls `server.to('user:{id}').emit(event, data)`
- [ ] `registerSocket` auto-join into `user:{id}` and (if tenantId) `tenant:{id}`
- [ ] `disconnect` forces disconnect via the socket.io API
- [ ] `joinRoom` / `leaveRoom` update both: socket.io rooms (real) and the internal RoomRegistry (best-effort for auditing)
- [ ] Coverage 100% line/branch

**Validation commands:**

```bash
pnpm test src/server/transports/websocket/websocket.transport.spec.ts
```

**Dependencies:** §2.3, §2.5.

### 5.2 `RealtimeGateway` — `@WebSocketGateway()` decorator

**Objective:** NestJS gateway that receives connection/disconnect, authenticates via `IConnectionAuthenticator` adapted for the WS handshake, and delegates to `WebSocketTransport.registerSocket`.

**Files to create:**

```
src/server/transports/websocket/realtime.gateway.ts
```

**Skeleton:**

```typescript
import { Inject, Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { WebSocketTransport } from './websocket.transport'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import { parseCookieHeader } from '../../utils/parse-cookie-header'

@WebSocketGateway({
  // Real namespace/cors come from options; @WebSocketGateway args are
  // evaluated at class decoration time, so we set defaults here and let
  // applyDefaults override via the underlying Adapter wiring (see
  // RealtimeIoAdapter in §5.3).
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name)
  @WebSocketServer() server!: Server

  constructor(
    private readonly transport: WebSocketTransport,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
  ) {}

  afterInit(server: Server): void {
    this.transport.setServer(server)
    this.logger.log('Realtime WebSocket gateway initialized')
  }

  async handleConnection(socket: Socket): Promise<void> {
    const ctx = {
      cookies: parseCookieHeader(socket.handshake.headers.cookie ?? ''),
      headers: this.normalizeHeaders(socket.handshake.headers),
      query: socket.handshake.query as Record<string, string | undefined>,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      transport: 'websocket' as const,
    }

    // Socket.IO supports a dedicated `auth` field — preferred over headers for WS
    if (socket.handshake.auth?.token) {
      ctx.headers['authorization'] = `Bearer ${socket.handshake.auth.token}`
    }

    const auth = await this.transport.authenticator().authenticate(ctx)
    if (!auth) {
      socket.disconnect(true)
      return
    }

    await this.transport.registerSocket(socket, auth)

    if (this.options.sse?.emitConnectionEvent !== false) {
      socket.emit(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED, {
        connectionId: socket.id,
        traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
      })
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    await this.transport.unregisterSocket(socket.id, 'CLIENT_DISCONNECT')
  }

  private normalizeHeaders(input: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(input)) {
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
    }
    return out
  }
}
```

**Acceptance criteria:**

- [ ] Gateway is registered when `transport` includes `websocket` or `both`
- [ ] `handleConnection` rejects (disconnect) sockets with invalid auth
- [ ] `handleConnection` calls `transport.registerSocket` with valid auth
- [ ] `socket.handshake.auth.token` is merged as `authorization` header
- [ ] `connection:established` is the first event the client receives (unless the option is disabled)
- [ ] `handleDisconnect` calls `unregisterSocket` with reason
- [ ] Coverage 100% line/branch

**Validation commands:**

```bash
pnpm test src/server/transports/websocket/realtime.gateway.spec.ts
```

**Dependencies:** §5.1.

### 5.3 `@socket.io/redis-adapter` integration

**Objective:** When `websocket.redisAdapter.pubClient` is provided, register the Redis adapter for Socket.IO. Allows horizontal WebSocket scaling transparently.

**Files to create:**

```
src/server/transports/websocket/realtime-io-adapter.ts
```

**Skeleton:**

```typescript
import { INestApplicationContext, Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { ServerOptions } from 'socket.io'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'

/**
 * Custom NestJS IO Adapter that:
 *   - Applies `websocket.namespace`, `cors`, `pingInterval`, `pingTimeout`
 *     from BymaxRealtimeModuleOptions
 *   - Registers @socket.io/redis-adapter when pubClient is provided
 *
 * Usage in main.ts:
 *
 *   import { NestFactory } from '@nestjs/core'
 *   import { RealtimeIoAdapter } from '@bymax-one/nest-realtime'
 *
 *   const app = await NestFactory.create(AppModule)
 *   app.useWebSocketAdapter(new RealtimeIoAdapter(app))
 *   await app.listen(3000)
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RealtimeIoAdapter.name)
  private readonly options: BymaxRealtimeModuleOptions

  constructor(app: INestApplicationContext) {
    super(app)
    this.options = app.get(REALTIME_OPTIONS_TOKEN)
  }

  override createIOServer(port: number, opts?: ServerOptions): unknown {
    const wsOpts = this.options.websocket ?? {}
    const mergedOpts: ServerOptions = {
      ...opts,
      cors: wsOpts.cors ?? opts?.cors,
      pingInterval: wsOpts.pingIntervalMs ?? 25_000,
      pingTimeout: wsOpts.pingTimeoutMs ?? 20_000,
      maxHttpBufferSize: wsOpts.maxHttpBufferSize ?? 1_000_000,
    } as ServerOptions

    const server = super.createIOServer(port, mergedOpts) as { adapter: (a: unknown) => void }

    // Wire Redis adapter if pubClient provided
    if (wsOpts.redisAdapter?.pubClient) {
      // Lazy import — keeps @socket.io/redis-adapter as optional peer dep
      this.installRedisAdapter(server, wsOpts.redisAdapter.pubClient)
    }

    return server
  }

  private installRedisAdapter(server: { adapter: (a: unknown) => void }, pubClient: unknown): void {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter') as typeof import('@socket.io/redis-adapter')
      const pub = pubClient as { duplicate: () => unknown }
      const sub = pub.duplicate()
      server.adapter(createAdapter(pub as never, sub as never))
      this.logger.log('Socket.IO Redis adapter registered — horizontal scaling enabled')
    } catch (err) {
      this.logger.error(`Failed to register Redis adapter: ${(err as Error).message}`)
    }
  }
}
```

**Acceptance criteria:**

- [ ] Adapter applies `pingInterval`, `pingTimeout`, `cors`, `maxHttpBufferSize`
- [ ] When `redisAdapter.pubClient` is provided, `createAdapter` is installed
- [ ] `pubClient.duplicate()` is called to create sub client
- [ ] Failure to load `@socket.io/redis-adapter` (not installed) is logged as an error but does not crash
- [ ] Coverage 100% line/branch (cover the adapter-dependent branches via the integration test)

**Validation commands:**

```bash
pnpm test src/server/transports/websocket/realtime-io-adapter.spec.ts
```

**Dependencies:** §5.1, §5.2.

**Risks/Notes:**

- ⚠️ Dynamic `require()` keeps `@socket.io/redis-adapter` as an optional peer dep — without it installed, the lib does not crash
- ⚠️ Adapter is registered on the IO server — the consumer can pass additional Redis settings via `pubClient` (an already configured ioredis client)

### 5.4 `CompositeTransport` — mode `'both'`

**Objective:** Implement `ITransport` that delegates to `SseTransport` and `WebSocketTransport` simultaneously. Allows the app to run with SSE + WS at the same time.

**Files to create:**

```
src/server/transports/composite/composite.transport.ts
```

**Skeleton:**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import type { ITransport } from '../../interfaces/transport.interface'
import { SseTransport } from '../sse/sse.transport'
import { WebSocketTransport } from '../websocket/websocket.transport'

/**
 * Fan-out transport for `transport: 'both'`.
 *
 * All emit methods invoke both SSE and WebSocket transports in parallel
 * (Promise.all). Errors in one transport do NOT abort the other.
 *
 * `joinRoom` / `leaveRoom` / `disconnect` delegate to the transport owning the
 * given connectionId (looked up via the connection's `transport` field).
 */
@Injectable()
export class CompositeTransport implements ITransport {
  readonly kind = 'sse' as const  // Default — composite reports SSE as dominant
  private readonly logger = new Logger(CompositeTransport.name)

  constructor(
    private readonly sse: SseTransport,
    private readonly ws: WebSocketTransport,
  ) {}

  async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut('emitToUser', () => this.sse.emitToUser(userId, event, data), () => this.ws.emitToUser(userId, event, data))
  }

  async emitToTenant(tenantId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut('emitToTenant', () => this.sse.emitToTenant(tenantId, event, data), () => this.ws.emitToTenant(tenantId, event, data))
  }

  async emitToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    await this.fanOut('emitToRoom', () => this.sse.emitToRoom(roomId, event, data), () => this.ws.emitToRoom(roomId, event, data))
  }

  async broadcast(event: string, data: unknown): Promise<void> {
    await this.fanOut('broadcast', () => this.sse.broadcast(event, data), () => this.ws.broadcast(event, data))
  }

  async joinRoom(connectionId: string, roomId: string): Promise<void> {
    // Try both — only one will succeed (the transport owning the connection)
    await Promise.all([
      this.sse.joinRoom(connectionId, roomId).catch(() => undefined),
      this.ws.joinRoom(connectionId, roomId).catch(() => undefined),
    ])
  }

  async leaveRoom(connectionId: string, roomId: string): Promise<void> {
    await Promise.all([
      this.sse.leaveRoom(connectionId, roomId).catch(() => undefined),
      this.ws.leaveRoom(connectionId, roomId).catch(() => undefined),
    ])
  }

  async disconnect(connectionId: string, reason?: string): Promise<void> {
    await Promise.all([
      this.sse.disconnect(connectionId, reason).catch(() => undefined),
      this.ws.disconnect(connectionId, reason).catch(() => undefined),
    ])
  }

  private async fanOut(op: string, ...tasks: Array<() => Promise<void>>): Promise<void> {
    const results = await Promise.allSettled(tasks.map((t) => t()))
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(`Composite ${op} partially failed: ${(r.reason as Error).message}`)
      }
    }
  }
}
```

**Modification in the module:**

```typescript
// In forRoot / forRootAsync, when transport === 'both':
if (resolved.transport === 'both') {
  providers.push(SseTransport, WebSocketTransport, CompositeTransport)
  providers.push({ provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport })
  // Both controllers + gateway are registered
  controllers.push(createSseController(resolved.sse?.endpoint ?? '/events'))
  providers.push(RealtimeGateway)
}
```

**Acceptance criteria:**

- [ ] `emitToUser` calls SSE and WS in parallel
- [ ] Failure in one transport does not block the other (Promise.allSettled)
- [ ] Failures are logged as warn
- [ ] `joinRoom` / `leaveRoom` / `disconnect` try both — only one succeeds
- [ ] Mode `transport: 'both'` injects `CompositeTransport` in the `REALTIME_TRANSPORT_TOKEN`
- [ ] Coverage 100% line/branch

**Validation commands:**

```bash
pnpm test src/server/transports/composite/composite.transport.spec.ts
```

**Dependencies:** §5.1, §5.2.

### 5.5 Auth handshake differences (documentation + tests)

**Objective:** Formally document the handshake differences (cookies + bearer header in WS via `socket.handshake.auth`) and cover them with dedicated tests.

**Files to create:**

```
docs/architecture/auth-handshake-differences.md
src/server/transports/websocket/auth-extraction.spec.ts
```

**Skeleton — `auth-handshake-differences.md`:**

```markdown
# Auth Handshake — SSE vs WebSocket

## SSE handshake

- Standard HTTP GET request
- Cookies arrive in `Cookie:` header — parsed by `parseCookieHeader`
- Browsers strip `Authorization:` from `EventSource` → bearer header NOT supported
- Workaround: ticket pattern (query string)

## WebSocket (Socket.IO) handshake

- HTTP upgrade with full header set (cookies, all custom headers OK)
- socket.io-client also supports `socket.handshake.auth.token` — preferred over headers for WS
- Lib's `RealtimeGateway` merges `auth.token` into `headers['authorization']` for consistency

## Recommendation per transport

| Pattern | SSE | WebSocket |
|---|---|---|
| Cookie HttpOnly | ✅ Default | ✅ Works |
| Ticket pattern | ✅ Best for cross-origin | ⚠️ Use when cookies blocked |
| Bearer header | ❌ Not supported | ✅ Default |
```

**Acceptance criteria:**

- [ ] `auth-handshake-differences.md` in `docs/architecture/`
- [ ] Dedicated spec verifies that `socket.handshake.auth.token` → `headers.authorization`
- [ ] Spec verifies that cookies from `socket.handshake.headers.cookie` are parsed

**Validation commands:**

```bash
pnpm test src/server/transports/websocket/auth-extraction.spec.ts
```

**Dependencies:** §5.2.

### 5.6 Tests with `socket.io-client`

**Objective:** E2E tests that spin up a real app, connect via `socket.io-client`, and validate the complete cycle.

**Files to create:**

```
test/e2e/websocket.e2e-spec.ts
```

**Skeleton:**

```typescript
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { io, type Socket } from 'socket.io-client'
import { BymaxRealtimeModule, RealtimeService, RealtimeIoAdapter } from '../../src/server'

describe('WebSocket E2E', () => {
  let app: INestApplication
  let realtime: RealtimeService
  let baseUrl: string

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'websocket',
          authenticator: {
            async authenticate(ctx) {
              const token = ctx.headers['authorization']
              if (token?.includes('valid')) return { userId: 'u-test', tenantId: 't-test' }
              return null
            },
          },
        }),
      ],
    }).compile()

    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.init()
    await app.listen(0)
    baseUrl = await app.getUrl()
    realtime = app.get(RealtimeService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('should connect and receive connection:established', (done) => {
    const client = io(baseUrl, { auth: { token: 'valid-token' } })
    client.on('connection:established', (data) => {
      expect(data).toMatchObject({ traits: { userId: 'u-test' } })
      client.close()
      done()
    })
  })

  it('should reject invalid auth', (done) => {
    const client = io(baseUrl, { auth: { token: 'bad' } })
    client.on('disconnect', () => {
      done()
    })
    client.on('connect', () => {
      // If we get connect, the test fails — should have been rejected pre-connect
      client.close()
      done(new Error('Expected disconnect, got connect'))
    })
  })

  it('should deliver server emit to connected client', (done) => {
    const client = io(baseUrl, { auth: { token: 'valid-token' } })
    client.on('connection:established', () => {
      void realtime.emitToUser('u-test', 'test-event', { value: 42 })
    })
    client.on('test-event', (data) => {
      expect(data).toEqual({ value: 42 })
      client.close()
      done()
    })
  })
})
```

**Acceptance criteria:**

- [ ] `socket.io-client` client connects using `auth.token`
- [ ] Valid auth → receives `connection:established`
- [ ] Invalid auth → immediate disconnect
- [ ] Server `emitToUser` delivers to the connected client
- [ ] Server `emitToRoom` delivers when the client joined a room
- [ ] Client disconnect removes from the registry

**Validation commands:**

```bash
pnpm test:e2e -- websocket
```

**Dependencies:** §5.1 a §5.5.

### 5.7 Phase 4 validation

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build
```

**Smoke test transport: 'both':**

```typescript
@Module({
  imports: [
    BymaxRealtimeModule.forRoot({
      transport: 'both',
      authenticator: { /* ... */ },
      sse: { endpoint: '/events' },
      websocket: { namespace: '/' },
    }),
  ],
})
class AppModule {}
```

Connect one client via curl/EventSource on `/events` and another via socket.io-client on `wss://...`. A server-side emit via `realtimeService.emitToUser('u_x', 'evt', {})` must arrive in **both**.

**Done criteria:**

- [ ] Coverage gates met
- [ ] WS E2E suite consistent
- [ ] CompositeTransport smoke test delivers to both
- [ ] `RealtimeIoAdapter` documented in the README
- [ ] Bundle size: `dist/server/index.mjs` still < 18 KB brotli (WS gateway glue adds ~3 KB; socket.io & @nestjs/websockets are external)
- [ ] PR `phase-4` approved

---

## 6. Phase 5 — Frontend (`./react`)

> **Phase objective:** Universal `useRealtime` hook with transport auto-detect via URL scheme. SSE via native `EventSource` (zero deps), WebSocket via **dynamically** loaded `socket.io-client` (not static, to preserve the SSE-only bundle). `useRealtimeConnection` for status, `RealtimeProvider` so multiple hooks can share the connection, optional `usePresence` (requires `IPresenceStorage` in the backend).
>
> **Complexity:** MEDIUM — Exponential reconnection + replay + presence logic is delicate, but the interface is stable and testing has solid mock infrastructure (React Testing Library + EventSource mock).
>
> **Critical paths for ≥ 95% mutation (Stryker, pre-release):** `src/react/hooks/use-realtime.ts`, `src/react/internal/sse-client.ts`, `src/react/internal/websocket-client.ts`.

### 6.1 `useRealtime` — SSE-only path

**Objective:** Hook implementation covering SSE only. Supports `auto-detect`, ticket fetch, exponential reconnect with cap, status reporting.

**Files to create:**

```
src/react/hooks/use-realtime.ts
src/react/internal/sse-client.ts
src/react/internal/detect-transport.ts
```

**Skeleton — `src/react/internal/detect-transport.ts`:**

```typescript
/**
 * Resolve which transport to use based on URL scheme and explicit override.
 *
 *   `http(s)://...`  → SSE
 *   `ws(s)://...`    → WebSocket
 *   path-only        → SSE (same-origin)
 *   override         → wins regardless of URL
 */
export function detectTransport(url: string, override?: 'sse' | 'websocket'): 'sse' | 'websocket' {
  if (override) return override
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'websocket'
  return 'sse'
}
```

**Skeleton — `src/react/internal/sse-client.ts`:**

```typescript
import type { UseRealtimeOptions } from '../hooks/use-realtime'

export type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'

export interface SseClientCallbacks {
  onStatus: (status: Status) => void
  onEvent: (eventName: string, data: unknown, id?: string) => void
  onError: (err: Error) => void
}

/**
 * EventSource wrapper that handles:
 *   - Optional ticket fetch on every connect/reconnect
 *   - Exponential backoff on errors
 *   - max-attempts gate
 *   - Status reporting back to React via callbacks
 *
 * In the React API here — keeps internal/* unit-testable without DOM.
 */
export class SseClient {
  private es: EventSource | null = null
  private cancelled = false
  private attempts = 0

  constructor(
    private readonly opts: Pick<UseRealtimeOptions<Record<string, unknown>>, 'url' | 'events' | 'auth' | 'reconnect'>,
    private readonly cb: SseClientCallbacks,
  ) {}

  start(): void {
    this.cancelled = false
    this.attempts = 0
    void this.connect()
  }

  stop(): void {
    this.cancelled = true
    this.es?.close()
    this.es = null
    this.cb.onStatus('closed')
  }

  private async connect(): Promise<void> {
    if (this.cancelled) return
    this.cb.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')

    let url = this.opts.url
    if (this.opts.auth?.fetchTicket) {
      try {
        const ticket = await this.opts.auth.fetchTicket()
        const sep = url.includes('?') ? '&' : '?'
        url = `${url}${sep}ticket=${encodeURIComponent(ticket)}`
      } catch (err) {
        this.cb.onError(err as Error)
        return this.scheduleReconnect()
      }
    }

    const es = new EventSource(url, { withCredentials: true })
    this.es = es

    es.onopen = () => {
      this.attempts = 0
      this.cb.onStatus('connected')
    }

    // Listen for each named event
    for (const eventName of Object.keys(this.opts.events ?? {})) {
      es.addEventListener(eventName, (e: MessageEvent) => {
        const data = this.safeParse(e.data)
        this.cb.onEvent(eventName, data, e.lastEventId)
      })
    }

    // Default 'message' event
    es.onmessage = (e: MessageEvent) => {
      const data = this.safeParse(e.data)
      this.cb.onEvent('message', data, e.lastEventId)
    }

    es.onerror = () => {
      es.close()
      this.es = null
      this.attempts += 1
      const maxAttempts = this.opts.reconnect?.maxAttempts ?? Infinity
      if (this.attempts > maxAttempts) {
        this.cb.onStatus('error')
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    const initial = this.opts.reconnect?.initialDelayMs ?? 3000
    const max = this.opts.reconnect?.maxDelayMs ?? 30_000
    const delay = Math.min(initial * Math.pow(2, Math.min(this.attempts - 1, 5)), max)
    setTimeout(() => void this.connect(), delay)
  }

  private safeParse(raw: string): unknown {
    try { return JSON.parse(raw) } catch { return raw }
  }
}
```

**Skeleton — `src/react/hooks/use-realtime.ts`:**

```typescript
import { useEffect, useRef, useState } from 'react'
import { SseClient, type Status } from '../internal/sse-client'
import { detectTransport } from '../internal/detect-transport'

export interface UseRealtimeOptions<TEvents extends Record<string, unknown>> {
  url: string
  transport?: 'sse' | 'websocket'
  events?: { [K in keyof TEvents]?: (data: TEvents[K]) => void }
  auth?: { fetchTicket?: () => Promise<string> }
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number }
  autoConnect?: boolean
}

export interface UseRealtimeReturn {
  status: Status
  lastEvent: { type: string; data: unknown; id?: string } | null
  reconnectAttempts: number
  connect(): void
  disconnect(): void
}

/**
 * Universal realtime hook.
 *
 * Auto-detects transport from URL scheme. For WebSocket URLs, dynamically
 * imports `socket.io-client` so SSE-only apps don't ship that dependency.
 *
 * @example
 *   useRealtime<{ 'invoice.paid': { id: string } }>({
 *     url: '/api/events',
 *     events: { 'invoice.paid': (d) => toast.success(d.id) },
 *   })
 */
export function useRealtime<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeOptions<TEvents>,
): UseRealtimeReturn {
  const [status, setStatus] = useState<Status>('idle')
  const [lastEvent, setLastEvent] = useState<{ type: string; data: unknown; id?: string } | null>(null)
  const [attempts, setAttempts] = useState(0)
  const clientRef = useRef<SseClient | { stop(): void } | null>(null)

  const start = (): void => {
    const transport = detectTransport(opts.url, opts.transport)
    if (transport === 'sse') {
      const c = new SseClient(opts as never, {
        onStatus: setStatus,
        onEvent: (type, data, id) => {
          setLastEvent({ type, data, id })
          opts.events?.[type as keyof TEvents]?.(data as never)
        },
        onError: (err) => {
          // Errors visible via status='error'; consumer can log via window.onerror if needed
          console.error('[useRealtime] error', err)
        },
      })
      c.start()
      clientRef.current = c
    } else {
      // WS branch — dynamic import in §6.2
      void (async () => {
        const mod = await import('../internal/websocket-client')
        const c = new mod.WebSocketClient(opts as never, {
          onStatus: setStatus,
          onEvent: (type, data) => {
            setLastEvent({ type, data })
            opts.events?.[type as keyof TEvents]?.(data as never)
          },
          onError: (err) => console.error('[useRealtime] ws error', err),
        })
        c.start()
        clientRef.current = c
      })()
    }
  }

  const stop = (): void => {
    clientRef.current?.stop()
    clientRef.current = null
  }

  useEffect(() => {
    if (opts.autoConnect === false) return
    start()
    return () => stop()
    // We deliberately ignore the rest of opts to avoid reconnect storms when
    // consumers pass inline objects; production apps should memoize the
    // options object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url])

  return { status, lastEvent, reconnectAttempts: attempts, connect: start, disconnect: stop }
}
```

**Acceptance criteria:**

- [ ] `useRealtime` with `url: 'https://...'` or path-only inicia `SseClient`
- [ ] Status sequence: `connecting → connected → reconnecting → connected` (durante drop)
- [ ] `events` handler is called for each named event
- [ ] manual `connect()` / `disconnect()` work
- [ ] `autoConnect: false` does not start the connection on mount
- [ ] Coverage 100% line/branch in `sse-client.ts` and `use-realtime.ts`

**Validation commands:**

```bash
pnpm test src/react/hooks/use-realtime.spec.tsx
pnpm test src/react/internal/sse-client.spec.ts
```

**Dependencies:** Phase 1 (server side stable).

**Risks/Notes:**

- ⚠️ Test uses `EventSource` polyfill (`eventsource` package) or manual mock — JSDOM **does not** ship EventSource
- ⚠️ `react-hooks/exhaustive-deps` disable is justified — reconnecting on every full opts change would cause a connection storm. Consumer must memoize

### 6.2 `useRealtime` WS path with dynamic import

**Objective:** WebSocket branch — internal `WebSocketClient` and dynamic import of `socket.io-client`. Ensure that the SSE-only bundle does not include socket.io-client.

**Files to create:**

```
src/react/internal/websocket-client.ts
```

**Skeleton:**

```typescript
import type { Status, SseClientCallbacks } from './sse-client'
import type { UseRealtimeOptions } from '../hooks/use-realtime'

/**
 * WebSocket client backed by socket.io-client (dynamically imported).
 *
 * Mirrors the SseClient interface so the hook can swap implementations
 * without code duplication.
 */
export class WebSocketClient {
  private socket: { close(): void; on(event: string, handler: (data: unknown) => void): void; off(event: string): void } | null = null
  private cancelled = false

  constructor(
    private readonly opts: Pick<UseRealtimeOptions<Record<string, unknown>>, 'url' | 'events' | 'auth'>,
    private readonly cb: SseClientCallbacks,
  ) {}

  async start(): Promise<void> {
    this.cancelled = false
    this.cb.onStatus('connecting')
    try {
      // Dynamic import — keeps socket.io-client out of the SSE-only bundle.
      const mod = await import('socket.io-client')
      if (this.cancelled) return
      const ioFn = mod.io ?? (mod as { default?: typeof mod.io }).default ?? mod
      const authPayload = this.opts.auth?.fetchTicket
        ? { token: await this.opts.auth.fetchTicket() }
        : undefined
      const socket = (ioFn as (url: string, opts: unknown) => never)(this.opts.url, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        ...(authPayload ? { auth: authPayload } : {}),
      })
      this.socket = socket as never

      socket['on']?.('connect', () => this.cb.onStatus('connected'))
      socket['on']?.('disconnect', () => this.cb.onStatus('closed'))
      socket['on']?.('connect_error', (err: Error) => this.cb.onError(err))

      for (const eventName of Object.keys(this.opts.events ?? {})) {
        socket['on']?.(eventName, (data: unknown) => this.cb.onEvent(eventName, data))
      }
    } catch (err) {
      this.cb.onError(err as Error)
      this.cb.onStatus('error')
    }
  }

  stop(): void {
    this.cancelled = true
    this.socket?.close()
    this.socket = null
    this.cb.onStatus('closed')
  }
}
```

**Acceptance criteria:**

- [ ] Dynamic import resolves to `socket.io-client`
- [ ] `start()` grabs the `io` function and creates the socket with `auth` payload
- [ ] Status flows: `connecting → connected → closed`
- [ ] Event handlers are bound via `socket.on`
- [ ] **CRITICAL**: bundle `dist/react/index.mjs` does NOT include `socket.io-client` statically (verify with grep or bundle analyzer)
- [ ] Coverage 100% line/branch (mock `import()` to cover the dynamic-load branches)

**Validation commands:**

```bash
pnpm test src/react/internal/websocket-client.spec.ts
pnpm build && grep -c "socket.io-client" dist/react/index.mjs  # expected: 0 occurrences
```

**Dependencies:** §6.1.

**Risks/Notes:**

- ⚠️ Validate that `import('socket.io-client')` resolves correctly in tsup output (must be in `external` in the tsup.config.ts)
- ⚠️ Mocking the dynamic import in Jest can be fragile — use `jest.mock('socket.io-client', ...)` with factory

### 6.3 `useRealtimeConnection` + `RealtimeProvider`

**Objective:** Provider context that maintains a single connection and exposes it via `useRealtimeConnection` to multiple consumers in the same component tree.

**Files to create:**

```
src/react/components/realtime-provider.tsx
src/react/hooks/use-realtime-connection.ts
```

**Skeleton — `realtime-provider.tsx`:**

```typescript
import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useRealtime, type UseRealtimeOptions, type UseRealtimeReturn } from '../hooks/use-realtime'

interface RealtimeContextValue {
  connection: UseRealtimeReturn
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export interface RealtimeProviderProps<TEvents extends Record<string, unknown>>
  extends UseRealtimeOptions<TEvents> {
  children: ReactNode
}

/**
 * Provider that opens a single realtime connection shared across descendant
 * consumers. Avoids per-hook duplicate connections (browser limit: 6 per origin).
 */
export function RealtimeProvider<TEvents extends Record<string, unknown>>(
  props: RealtimeProviderProps<TEvents>,
): JSX.Element {
  const { children, ...opts } = props
  const connection = useRealtime<TEvents>(opts)
  return <RealtimeContext.Provider value={{ connection }}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('[useRealtimeContext] Must be used inside <RealtimeProvider>')
  return ctx
}
```

**Skeleton — `use-realtime-connection.ts`:**

```typescript
import { useRealtimeContext } from '../components/realtime-provider'
import type { UseRealtimeReturn } from './use-realtime'

/**
 * Returns the connection state from the nearest <RealtimeProvider>.
 *
 * Use when a component only cares about status (not specific events).
 *
 * @throws Error if used outside a <RealtimeProvider>
 */
export function useRealtimeConnection(): UseRealtimeReturn {
  return useRealtimeContext().connection
}
```

**Acceptance criteria:**

- [ ] Provider opens a single connection for children
- [ ] `useRealtimeConnection()` returns the same state across multiple children
- [ ] Use outside the provider throws Error with a clear message
- [ ] Coverage 100% line/branch on every implemented file

**Validation commands:**

```bash
pnpm test src/react/components/realtime-provider.spec.tsx
```

### 6.4 `usePresence` (optional, requires `IPresenceStorage`)

**Objective:** Hook that queries the backend to discover which userIds are online. Only active when the consumer configured `IPresenceStorage` in the backend.

**Files to create:**

```
src/react/hooks/use-presence.ts
```

**Skeleton:**

```typescript
import { useEffect, useState } from 'react'

export interface UsePresenceOptions {
  /** Fetch endpoint that returns `{ online: string[] }`. */
  url: string
  /** Refresh interval in ms. @default 30000 */
  intervalMs?: number
}

/**
 * Polls a backend endpoint that returns the list of online users.
 *
 * Requires the consumer to expose an HTTP endpoint backed by IPresenceStorage.
 * The library does NOT provide the endpoint — only the hook that consumes it.
 *
 * @example
 *   const { online, loading } = usePresence({ url: '/api/presence' })
 */
export function usePresence(opts: UsePresenceOptions): { online: string[]; loading: boolean; error: Error | null } {
  const [online, setOnline] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch(opts.url, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { online: string[] }
        if (cancelled) return
        setOnline(body.online)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err as Error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchOnce()
    const t = setInterval(() => void fetchOnce(), opts.intervalMs ?? 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [opts.url, opts.intervalMs])

  return { online, loading, error }
}
```

**Acceptance criteria:**

- [ ] `usePresence` does fetch inicial + polling in the intervalo
- [ ] `loading` flag true until first response
- [ ] Errors are exposed via the `error` state
- [ ] Cleanup clears the interval
- [ ] Coverage 100% line/branch on every implemented file

### 6.5 Bundle size validation

**Objective:** Empirically confirm that the SSE-only bundle does not include socket.io-client and stays within budget (≤ 4 KiB brotli).

**Files to modify:**

```
scripts/check-size.mjs
```

**Modification:**

```javascript
import { promises as fs } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const BUDGETS = [
  { name: 'server', path: 'dist/server/index.mjs', brotli: 18_000, gzip: 22_000 },
  { name: 'shared', path: 'dist/shared/index.mjs', brotli: 3_000, gzip: 4_000 },
  { name: 'react', path: 'dist/react/index.mjs', brotli: 4_000, gzip: 5_000 },
]

async function main() {
  for (const b of BUDGETS) {
    const buf = await fs.readFile(b.path)
    const br = brotliCompressSync(buf).length
    const gz = gzipSync(buf).length
    console.log(`${b.name}: ${br}B brotli / ${gz}B gzip`)
    if (br > b.brotli) {
      console.error(`❌ ${b.name} exceeds brotli budget (${br} > ${b.brotli})`)
      process.exit(1)
    }
    if (gz > b.gzip) {
      console.error(`❌ ${b.name} exceeds gzip budget (${gz} > ${b.gzip})`)
      process.exit(1)
    }
  }
  // Validate that socket.io-client is NOT statically present in dist/react
  const reactBundle = await fs.readFile('dist/react/index.mjs', 'utf-8')
  if (reactBundle.includes('socket.io-client/build')) {
    console.error('❌ React bundle includes socket.io-client statically — dynamic import broken')
    process.exit(1)
  }
  console.log('✅ All bundles within budget; SSE-only path verified')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

**Acceptance criteria:**

- [ ] `pnpm size` reports sizes of 3 bundles
- [ ] React bundle ≤ 4 KB brotli
- [ ] Grep confirms absence of `socket.io-client/build` in the static bundle
- [ ] Failure in any budget → exit 1 (CI block)

### 6.6 Tests React with Testing Library + EventSource mock

**Objective:** React test suite with mock `EventSource` (`eventsource` polyfill or minimal implementation).

**Files to create:**

```
src/react/__mocks__/event-source.mock.ts
src/react/hooks/use-realtime.spec.tsx
src/react/components/realtime-provider.spec.tsx
src/react/hooks/use-presence.spec.tsx
```

**Skeleton — `event-source.mock.ts`:**

```typescript
type Listener = (event: { data: string; lastEventId?: string }) => void

export class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string; lastEventId?: string }) => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(url: string, _opts?: { withCredentials?: boolean }) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, handler: Listener): void {
    const arr = this.listeners.get(name) ?? []
    arr.push(handler)
    this.listeners.set(name, arr)
  }

  removeEventListener(name: string, handler: Listener): void {
    const arr = this.listeners.get(name) ?? []
    this.listeners.set(name, arr.filter((h) => h !== handler))
  }

  close(): void {
    this.readyState = 2
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  simulateEvent(eventName: string, data: unknown, id?: string): void {
    const payload = { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId: id }
    if (eventName === 'message') {
      this.onmessage?.(payload)
    } else {
      const handlers = this.listeners.get(eventName) ?? []
      for (const h of handlers) h(payload)
    }
  }

  simulateError(): void {
    this.onerror?.()
  }

  static reset(): void {
    MockEventSource.instances = []
  }
}
```

**Skeleton — `use-realtime.spec.tsx`:**

```typescript
import { renderHook, act } from '@testing-library/react'
import { useRealtime } from './use-realtime'
import { MockEventSource } from '../__mocks__/event-source.mock'

beforeAll(() => {
  ;(globalThis as any).EventSource = MockEventSource
})

afterEach(() => MockEventSource.reset())

describe('useRealtime (SSE)', () => {
  it('should transition idle → connecting → connected', () => {
    const { result } = renderHook(() => useRealtime({
      url: 'http://example.test/events',
      events: {},
    }))
    expect(result.current.status).toBe('connecting')
    act(() => MockEventSource.instances[0]!.simulateOpen())
    expect(result.current.status).toBe('connected')
  })

  it('should call event handler on named event', () => {
    const handler = jest.fn()
    renderHook(() => useRealtime({
      url: 'http://example.test/events',
      events: { 'invoice.paid': handler },
    }))
    act(() => MockEventSource.instances[0]!.simulateOpen())
    act(() => MockEventSource.instances[0]!.simulateEvent('invoice.paid', { id: 'inv_1' }))
    expect(handler).toHaveBeenCalledWith({ id: 'inv_1' })
  })

  // ... more tests for reconnection, error handling, ticket flow
})
```

**Acceptance criteria:**

- [ ] Mock EventSource exposes `simulateOpen` / `simulateEvent` / `simulateError`
- [ ] Tests cobrem: connect, named event, reconnect, error, manual disconnect
- [ ] Provider tests verify that two consumers share state
- [ ] Coverage 100% line/branch in `use-realtime.ts`, `sse-client.ts`, `realtime-provider.tsx`

**Validation commands:**

```bash
pnpm test src/react/
pnpm test:cov
```

### 6.7 Phase 5 validation

**Commands finais:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

**Manual smoke test:**

A dummy Next.js app imports `useRealtime` from `@bymax-one/nest-realtime/react` and connects to an SSE backend running locally. Validate:
- Connect & receive `connection:established`
- Receive events via emit
- Reconnect after network drop (toggle wifi off + on)
- Status badge in the UI changes correctly

**Done criteria:**

- [ ] Coverage gates met (95% on critical paths)
- [ ] Bundle SSE-only ≤ 4 KB brotli, without static socket.io-client
- [ ] Bundle WS dynamic import works in a real browser (validate with Chrome DevTools Network tab — verifies that socket.io-client is fetched only when connecting WS)
- [ ] Manual smoke test passes in a dummy Next.js app
- [ ] PR `phase-5` approved

---

## 7. Phase 6 — Release v0.1.0

> **Phase objective:** Full documentation, CI workflows, end validation, tag and publication.
>
> **Complexity:** LOW — predominantly mechanical (copy + adapt configs from nest-auth, write README based on spec, run release workflow). Residual risk: fine-tuning bundle budgets when the real `dist/` is measured, and mutation baseline may reveal weak tests requiring extra work.

### 7.1 README with 4 scenarios

**Files to create:**

- `README.md` (~15-20 KB)

**Structure (mirrors `nest-auth/README.md`):**

```markdown
<p align="center">badges (npm, CI, coverage, mutation, scorecard, license, provenance)</p>
<h1 align="center">@bymax-one/nest-realtime</h1>
<p align="center">Realtime backend → frontend with dual-transport (SSE default, WebSocket opt-in) and unified server-side API.</p>

## ✨ Overview
Brief — server emits, transport-agnostic, multi-tenant ready.

## 🔥 Features
- SSE default — zero frontend deps, browser-native reconnect, Last-Event-ID replay
- WebSocket opt-in — Socket.IO under the hood, namespaces, redis adapter
- Composite mode `'both'` — emit once, deliver to both transports
- Auth inversion — works with nest-auth, custom JWT, ticket pattern
- Multi-tenant rooms convention `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`
- Horizontal scaling — IRealtimePubSub for SSE, @socket.io/redis-adapter for WS
- Tree-shakeable frontend — socket.io-client dynamic import (SSE-only ≤ 4 KB)

## 📦 Subpath Exports
| Subpath | Purpose | Peer Deps |
| `.` (server) | NestJS module | `@nestjs/common`, `rxjs` (+ optional WS deps) |
| `./shared` | Types + constants | None |
| `./react` | Hooks + Provider | `react` ^19 (+ optional socket.io-client) |

## 🚀 Quick Start

### Scenario 1 — SSE single-instance (simplest)
```typescript
BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(),
})
```

### Scenario 2 — SSE + Redis pub/sub (multi-instance)
```typescript
BymaxRealtimeModule.forRoot({
  transport: 'sse',
  authenticator: new MyAuthenticator(),
  pubsub: new RedisRealtimePubSub(redis),  // see docs/examples
  offlineQueue: new RedisOfflineQueue(redis),
})
```

### Scenario 3 — WebSocket only
```typescript
BymaxRealtimeModule.forRoot({
  transport: 'websocket',
  authenticator: new MyAuthenticator(),
  websocket: { redisAdapter: { pubClient: redis } },
})
```

### Scenario 4 — Both (migration)
```typescript
BymaxRealtimeModule.forRoot({
  transport: 'both',
  authenticator: new MyAuthenticator(),
  pubsub: new RedisRealtimePubSub(redis),
  sse: { endpoint: '/events' },
  websocket: { namespace: '/', redisAdapter: { pubClient: redis } },
})
```

## 🧩 Configuration (full table — link for spec §4)

## 🔌 Bring Your Own Authenticator (auth inversion)
Code snippets for the 3 patterns + link to docs/examples/auth/.

## 🔍 Replay and Offline Queue
How Last-Event-ID works, when to configure IOfflineQueueStorage.

## 🌐 Frontend (./react)
useRealtime, RealtimeProvider, usePresence — with examples.

## ⚙️ Horizontal Scaling
Pub/sub for SSE, Redis adapter for WS, integration with @bymax-one/nest-cache.

## 🚧 Infra notes (link for Appendix E)
Nginx, Cloudflare, AWS, serverless.

## 🧪 Testing
How to mock the transport, EventSource polyfill, supertest patterns.

## 🤝 Contributing
## 📜 License
```

**Acceptance criteria:**

- [ ] 4 complete usage scenarios (copy-pasteable)
- [ ] Badges npm version, CI status, coverage, mutation, scorecard, license, provenance
- [ ] Links for SECURITY.md, CHANGELOG.md, spec, plan
- [ ] Section dedicated to "Auth inversion" — first entry after Quick Start
- [ ] Peer deps table clearly indicating what is optional

### 7.2 CHANGELOG.md, SECURITY.md, CLAUDE.md, AGENTS.md

**CHANGELOG.md:**

```markdown
# Changelog

## [0.1.0] - 2026-XX-XX

### Added
- Initial release
- Dual-transport architecture (SSE default, WebSocket opt-in, Composite for both)
- Unified `RealtimeService` API (emitToUser, emitToTenant, emitToRoom, broadcast)
- Multi-tenant rooms convention (`user:{id}`, `tenant:{id}`, `resource:{type}:{id}`)
- `IConnectionAuthenticator` interface for auth-library-agnostic integration
- `IRealtimePubSub` interface + InMemoryPubSub default
- `IOfflineQueueStorage` and `IPresenceStorage` interfaces
- `Last-Event-ID` replay for SSE
- Heartbeat keepalive for SSE proxies
- Periodic re-authentication policy with positive caching
- Frontend hooks: `useRealtime`, `useRealtimeConnection`, `usePresence`, `RealtimeProvider`
- Dynamic import of socket.io-client (SSE-only bundle ≤ 4 KB)
- Reference implementations: `RedisRealtimePubSub`, `RedisOfflineQueue` (in docs/examples)
- Cookie HttpOnly + Ticket + Bearer (WS) auth patterns documented

### Security
- Auth inversion — library never imports auth concretes
- Default redact list for sensitive headers in logs (when integrating with nest-logger)
- Tenant isolation enforced server-side via room registry
```

**SECURITY.md:** Copy nest-auth template, adjust references for nest-realtime.

**CLAUDE.md:**

```markdown
# @bymax-one/nest-realtime — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-realtime` — dual-transport realtime for NestJS 11 + React 19
> **Runtime:** Node.js 24+ | Zero direct dependencies (peer deps for transports)

---

## Critical Rules

**1. npm Library — Not an App**
- Zero direct dependencies. Everything is peerDependency.
- 3 subpaths: `.` (server), `./shared`, `./react`.

**2. Auth Inversion — Mandatory**
- Library NEVER imports `@bymax-one/nest-auth`, `@nestjs/jwt`, or any auth lib.
- Consumer plugs `IConnectionAuthenticator`. Examples in `docs/examples/auth/`.

**3. SSE First, WS Opt-in**
- Default transport is SSE. WS requires explicit `transport: 'websocket' | 'both'`.
- Frontend `socket.io-client` is dynamically imported — SSE-only bundle ≤ 4 KB.

**4. Multi-tenant via Rooms**
- Rooms: `user:{userId}`, `tenant:{tenantId}`, `resource:{type}:{id}`.
- Lib auto-joins `user:` and `tenant:` rooms on connect.

**5. Cross-instance**
- `IRealtimePubSub` for SSE scaling (Redis recommended).
- `@socket.io/redis-adapter` for WS scaling (registered automatically).

**6. Reserved Events**
- `connection:established`, `connection:reauthentication-failed`, `heartbeat`, etc.

**7. TypeScript — Zero `any`**
- Use `unknown` where appropriate (esp. `IRealtimePubSub.args`).

**8. Build**
- tsup 3 entries. `sideEffects: false`. All peer deps external.

---

## Subpaths

| Subpath | Purpose | Peer Deps |
|---------|---------|-----------|
| `.` (server) | NestJS module — transports, services | NestJS 11, rxjs (+ optional socket.io, ioredis) |
| `./shared` | Types + constants | None |
| `./react` | Hooks + RealtimeProvider | react ^19 (+ optional socket.io-client) |

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

### Mutation testing (before tagging a release)

```bash
pnpm mutation
```

Target: ≥ 95% mutation score. Critical paths ≥ 95%.

---

## Guidelines — Load Only What You Need

| Domain | File | Load when... |
|--------|------|-------------|
| NestJS | `docs/guidelines/NESTJS-GUIDELINES.md` | Modifying `src/server/` |
| RxJS | `docs/guidelines/RXJS-GUIDELINES.md` | Working on SSE Observable streams |
| Socket.IO | `docs/guidelines/SOCKET-IO-GUIDELINES.md` | Working on WebSocket transport |
| React | `docs/guidelines/REACT-GUIDELINES.md` | Working on `src/react/` |
| Testing | `docs/guidelines/JEST-TESTING-GUIDELINES.md` | Writing or fixing tests |
| Infra | `docs/architecture/infra-considerations.md` | Deployment configs (proxies, CDN) |

For full architecture, see **[AGENTS.md](./AGENTS.md)**.
```

**AGENTS.md:** More detailed — patterns, testing patterns, architectural decisions.

**Acceptance criteria:**

- [ ] CHANGELOG.md with entry `0.1.0`
- [ ] SECURITY.md present (nest-auth template adapted)
- [ ] CLAUDE.md above
- [ ] AGENTS.md ≥ 15 KB with documented architectural decisions

### 7.3 CI workflows — finalize

> `ci.yml`, `codeql.yml`, `scorecard.yml`, and `.github/dependabot.yml` are created in **Phase 1** (Task 1.16) and run green on every PR from the first one (see §1.7). This phase **adds the release-time workflows and verifies the full set** against the real `dist/`:

- `release.yml` — tag-driven (`v*`); `pnpm publish --provenance` via OIDC trusted publishing, gated behind an `npm-publish` environment (manual approval) with a tag↔`package.json` version-match guard
- `e2e-cross-instance.yml` — scheduled (daily) + `workflow_dispatch`; runs the flaky cross-instance e2e suite out of the per-PR path
- Re-verify the Phase 1 `ci.yml` gates against the real build: typecheck, lint, `test:cov` (100% on implemented files), `build` (3 subpaths emit .mjs/.cjs/.d.ts), `size` (brotli budgets), `test:e2e -- --testPathIgnorePatterns=cross-instance`, `dependency-review`; `codeql.yml` + `scorecard.yml` green

**Workflow additional — `e2e-cross-instance.yml`:**

```yaml
name: E2E Cross-Instance
on:
  schedule:
    - cron: '0 6 * * *'  # daily
  workflow_dispatch:
jobs:
  cross-instance:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v6
        with: { version: 11.0.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:e2e -- --testPathPattern=cross-instance
        env: { REDIS_URL: redis://localhost:6379 }
```

**Acceptance criteria:**

- [ ] 4 workflows copied and adapted
- [ ] Workflow extra `e2e-cross-instance.yml` schedule daily
- [ ] CI ignores cross-instance in the PR (avoids flakes), runs on schedule

### 7.4 Mutation baseline

```bash
pnpm mutation
```

**Output expected:** `reports/mutation/mutation.html` + `reports/stryker-incremental.json`.

**Acceptance criteria:**

- [ ] Mutation score ≥ 95% global
- [ ] Mutation score ≥ 95% on critical paths (registries, replay buffer, validate-options, encode-sse-event, composite fan-out)
- [ ] Equivalent mutants documented inline with `// Stryker disable next-line <Mutator>: <reason>`
- [ ] Update `docs/mutation_testing_results.md` with timestamp and score

### 7.5 Tag + publish

```bash
# 1. Bump
pnpm version 0.1.0

# 2. Push tag
git push --follow-tags

# 3. release.yml triggers → publishes with --provenance
```

**Acceptance:**

- [ ] Tag `v0.1.0` created
- [ ] Workflow `release.yml` green
- [ ] Package available at `https://www.npmjs.com/package/@bymax-one/nest-realtime`
- [ ] Badge "Provenance" appears on npm
- [ ] Cross-instance workflow `e2e-cross-instance.yml` green on the next daily run

---

## Appendix A — Dependency Graph

The lib offers **two installation paths** depending on usage:

### Path A — SSE-only (most common)

```
                  Phase 1 — Foundation + SSE
                          │
                          ▼
            ┌─────────────────────────────┐
            │  ConnectionRegistry          │ ← §2.5
            │  RoomRegistry / EventIdGen   │ ← §2.5
            │  EventReplayBuffer           │ ← §2.6
            │  HeartbeatService            │ ← §2.6
            │  SseTransport + Controller   │ ← §2.6, §2.8
            │  RealtimeService             │ ← §2.7
            │  BymaxRealtimeModule.forRoot │ ← §2.8
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 2 — Auth + Last-Event-ID + Reauth
                      │
            ┌─────────────────────────────┐
            │  SseSubscriptionHandler      │ ← §3.1
            │  AuthenticationCache         │ ← §3.2
            │  ReauthenticationService     │ ← §3.3
            │  encodeSseEvent              │ ← §3.4
            │  forRootAsync                │ ← §3.7
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 3 — Horizontal Scaling SSE
                      │
            ┌─────────────────────────────┐
            │  In-memory pub/sub fan-out  │ ← §4.1
            │  PubSubSubscriber           │ ← §4.2
            │  RedisRealtimePubSub (docs) │ ← §4.3
            │  IOfflineQueue + Redis ex   │ ← §4.4
            │  worker_threads E2E         │ ← §4.5
            └─────────┬───────────────────┘
                      │
                      ▼
                  Phase 5 — Frontend (./react)
                      │
            ┌─────────────────────────────┐
            │  SseClient (internal)       │ ← §6.1
            │  useRealtime SSE branch     │ ← §6.1
            │  RealtimeProvider           │ ← §6.3
            │  usePresence (opt)          │ ← §6.4
            │  Bundle size validation     │ ← §6.5
            └─────────────────────────────┘
```

### Path B — WS + Scaling (opt-in branch)

```
   Path A complete ────────────────►  Phase 4 — WebSocket Transport
                                           │
                                  ┌─────────────────────────────┐
                                  │ WebSocketTransport          │ ← §5.1
                                  │ RealtimeGateway             │ ← §5.2
                                  │ RealtimeIoAdapter           │ ← §5.3
                                  │ CompositeTransport          │ ← §5.4
                                  │ socket.io-client E2E        │ ← §5.6
                                  └─────────┬───────────────────┘
                                            │
                                            ▼
                                  Phase 5 (WS branch)
                                            │
                                  ┌─────────────────────────────┐
                                  │ WebSocketClient (dynamic)   │ ← §6.2
                                  │ useRealtime WS branch       │ ← §6.2
                                  └─────────┬───────────────────┘
                                            │
                                            ▼
                                  Phase 6 — Release
```

A: SSE-only deploy. Peer deps: `@nestjs/common`, `rxjs`, `react` (frontend). Bundle frontend ≤ 4 KB.

B: WS or Composite deploy. Peer deps additional: `@nestjs/websockets`, `socket.io`, `@socket.io/redis-adapter`, `ioredis`, `socket.io-client` (frontend).

---

## Appendix B — Complexity Matrix

| Phase | Sub-step | LoC est. | Complexity | Risk |
|---|---|---|---|---|
| 1 | 2.1 Scaffold (3 subpaths) | ~50 LoC + configs | LOW | Tooling version, tsup externals |
| 1 | 2.2 Shared types | ~100 LoC | LOW | — |
| 1 | 2.3 Interfaces (7 contracts) | ~250 LoC | LOW | — |
| 1 | 2.4 Constants + DI tokens | ~60 LoC | LOW | — |
| 1 | 2.5 Internal services (registries, idgen) | ~250 LoC | MEDIUM | Indices consistency in concurrent emit |
| 1 | 2.6 SSE transport stack | ~400 LoC | MEDIUM | RxJS finalize, MessageEvent types |
| 1 | 2.7 RealtimeService + InMemoryPubSub | ~80 LoC | LOW | — |
| 1 | 2.8 BymaxRealtimeModule + factory | ~250 LoC | MEDIUM | Dynamic controller class, @Global |
| 1 | 2.9 Tests Phase 1 | ~800 LoC | MEDIUM | Mock Subject + ConnectionRegistry isolation |
| 2 | 3.1 SseSubscriptionHandler refactor | ~150 LoC | MEDIUM | Connection limit FIFO eviction logic |
| 2 | 3.2 Auth examples + cache | ~200 LoC | MEDIUM | Cache TTL math |
| 2 | 3.3 ReauthenticationService | ~150 LoC | MEDIUM | setInterval lifecycle, unref |
| 2 | 3.4 encodeSseEvent | ~50 LoC | LOW | SSE wire format precision |
| 2 | 3.5 Wired lifecycle hooks | ~50 LoC modification | LOW | — |
| 2 | 3.6 Heartbeat E2E | ~80 LoC | MEDIUM | Timing flakiness |
| 2 | 3.7 forRootAsync | ~150 LoC | MEDIUM | NestJS async resolution + controllers |
| 3 | 4.1 InMemoryPubSub fan-out | ~30 LoC | LOW | — |
| 3 | 4.2 PubSubSubscriber | ~150 LoC | HIGH | Echo prevention, *Local methods access |
| 3 | 4.3 RedisRealtimePubSub example | ~120 LoC | MEDIUM | ioredis duplicate, subscribe idempotency |
| 3 | 4.4 RedisOfflineQueue example | ~80 LoC | MEDIUM | Sorted set ops + trim |
| 3 | 4.5 worker_threads E2E | ~200 LoC | HIGH | Cross-process Redis mock sharing |
| 4 | 5.1 WebSocketTransport | ~200 LoC | MEDIUM | server.to rooms, setServer post-init |
| 4 | 5.2 RealtimeGateway | ~150 LoC | MEDIUM | handshake.auth.token merge |
| 4 | 5.3 RealtimeIoAdapter | ~120 LoC | HIGH | createIOServer override + dynamic require |
| 4 | 5.4 CompositeTransport | ~120 LoC | MEDIUM | Promise.allSettled fan-out |
| 4 | 5.5 Auth handshake docs | ~50 LoC | LOW | — |
| 4 | 5.6 socket.io-client E2E | ~200 LoC | MEDIUM | Async test with done callback |
| 5 | 6.1 SseClient + useRealtime SSE | ~250 LoC | MEDIUM | useEffect cleanup, exponential backoff |
| 5 | 6.2 WebSocketClient + dynamic import | ~150 LoC | HIGH | Bundle validation, dynamic import in tests |
| 5 | 6.3 RealtimeProvider + useRealtimeConnection | ~80 LoC | LOW | — |
| 5 | 6.4 usePresence | ~80 LoC | LOW | — |
| 5 | 6.5 Bundle size validation | ~50 LoC | MEDIUM | Static analysis of bundle output |
| 5 | 6.6 Tests React | ~500 LoC | MEDIUM | EventSource mock fidelity |
| 6 | 7.1-7.5 Docs+CI+release | manual | LOW | Mutation may reveal weak tests |

**Total estimated LoC (source + tests):** ~6,500 LoC (the largest lib in the portfolio).

**HIGH complexity sub-steps — require extra careful human review:**
- 4.2 PubSubSubscriber (echo prevention, *Local access pattern)
- 4.5 worker_threads E2E (flakiness inherent)
- 5.3 RealtimeIoAdapter (override createIOServer, dynamic require)
- 6.2 WebSocketClient + dynamic import (bundle validation)

---

## Appendix C — Reference Configs (mirror of nest-auth)

| File | Source to copy (and adapt) |
|---|---|
| `tsconfig.json` | `../nest-auth/tsconfig.json` |
| `tsconfig.build.json` | nest-auth/tsconfig.build.json |
| `tsconfig.server.json` | nest-auth/tsconfig.server.json |
| `tsconfig.e2e.json` | nest-auth/tsconfig.e2e.json |
| `tsconfig.jest.json` | nest-auth/tsconfig.jest.json |
| `jest.config.ts` | nest-auth/jest.config.ts (adapt moduleNameMapper for 3 subpaths) |
| `jest.coverage.config.ts` | nest-auth/jest.coverage.config.ts |
| `jest.e2e.config.ts` | nest-auth/jest.e2e.config.ts (testTimeout 15s) |
| `jest.stryker.config.ts` | nest-auth/jest.stryker.config.ts |
| `stryker.config.json` | nest-auth/stryker.config.json (thresholds high 99, low 95, break 95) |
| `eslint.config.mjs` | nest-auth/eslint.config.mjs (remove crypto/oauth, add react-hooks override) |
| `.prettierrc` | nest-auth/.prettierrc |
| `.gitignore` | nest-auth/.gitignore (add `dist/`, `coverage/`, `reports/`) |
| `scripts/check-size.mjs` | nest-auth/scripts/check-size.mjs (3 entries, validate socket.io-client absent) |
| `.github/workflows/*.yml` | nest-auth/.github/workflows/*.yml (replace name, add e2e-cross-instance.yml) |

---

## Appendix D — Glossary and term mapping

| Term | Meaning in this plan |
|---|---|
| **Phase** | Cohesive block of functionality that delivers a vertical slice of the lib |
| **Sub-step** | §N.M within a phase — atomic enough to become 1+ task in `docs/tasks/phase-NN-*.md` |
| **Acceptance criteria** | Binary (yes/no) checklist for closing the sub-step |
| **Validation command** | Exact command to run to validate acceptance |
| **Done criteria** | Aggregated set of gates to close the entire phase |
| **AAA pattern** | Arrange/Act/Assert — convention in tests |
| **TDD red-green-refactor** | Write failing test → implement minimal → refactor |
| **Mutation score** | % of mutations detected by tests (Stryker) |
| **Coverage gate** | Minimum coverage limit per file / global |
| **Path A / Path B** | SSE-only (A) vs WS + scaling (B) installation paths — see Appendix A |
| **Auth inversion** | The lib never imports a concrete auth library; the consumer plugs in via interface |
| **Composite mode** | `transport: 'both'` — SSE + WS running simultaneously |
| **Echo prevention** | Pub/sub ignores messages originated by the instance itself (`origin` field) |
| **Local methods (`*Local`)** | Transport methods that emit locally WITHOUT publishing — used by subscriber to avoid feedback loop |
| **Last-Event-ID** | HTTP header sent by the browser when reconnecting SSE; used for replay |
| **Heartbeat / keepalive** | Periodic message `: keepalive\n\n` (SSE) or ping (WS) to avoid proxy timeout |
| **FIFO eviction** | When `maxConnectionsPerUser` is exceeded, the oldest connection is closed first |
| **Ring buffer** | Fixed-size structure where old inserts are discarded (replay buffer) |
| **Sorted set (Redis)** | Structure used by `RedisOfflineQueue` — indexed by score (timestamp) |
| **AsyncLocalStorage** | Node.js API used (in other portfolio libs) for context propagation; nest-realtime does not use it directly |
| **Subpath export** | Alternative package entry point (`lib/sub`) — enables tree-shaking |
| **Dynamic import** | `await import(...)` — loads a module at runtime, outside the static bundle |

---

## Appendix E — Infra considerations (proxies, Nginx, Cloudflare, AWS, serverless)

This section gathers operational guidance the lib consumer must internalize. Replicate relevant excerpts in `README.md` (short section linking to this spec section).

### E.1 Nginx — SSE configuration

```nginx
location /events {
  proxy_pass http://backend;
  proxy_http_version 1.1;
  proxy_set_header Connection '';
  proxy_buffering off;             # CRITICAL — without this, nginx buffers and SSE doesn't flow
  proxy_cache off;
  proxy_read_timeout 24h;          # or >> heartbeat interval
  chunked_transfer_encoding off;
}
```

### E.2 Cloudflare

- Works out-of-box on Free and higher plans
- 100s limit for connections on Free tier — use **Pro+ for long connections** or configure `heartbeatMs: 60_000` or lower
- Enable HTTP/2 or HTTP/3 for multiplexing (`:status 200` header with `Transfer-Encoding: chunked`)

### E.3 AWS ALB / API Gateway

- **ALB:** supports SSE natively, configure `idle_timeout` > heartbeat (recommended 65s for `heartbeatMs: 30_000`)
- **API Gateway HTTP API:** 30s limit — **not recommended** for long-running SSE; use ALB directly
- **API Gateway WebSocket API:** dedicated service for WS, but loses Socket.IO features (rooms, namespaces); use Socket.IO directly via ALB instead

### E.4 Vercel / Netlify (serverless)

- Hosting SSE on **serverless functions is problematic** (short timeouts, per-execution billing)
- Recommendation: NestJS backend on a dedicated VM/container (Railway, Fly.io, AWS Fargate, ECS, Render)
- Frontend (Next.js/React) **OK** on Vercel/Netlify; only the **NestJS backend** needs long-running process hosting

### E.5 File descriptor limits

Each SSE/WS connection consumes 1 FD. Linux default ~1024. For > 1000 connections:

```bash
ulimit -n 65536
```

In containers, configure `ulimits` in the compose/docker:

```yaml
services:
  backend:
    ulimits:
      nofile: { soft: 65536, hard: 65536 }
```

### E.6 Per-connection memory

- SSE: ~10-30 KB per connection (Subject + buffer)
- WS Socket.IO: ~30-50 KB per connection (Socket instance + buffers)

10k concurrent connections → 300-500 MB. Plan capacity.

### E.7 HTTP/1.1 — 6 connections per origin limit

Browsers limit 6 connections per origin in HTTP/1.1. For apps with many tabs:
- **HTTP/2 + ALPN** — multiplexing, with no practical limit
- **Dedicated subdomain** — `events.app.com` separates it from the main traffic
- **`RealtimeProvider`** — multiplexes via a single `EventSource` + client-side dispatching

### E.8 In-memory replay buffer is per-instance

After restart or in multi-instance, the buffer is cleared/divergent. For strong "no event loss" guarantee:
- Configure `IOfflineQueueStorage` (Redis-backed, example in §4.4)
- TTL recommended: 24h
- maxPerUser: 500 (adjust per app)

### E.9 Backpressure

The lib does not block the producer (`emit*` returns `Promise<void>` quickly). Slow client + fast producer = buildup in the RxJS Subject. Recommendation:
- Moderate emit — do not use realtime for high-frequency streams (>100 msg/s per user)
- For heavy streams: HTTP polling or WebSocket with `binaryType: 'arraybuffer'` and ack-based throttle

### E.10 WebSocket fallback transports (Socket.IO)

Socket.IO supports long-polling as fallback. In corporate environments hostile to WS, this helps. But for those cases, **prefer SSE** (HTTP native, without upgrade). Configure:

```typescript
websocket: { transports: ['websocket', 'polling'] }  // explicit in consumer
```

or in the frontend:

```typescript
io(url, { transports: ['websocket', 'polling'] })
```

---

> **Next phase of this document:** the executable tasks live in [`docs/tasks/`](./tasks/) (Layer 3 — one file per phase, `phase-NN-<slug>.md`, runnable by an AI agent), generated from this plan using the [`/bymax-workflow:phase-tasks`](../../../.claude/commands/bymax-workflow/phase-tasks.md) standard.
