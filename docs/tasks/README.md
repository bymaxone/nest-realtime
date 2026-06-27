# Development Tasks — @bymax-one/nest-realtime

> **Last updated:** 2026-06-27
> **Source roadmap:** [`../development_plan.md`](../development_plan.md) · **Spec:** [`../technical_specification.md`](../technical_specification.md)

Tasks live **one file per phase** in this folder (`phase-NN-<slug>.md`), following the Bymax task-doc convention (same pattern as `bymax-one/rust-auth`). Each phase file is self-contained: context, rules-of-phase, reference docs, a task index, the tasks (each with an executable **Agent prompt** in a 4-backtick fence), and a completion log.

> **Canonical phase status lives in the plan's [Phase dashboard](../development_plan.md#15-phase-dashboard) (§1.5).** This folder index mirrors it for convenience — when a phase/task changes state, update the plan dashboard first, then this table.

---

## Phase files (folder index)

| Phase | File | Tasks | Status |
|---|---|---|---|
| 1 | [`phase-01-foundation-sse.md`](./phase-01-foundation-sse.md) | 16 / 16 | ✅ Done |
| 2 | [`phase-02-auth-last-event-id.md`](./phase-02-auth-last-event-id.md) | 12 / 12 | ✅ Done |
| 3 | [`phase-03-horizontal-scaling-sse.md`](./phase-03-horizontal-scaling-sse.md) | 0 / 11 | 📋 ToDo |
| 4 | [`phase-04-websocket-transport.md`](./phase-04-websocket-transport.md) | 0 / 12 | 📋 ToDo |
| 5 | [`phase-05-frontend-react.md`](./phase-05-frontend-react.md) | 0 / 12 | 📋 ToDo |
| 6 | [`phase-06-release.md`](./phase-06-release.md) | 0 / 10 | 📋 ToDo |
| | **Total** | **28 / 73** | 🔄 38% |

---

## Status legend

| Symbol | Meaning |
|---|---|
| 📋 | ToDo (not started) |
| 🔄 | In Progress |
| 👀 | Review |
| ✅ | Done (acceptance criteria met + verified) |
| ⛔ | Blocked (by a dependency) |
| 🟡 | Partial |

Task sizes: **S** (< ~100 LoC), **M** (~100–250), **L** (~250+). Priorities: **P0** (blocking), **P1** (important), **P2** (nice-to-have).

---

## Execution guidance for AI agents

> **Read this before executing any task.**

### Token economy
1. **Do not load a whole phase file** — jump to your task's anchor (e.g. `#task-2-5`); use `Read` with `offset`/`limit`.
2. **Do not load the plan or spec entirely** — each task lists "REQUIRED READING" with the exact `§` sections; read only those. The plan is ~6300 lines and the spec ~2600 — loading both costs ~250k tokens.
3. **Do not load `nest-auth`/`nest-logger`/`nest-cache` entirely** — copy only the specific file a task references (via the portable `../nest-auth/<file>` path).

### Phase execution mode (`/bymax-workflow:task phase <N>`)
- Resolve the phase's tasks in dependency order (the `Depends on` column), execute sequentially, and after each task confirm `Status: ✅` was applied. The phase closes when all its tasks are done.

### Self-update protocol (mandatory at the end of each task)
Update these places, then the cross-doc rows:
1. The task block's **Status** + tick its acceptance criteria.
2. The phase file's **Task index** row + the **Progress** counter (`X / Y`) in the header.
3. The phase file's **Completion log** (append `- <id> ✅ <YYYY-MM-DD> — <summary>`).
4. The phase row in [`../development_plan.md`](../development_plan.md) §1.5 dashboard (Status + Progress + Last updated) and this README's table; recompute Overall progress in §1.4.
5. Commit with Conventional Commits: `<type>(realtime): <subject> (<phase>.<task>)`.

### Blocked / review
- Blocked → `Status: ⛔`, add `> **Blocker:** …` under the task header, no destructive commit.
- Acceptance fails after 2 red-green cycles → `Status: 👀` + an inline note.

---

## Project-wide constraints (apply to every task)

- **Auth inversion is a structural rule** — the lib **NEVER** imports `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport-*`, or any concrete auth library in `src/`. All auth flows through the consumer-provided `IConnectionAuthenticator`. CI gate: `grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/` returns zero. References only in `docs/` (bridge examples) and tests (mocks).
- **Transport-agnostic API** — `RealtimeService` (`emitToUser/emitToTenant/emitToRoom/broadcast/joinRoom/leaveRoom/disconnect`) is identical across SSE, WebSocket, and `'both'`. SSE is the default; WebSocket is opt-in.
- **SSE heartbeat is a `: keepalive` comment** — written directly to the response stream by `HeartbeatService`, **not** a `MessageEvent` and **not** a reserved named event (it stays out of the `Last-Event-ID` id-space).
- **FIFO connection eviction** — exceeding `maxConnectionsPerUser` evicts the user's **oldest** connection (closing it with `REALTIME_TOO_MANY_CONNECTIONS`); the new connection is admitted, never rejected with 429.
- **Cross-instance correctness** — public `emitTo*` do local delivery **plus one** `IRealtimePubSub.publish`; the subscriber dispatches remote messages to the non-publishing `*Local` methods only (no re-publish loop). `disconnect()` publishes `op:'disconnect'` for cross-instance revocation.
- **WebSocket horizontal scaling needs sticky sessions** when the polling fallback is enabled — the Redis adapter syncs messages, not handshake affinity.
- **`socket.io-client` must stay out of the SSE-only bundle** — loaded via `await import()` only. Gate: `grep socket.io-client dist/react/index.mjs` returns zero.
- **Code-Craft Standard** — TS strict (no `any`); **100% line/branch coverage** per implemented file; mutation **Stryker break 95** (high 99 / low 95) pre-release; functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header per file; official-docs-first (context7) before using any library; English-only, **timeless** comments (no Phase/Task references in committed code).
- **Bundle budgets (KiB-brotli)** — server `dist/server/index.mjs` ≤ 18 KB brotli; React SSE-only `dist/react/index.mjs` ≤ 4 KiB brotli.
- **Zero `dependencies`** — `package.json` ships `"dependencies": {}`; `rxjs` + `reflect-metadata` are the only required peers; everything else is an optional peer in `peerDependenciesMeta`. `packageManager: pnpm@11.0.0`.
- **CI green from the first PR** — `ci`/`codeql`/`scorecard` are created in Phase 1 and pass on every PR (incremental-safe gates: `jest --passWithNoTests`, coverage on implemented files, size budgets); `release.yml` is tag-driven and exercised in Phase 6.
- **No `.gitkeep`/placeholder dirs** — directories emerge on demand when the first real file is written.
- **MVP scope** — v0.1 ships SSE (default) + WebSocket (opt-in) + `'both'` + React hooks; presence (`IPresenceStorage`/`usePresence`) is wired only when the consumer configures it.
