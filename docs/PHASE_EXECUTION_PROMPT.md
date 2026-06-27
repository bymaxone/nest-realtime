# Autonomous Phase Execution — @bymax-one/nest-realtime

> A runbook for driving the whole roadmap (**Phase 1 → Phase 6**, 6 phases / 73 tasks)
> autonomously, one phase per PR, with zero human interaction after launch. It reuses
> the operational lessons proven on the sibling `nest-queue` / `nest-notification` /
> `rust-auth-example` runbooks — where the naive "one agent does everything including
> merge and spawns the next" design **deadlocked** waiting for the code-review bot. This
> is the **library** `@bymax-one/nest-realtime`: a single-package **dual-transport**
> NestJS module exposing ONE transport-agnostic server API over **SSE** (default, via
> the `@Sse()` decorator + RxJS) and **WebSocket** (opt-in, via Socket.IO), plus a
> `'both'` composite and React 19 hooks (`./react`), published to npm. The gates, the
> transport-correctness focus, and the memory-safety rules are the TypeScript-library
> set — read §4 and §5 carefully.

---

## 0. How to launch

```bash
cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-realtime
claude --dangerously-skip-permissions
```

Then paste **Part A — The Orchestrator Prompt** (§2) as the first message. Nothing
else is required from you; the orchestrator drives every phase to merge and chains
the next one until the roadmap is complete (Phase 6 = release to npm).

The **orchestrator** runs on **Opus 4.8 at xhigh effort** (selected in the terminal before
launch). The **implementer subagents** follow a **hybrid model policy** (detailed in §2 STEP 1):
**Opus 4.8** for the transport-correctness-heavy phases (the SSE foundation + RxJS teardown,
the horizontal-scaling pub/sub fan-out, the WebSocket gateway/adapter/sticky-session),
**Sonnet 4.6** for the more mechanical ones (auth wiring on the established SSE foundation,
the React hooks, and the docs/release phase). The merge gate enforces the quality floor
model-agnostically, so the cheaper model is safe where first-pass subtlety matters least.

> **Tip — make this runbook readable by the agents:** copy this file into the repo once so
> the prompts can reference its sections without the absolute MySupport path:
> `cp "/Users/maximiliano/Documents/MySupport/Prompts/PHASE_EXECUTION_PROMPT [nest-realtime].md" docs/PHASE_EXECUTION_PROMPT.md`
> (the Part A/B prompts below point at `docs/PHASE_EXECUTION_PROMPT.md`).

---

## 1. Architecture — who does what (the most important lesson)

The work is split across **two roles**. Mixing them is what caused the deadlock.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR  (the main session — long-lived, small context)             │
│                                                                          │
│  • Owns the chain. Decides which phase is next (Phase 1 → Phase 6).      │
│  • Spawns ONE implementer subagent per phase (isolated git worktree).    │
│  • Picks the implementer's MODEL per the hybrid policy (§2 STEP 1).      │
│  • Receives the PR number the implementer returns.                       │
│  • Drives steps 5–9: wait for CI + review bot → fix → merge after a       │
│    grace window → update the dashboards → spawn the NEXT phase.          │
│  • Maintains the autonomy backbone (always a pending background job OR a │
│    ScheduleWakeup armed — never ends a turn with a "dead gap").          │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ spawns (Agent tool, isolation: "worktree", model: …)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ IMPLEMENTER  (a subagent — one per phase, in its own worktree)           │
│                                                                          │
│  • Steps 0–4 ONLY: implement every task → gates → reviews → open PR.     │
│  • Returns the PR number as its final message, then STOPS.              │
│  • NEVER waits for the review bot. NEVER merges. NEVER spawns anything.  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why the split.** A background subagent that tries to "wait for the review bot / wait for
CI" simply **ends its execution** the moment it enters a long wait — only the **main loop**
is re-invoked by task-notifications when a background job finishes. So the long waits (CI,
Copilot, the grace window) MUST live in the orchestrator, fed by a background
`run_in_background` poll that exits on a **signal** (CI failed / bot re-reviewed / grace
window elapsed), not on a fixed sleep. That background completion is what re-invokes the
main loop and keeps the chain alive between phases.

**Why ONE implementer at a time is non-negotiable.** The unit suite is bounded, but
**Phase 2** runs an SSE E2E with the Node `eventsource` client, **Phase 3** simulates
multiple backend instances via `worker_threads` against a real **Redis** (cross-instance
pub/sub), and **Phase 4** runs a `socket.io-client` E2E against a **Testcontainers Redis**
(`@socket.io/redis-adapter`). Two phases building/testing at once — or fanned-out test
agents — multiply memory by `workers × runners × agents`, and the long-lived SSE/WS
connections + worker_threads + containers saturate cores and RAM. **Never run two
implementers, never fan out parallel test agents, and keep Jest `maxWorkers` bounded
(`'50%'`, baked into the configs).**

---

## 2. Part A — The Orchestrator Prompt

> Paste this block verbatim into the main session.

```
You are the ORCHESTRATOR for the autonomous build of @bymax-one/nest-realtime.

Project root: /Users/maximiliano/Documents/MyApps/bymax-one/nest-realtime
GitHub repo:  bymaxone/nest-realtime
Package:      @bymax-one/nest-realtime (public npm) — a dual-transport NestJS realtime module
              (SSE default via @Sse()+RxJS · WebSocket opt-in via Socket.IO · 'both' composite · ./react hooks)
Roadmap:      docs/development_plan.md  (6 phases; §1.5 "Phase dashboard" + §1.4 "Progress" + §1.6 "Update protocol")
Phase tasks:  docs/tasks/phase-NN-*.md  +  docs/tasks/README.md (folder index + token-economy + self-update protocol)
ONE status legend EVERYWHERE (do NOT invent a second): 📋 ToDo · 🔄 In Progress · 👀 Review · ✅ Done · ⛔ Blocked · 🟡 Partial.
Keep BOTH dashboards (development_plan §1.5 "Phase dashboard"/§1.4 "Progress" AND tasks/README index) in sync on every state change.

You drive the WHOLE roadmap, Phase 1 → Phase 6, one phase per PR, sequentially — NEVER two
phases in parallel (memory-safety: Phase 2 SSE-E2E, Phase 3 worker_threads multi-instance +
Redis, Phase 4 socket.io-client E2E + Testcontainers Redis; concurrent runs OOM the machine and
saturate cores). You do NOT implement code yourself; you spawn one implementer subagent per phase
and you own everything from "PR opened" to "merged + next phase spawned". Read §1 (architecture),
§4 (conventions), and §5 (the operational playbook) of docs/PHASE_EXECUTION_PROMPT.md before you
begin, and follow §5 literally for every merge decision and every wait.

────────────────────────────────────────────────────────────────────────────
STEP -1 — Preconditions (seed main with docs if needed)
────────────────────────────────────────────────────────────────────────────
The repo has docs/ but may have ZERO commits yet (greenfield) while origin
(https://github.com/bymaxone/nest-realtime.git) exists. Phase PRs need a valid base:
  • `git rev-parse HEAD` succeeds AND `git ls-remote --heads origin main` exits 0 with
    non-empty output → base OK. (A non-zero exit means a missing/renamed remote, not an
    empty result — treat that as "origin/main absent".)
  • If HEAD is missing OR origin/main is absent: stage docs/, commit
    `chore(repo): seed main with project documentation`, and `git push -u origin main`.
  • Start every phase from the latest origin/main: `git fetch origin`, then `git switch main`
    (or, if no local main exists, `git switch -c main --track origin/main`), then `git pull --ff-only`.
  • Branch creation uses `git switch -c` — NEVER `git checkout -b` (a git-guard hook hard-blocks it).
  • No external pre-build is required (the lib has zero runtime deps; all peers — @nestjs/*,
    rxjs, reflect-metadata, and the optional socket.io/@socket.io/redis-adapter/ioredis/react/
    socket.io-client — install with the repo). Phase 3 (cross-instance pub/sub) and Phase 4
    (socket.io-client E2E) need Docker available for a Redis (Testcontainers / a service container);
    Phase 2's SSE E2E needs the `eventsource` Node client (a devDependency).

────────────────────────────────────────────────────────────────────────────
STEP 0 — Pick the next phase
────────────────────────────────────────────────────────────────────────────
Read docs/tasks/README.md (the index) and docs/development_plan.md (§1.5 Phase dashboard).
The next phase is the lowest-numbered phase NOT ✅ Done, respecting the dependency order
(plan Appendix A dependency graph — never start a phase whose deps are not ✅; the track is
linear 1→2→3→4→5→6).
  • If all of Phases 1–6 are ✅ Done → report "✅ All phases complete. @bymax-one/nest-realtime
    v0.1.0 is published." and STOP.
  • All phases run in this repo.

────────────────────────────────────────────────────────────────────────────
STEP 1 — Spawn the implementer (steps 0–4) in an isolated worktree
────────────────────────────────────────────────────────────────────────────
Use the Agent tool with isolation: "worktree" and pass Part B (the Implementer Prompt from
docs/PHASE_EXECUTION_PROMPT.md §3) verbatim, with {N} set to the phase number (1..6) and {NN}
to the zero-padded number (01..06). ONE implementer at a time — never fan out (OOM risk on the
SSE/WS E2E + worker_threads + Testcontainers phases; concurrent worktrees on the same branch collide).

MODEL POLICY (hybrid). You (orchestrator) ALWAYS run on Opus 4.8 (1M). For each implementer/fix
subagent you spawn, set the Agent tool `model`:
  • Opus 4.8 (OMIT `model` → the subagent inherits the main-loop model) for the transport-correctness-
    heavy phases:
      Phase 1 (Foundation + SSE Transport — the per-connection RxJS Subject + close$/takeUntil/finalize
        teardown, EventReplayBuffer (injected opts + parenthesized cap + lexicographic id order),
        HeartbeatService as a raw `: keepalive` comment written to the response (NOT a MessageEvent),
        the registries + EventIdGenerator, RealtimeService, the dynamic module/forRoot, AND the
        CI-skeleton Task 1.16 whose job names are contractual),
      Phase 3 (Horizontal Scaling SSE — the non-publishing `*Local` emit path + `op:'disconnect'`
        producer/consumer that defeats the A→B→A relay loop, the ioredis pub/sub two-connection
        `.duplicate()` split + origin self-filter, IOfflineQueueStorage, worker_threads multi-instance
        tests; HIGH complexity),
      Phase 4 (WebSocket Transport — the custom IoAdapter that extracts cookies/auth at the handshake
        and applies the config-driven namespace, `@socket.io/redis-adapter` `createAdapter(pub, sub)`
        two-client wiring, the sticky-session requirement, CompositeTransport `kind === 'sse'`,
        adapter-aware `server.in(id).disconnectSockets(true)` revocation; HIGH complexity).
  • Sonnet 4.6 (`model: "sonnet"`) for the more mechanical phases (documented patterns on an
    established foundation):
      Phase 2 (Auth + Last-Event-ID + Reauthentication — the three canonical auth patterns
        (HttpOnly cookie / ticket / WS bearer), the SseSubscriptionHandler extraction with FIFO
        eviction, Last-Event-ID replay wiring, the periodic reauth policy + lifecycle hooks,
        forRootAsync — all specified verbatim in spec §6.1/§8/§10),
      Phase 5 (Frontend ./react — useRealtime/useRealtimeConnection/usePresence/RealtimeProvider on
        the documented API; the one subtle invariant is the socket.io-client dynamic-import bundle
        exclusion + letting native EventSource handle reconnect/replay),
      Phase 6 (Release — README/CHANGELOG/SECURITY/CLAUDE/AGENTS + the 4 Copilot files, FINALIZE CI
        (release.yml + e2e-cross-instance), the mutation gate, bundle budgets, tag + publish).
  • Fix subagents: ESCALATE to Opus (omit `model`) when a phase stalls on review/CI findings, even if
    its implementer was Sonnet — ESPECIALLY for any /security-review finding, the cross-instance
    fan-out loop (Phase 3), the IoAdapter handshake-auth / sticky-session (Phase 4), and the
    socket.io-client bundle-exclusion (Phase 5).
Rationale: the merge gate — /bymax-quality:code-review (routes to the typescript-reviewer) +
/security-review iterated to zero, CI (100% coverage via jest.coverage.config.ts + the SSE/WS E2E,
build of all 3 subpaths, KiB-brotli size budgets, dependency-review/codeql/scorecard, the
auth-inversion grep gate, the socket.io-client-not-in-SSE-bundle gate), the Copilot review, and the
Phase 6 mutation gate — enforces the quality floor model-agnostically, so a Sonnet PR that passes
meets the same objective bar at lower cost; the subtlest phases stay on Opus for first-pass judgment
(RxJS teardown vs Subject leak, the cross-instance republish loop, fail-closed handshake auth,
sticky-session vs Redis-adapter, the SSE-comment-vs-MessageEvent heartbeat). Caveat: the Agent tool
exposes only `model`, NOT effort — only the model is guaranteed per subagent.

The implementer returns a PR number. DO NOT trust its prose about what it did — verify the real
state via git/gh (§5.5). Confirm the PR exists and its head branch matches:
  gh pr view <PR#> --repo bymaxone/nest-realtime --json number,headRefName,state

If the implementer died silently (no completion notification, worktree at base with 0 commits
after ~60 min) → investigate file mtimes, then re-spawn (§5.3).

────────────────────────────────────────────────────────────────────────────
STEP 2 — Wait for CI + the review bot via a BACKGROUND poll
────────────────────────────────────────────────────────────────────────────
Start a background poll (Bash run_in_background) that watches the PR and exits on a SIGNAL,
writing its verdict to a file you then read (NEVER read an agent's .output transcript — §5.5).
Use the gh vocabulary in §5.6. The poll exits with exactly one:
  • CI_FAILED        — at least one check is failing (this repo's CI: install / typecheck / lint /
                       test:cov / build / size / e2e (excl. cross-instance) / dependency-review /
                       codeql / scorecard / secret-scan — any may fail)
  • BOT_COMMENTED    — the bot left unresolved review threads to address
  • READY_TO_MERGE   — the full merge-gate conjunction (§5.1) holds
Its completion re-invokes you. Re-arm a long ScheduleWakeup (1200s+) fallback each turn so a
silently-dead poll cannot strand the chain (§5.3).

While the poll runs, DO NOT idle: read the next phase's task file, sync main, pre-draft replies
to threads the last fix already addressed — so the merge is instant when the gate opens (§5.1).

────────────────────────────────────────────────────────────────────────────
STEP 3 — React to the verdict
────────────────────────────────────────────────────────────────────────────
  • CI_FAILED or BOT_COMMENTED → run the FIX procedure (§5.2 + §5.4):
      - Release the phase branch first: if it is checked out in the implementer's worktree,
        `git worktree remove <path> --force` so a fix can switch to it.
      - Spawn a fix subagent (isolation: "worktree", model per the escalation rule above) OR fix
        inline in a fresh worktree on that branch: address EVERY failing check and EVERY bot
        comment (all severities, down to nit). Push.
      - Resolve each bot thread ONE AT A TIME with the real fix SHA, re-fetching thread IDs fresh
        each time (§5.2).
      - Go back to STEP 2 (new background poll).
  • READY_TO_MERGE → STEP 4.

────────────────────────────────────────────────────────────────────────────
STEP 4 — Merge (only after the grace window), then DELETE the merged branch
────────────────────────────────────────────────────────────────────────────
Re-verify the merge-gate conjunction one last time (state may have changed since the poll exited).
Capture the merged PR's head branch FIRST so you can delete it deterministically:
  BR=$(gh pr view <PR#> --repo bymaxone/nest-realtime --json headRefName -q .headRefName)
Then merge and DELETE THE BRANCH OF THIS VERY MERGE — remote and local. A merge is not "done"
until its branch is gone:
  gh pr merge <PR#> --repo bymaxone/nest-realtime --squash --delete-branch
  git switch main && git pull
  git status                                                 # must be clean
  git worktree remove <implementer-worktree-path> --force    # if still present
  git branch -D "$BR" 2>/dev/null || true
  git push origin --delete "$BR" 2>/dev/null || true
  git ls-remote --heads origin "$BR"                         # MUST print nothing
  git branch --list "$BR"                                    # MUST print nothing
The last two are the proof: if either still shows the branch, the merge is NOT finished. Never
merge the instant CI goes green — honor the grace window in §5.1.

────────────────────────────────────────────────────────────────────────────
STEP 5 — Update the dashboards, then chain the next phase
────────────────────────────────────────────────────────────────────────────
Follow the development_plan §1.6 "Update protocol". ONE legend (📋🔄👀✅⛔🟡) — no
cross-vocabulary trap. Update BOTH dashboards + the phase file:
  • docs/development_plan.md §1.5 "Phase dashboard" — the phase row Status → ✅, Progress
    (N / N tasks), Last updated date; AND the Total row.
  • docs/development_plan.md §1.4 "Progress" — recompute (X / 6 phases + %, Y / 73 tasks),
    set Active phase to the next phase, and Blocked.
  • docs/tasks/README.md folder index — the phase row Status → ✅ + Tasks counter + the Total row.
  • docs/tasks/phase-NN-*.md — header Status → ✅ + Progress N/N + Completion log (if the
    implementer's per-task Completion Protocol did not already finalize it).
Confirm every §1.7 Global Done criterion is actually met AND that CI is green on the merged main —
verify via gh/git, not via any agent's narration; if any bullet is unmet use 🟡 Partial and keep
the phase not-Done.
Commit: docs(plan): mark Phase N complete   (no Co-Authored-By). Push.

Then LOOP: go to STEP 0 for the next phase. Before ending the turn, make sure there is ALWAYS
either a tracked background job pending or a ScheduleWakeup armed (§5.3) — never end a turn with
a dead gap, or the chain stalls waiting for a human.
```

---

## 3. Part B — The Implementer Prompt (steps 0–4 only)

> The orchestrator passes this verbatim to each spawned implementer subagent, substituting
> `{N}` with the phase number (1..6) and `{NN}` with the zero-padded number (01..06), and
> setting the Agent `model` per the §2 STEP 1 hybrid policy. The implementer runs in its own
> git worktree, opens the PR, returns the number, and STOPS.

```
You implement ONE phase of @bymax-one/nest-realtime end-to-end up to OPENING A PR, then you STOP
and return the PR number. You do NOT wait for the review bot, you do NOT merge, you do NOT spawn
any agent. The orchestrator owns all of that.

Project root: /Users/maximiliano/Documents/MyApps/bymax-one/nest-realtime
GitHub repo:  bymaxone/nest-realtime
Package:      @bymax-one/nest-realtime — a dual-transport NestJS realtime module. ONE server API
              (RealtimeService.emitToUser/emitToTenant/emitToRoom/broadcast/joinRoom/leaveRoom/disconnect)
              over SSE (default, @Sse()+RxJS) and WebSocket (opt-in, Socket.IO), plus a 'both' composite
              and React 19 hooks. Subpaths: . (server) / ./shared (zero-dep) / ./react. Zero runtime deps;
              @nestjs/common+@nestjs/core ^11, rxjs ^7.8, reflect-metadata ^0.2 are REQUIRED peers;
              @nestjs/websockets+@nestjs/platform-socket.io+socket.io ^4, @socket.io/redis-adapter ^8,
              ioredis ^5, react+react-dom ^19, socket.io-client ^4 are OPTIONAL peers (peerDependenciesMeta).
You are running in an ISOLATED git worktree — your branch, commits, and files do not touch the
main tree or any other agent. Create your branch with `git switch -c feat/phase-{N}-<slug>`
(NEVER `git checkout -b` — a git-guard hook blocks it).

YOUR PHASE: Phase {N}.
Read docs/tasks/phase-{NN}-*.md (the full task list, acceptance criteria, and rules-of-phase)
and the "REQUIRED READING" each task names — TOKEN ECONOMY: read ONLY your task's `### Task {N}.n`
block + that block's bounded REQUIRED READING, not the whole file or the whole plan/spec (see
docs/tasks/README.md "Token economy"; the phase files are ~1000–1600 lines — use Read offset/limit).

────────────────────────────────────────────────────────────────────────────
STEP 0 — Claim the phase (update BOTH dashboards + the phase file)
────────────────────────────────────────────────────────────────────────────
ONE legend (📋🔄👀✅⛔🟡):
  • docs/development_plan.md §1.5 "Phase dashboard" — phase row Status → 🔄 In Progress; AND
    §1.4 "Progress" Active phase → this phase.
  • docs/tasks/README.md folder index — phase row → 🔄 In Progress.
  • docs/tasks/phase-{NN}-*.md — header Status → 🔄 In Progress.

────────────────────────────────────────────────────────────────────────────
STEP 1 — Execute the phase, task by task
────────────────────────────────────────────────────────────────────────────
Invoke: /bymax-workflow:task phase {N}
Follow the skill exactly, tasks in dependency order (the "Depends on" column). For every task:
  • Verify the current official docs FIRST (context7) for any library you touch — never code an
    API from memory. NestJS 11 (@Sse() → Observable<MessageEvent>; MessageEvent {data,id,type,retry}
    from @nestjs/common; @WebSocketGateway/@WebSocketServer/OnGatewayConnection/OnGatewayDisconnect;
    the custom IoAdapter); RxJS ^7.8 (Subject/merge/takeUntil/finalize); socket.io ^4
    (Server/Socket, rooms, namespaces, server.in(id).disconnectSockets, the cors option);
    @socket.io/redis-adapter ^8 (createAdapter(pubClient, subClient)); ioredis ^5
    (duplicate() for the subscriber); EventSource/Last-Event-ID (MDN/WHATWG SSE); React 19.
    Resolve and query each before coding.
  • Implement to EVERY acceptance criterion; honor all rules-of-phase. Honor the transport
    invariants (spec §6/§10/§11 + Appendix B equivalent in §4 of this runbook):
      - SSE heartbeat is a raw `: keepalive\n\n` COMMENT written to the response by HeartbeatService
        — NOT a MessageEvent, NOT a named event, outside the event-id space, ABSENT from §13.
      - The SSE stream is torn down via close$ + takeUntil(close$) + finalize (no Subject/interval leak);
        disconnect() emits close$.next() then completes.
      - EventReplayBuffer injects the options token and parenthesizes the cap
        (`const cap = this.opts.sse?.replayBufferSize ?? 100`); event-ids are lexicographically
        orderable (zero-padded, fixed width) so since()/retrieveSince() string-compare correctly.
      - Cross-instance: public emit*/broadcast/disconnect do local delivery + a SINGLE publish; the
        pub/sub subscriber dispatches remote messages to the NON-publishing `*Local` methods only
        (emitToUserLocal/…/disconnectLocal) — never back into a publishing emit (the origin self-filter
        alone does NOT stop the A→B→A relay). `op:'disconnect'` is the cross-instance revocation producer.
        ioredis needs a separate pub vs sub connection (`pubClient.duplicate()`).
      - CompositeTransport.kind === 'sse' (never 'both'); ITransport.kind is 'sse' | 'websocket'.
      - maxConnectionsPerUser is FIFO eviction (evict the oldest, admit the new) — NEVER a 429.
      - WebSocket: the namespace comes from a custom IoAdapter (not the class decorator); cross-node
        revocation uses server.in(id).disconnectSockets(true); WS CORS is Socket.IO's own `cors` option;
        @socket.io/redis-adapter syncs MESSAGES, not handshake affinity → sticky sessions are REQUIRED
        when the polling fallback is on.
      - Frontend: socket.io-client is loaded via `await import()` only — it must NEVER be in the
        SSE-only static bundle; let native EventSource handle reconnect (it resends Last-Event-ID).
      - The reserved-event constant is `RESERVED_EVENT_NAMES` (single-sourced in ./shared); it has NO
        HEARTBEAT member.
  • TDD where the task says so (red → green → refactor).
  • After each task, run the relevant gates and FIX any failure before the next task (run from the
    project root; MEMORY-SAFE — Jest maxWorkers '50%' baked in, never fan out):
      pnpm typecheck
      pnpm lint                 # zero warnings; no eslint-disable / @ts-ignore
      pnpm test:cov             # 100% line/branch on every file implemented
      pnpm size                 # KiB-brotli budgets (after a task that changes the exported surface)
      # SSE E2E from Phase 2 (needs the `eventsource` Node client); WS E2E from Phase 4 (socket.io-client
      # + Docker for Testcontainers Redis); cross-instance pub/sub E2E from Phase 3 (worker_threads + Redis,
      # excluded from the per-PR path — runs in the scheduled workflow):
      pnpm test:e2e -- --testPathIgnorePatterns=cross-instance
  • Apply the per-task Completion Protocol (README "Self-update protocol"): task Status ✅ in its
    block + the Task index row, tick acceptance checkboxes, bump the file-header Progress (n/N),
    update the Phase {N} row Progress in development_plan §1.5, append the Completion-log line, and
    commit with Conventional Commits: <type>(realtime): <subject> ({N}.<task>)  — type ∈
    {feat, fix, chore, docs, refactor, test, ci}; NO Co-Authored-By trailer.
Technical priority order: security → correctness → performance → ergonomics.

────────────────────────────────────────────────────────────────────────────
STEP 2 — Phase-wide gates (must all pass)
────────────────────────────────────────────────────────────────────────────
  pnpm typecheck
  pnpm lint
  pnpm test:cov       # 100% line/branch per implemented file — hard gate
  pnpm build          # dist/ has .mjs + .cjs + .d.ts for all 3 subpaths (. / ./shared / ./react)
  pnpm size           # server ≤ 18 KiB brotli, shared ≤ 3 KiB, react SSE-only ≤ 4 KiB — hard gate
  pnpm test:e2e -- --testPathIgnorePatterns=cross-instance   # SSE (Phase 2+) / WS (Phase 4+); Docker for Redis
  # invariant gates (must find nothing):
  ! grep -rnE '@nestjs/jwt|@bymax-one/nest-auth|passport' src/    # auth inversion — zero concrete auth in src/
  ! grep -q "socket.io-client" dist/react/index.mjs              # socket.io-client absent from the SSE-only bundle (after a build that emits ./react)
Mutation testing (Stryker `break 95`, high 99, low 95) is the DEDICATED Phase 6 pre-release gate —
NOT per task/commit.
MEMORY-SAFE: bound Jest workers (`maxWorkers: '50%'`, baked into the configs;
`NODE_OPTIONS=--max-old-space-size=4096` as a guard), one suite at a time, one Testcontainers Redis
at a time; never run both the unit and E2E suites concurrently; never fan out parallel test agents
(long-lived SSE/WS connections + worker_threads + Redis containers OOM / saturate cores otherwise).

────────────────────────────────────────────────────────────────────────────
STEP 3 — Reviews (iterate to zero findings)
────────────────────────────────────────────────────────────────────────────
Invoke /bymax-quality:code-review — fix ALL findings (every severity, down to nit), then re-run
until it reports zero. Watch especially for: a heartbeat emitted as a MessageEvent / a `HEARTBEAT`
member added to RESERVED_EVENT_NAMES; a cross-instance emit that re-publishes (A→B→A loop) or a
missing `*Local` path; CompositeTransport.kind === 'both'; a 429 for maxConnectionsPerUser instead
of FIFO eviction; a missing close$/takeUntil teardown (Subject leak); socket.io-client statically
imported in ./react; a public export untyped/undemonstrated; files >800 lines / functions >50; a
missing `@fileoverview` + `@layer` header; any Phase/task reference left in shipped source or
.github config.
Invoke /security-review — fix ALL findings including Low. Pay special attention to (spec §8/§9.5 +
Appendix B-equivalent in §4):
  • AUTH INVERSION is structural — `src/` NEVER imports `@nestjs/jwt`/`@bymax-one/nest-auth`/`passport-*`;
    all auth flows through the consumer-provided IConnectionAuthenticator. (CI greps `src/` → zero.)
  • EventSource cannot send custom request headers → auth is cookie (HttpOnly) or the ticket pattern
    (one-shot, short TTL, query-string); Bearer is WebSocket-only (socket.handshake.auth). Never tell
    the consumer to put a token in an EventSource header.
  • connection:established emits a CLIENT-SAFE trait subset ({userId, tenantId, roles}) — never the full
    AuthenticationResult (its `metadata`/`roles` may carry server-only data).
  • Multi-tenant anti-IDOR — the lib does NOT validate that the tenantId passed to emitToTenant matches
    the caller; the consuming app must (documented). Rooms are user:{id}/tenant:{id}/resource:{t}:{id}.
  • Cross-instance revocation actually works (op:'disconnect' producer + consumer; WS uses the
    adapter-aware disconnectSockets) — a stale revoked SSE/WS stream must not stay open.
  • SSE is broken by HTTP body compression (`compression` middleware / a global ClassSerializerInterceptor)
    and by proxy buffering → exclude text/event-stream, send `Cache-Control: no-cache, no-transform` +
    `X-Accel-Buffering: no`, nginx `proxy_buffering off`. HTTP/2 does NOT gzip bodies (HPACK = headers).
  • Sticky sessions are MANDATORY for horizontally-scaled WebSocket with the polling fallback enabled —
    the Redis adapter does not remove the handshake-affinity requirement.
  • ioredis: a subscribed connection cannot issue normal commands → separate pub vs sub via `.duplicate()`;
    self-echo avoided via an instance origin id.
  • Secrets only via env; the secret-scan stays clean (no real tokens committed; dev/test values only).
Re-run until zero. Re-run the STEP 2 gates after the review fixes.

────────────────────────────────────────────────────────────────────────────
STEP 4 — Open the PR, return its number, STOP
────────────────────────────────────────────────────────────────────────────
Invoke /push (creates the branch if needed, commits anything outstanding, pushes, opens the PR
against main). Then return EXACTLY the PR number and head branch as your final message, e.g.
"PR #7 on branch feat/phase-1-foundation-sse". Do NOT wait for CI or the review bot. Do NOT merge.
Do NOT spawn anything. STOP.

────────────────────────────────────────────────────────────────────────────
MANDATORY CONVENTIONS
────────────────────────────────────────────────────────────────────────────
See docs/PHASE_EXECUTION_PROMPT.md §4 — apply every rule there. Highlights: zero runtime deps
(`"dependencies": {}`; @nestjs/* + rxjs + reflect-metadata required peers; socket.io / @nestjs/websockets /
@nestjs/platform-socket.io / @socket.io/redis-adapter / ioredis / react / react-dom / socket.io-client
OPTIONAL peers); current API only (NestJS 11 @Sse/@WebSocketGateway, socket.io v4, @socket.io/redis-adapter v8,
RxJS 7); transport invariants (heartbeat = `: keepalive` comment not a MessageEvent; close$/takeUntil teardown;
`*Local` non-publishing path + op:'disconnect'; CompositeTransport.kind='sse'; FIFO eviction not 429;
RESERVED_EVENT_NAMES has no HEARTBEAT; socket.io-client never in the SSE-only bundle; sticky sessions for
scaled WS+polling); auth inversion (no concrete auth in src/); TS strict / zero `any` / no suppression
comments; 100% line+branch per file; functions ≤50 lines, files ≤800; `@fileoverview` + `@layer` header +
JSDoc on every export; KiB-brotli bundle budgets (server ≤18 / shared ≤3 / react SSE-only ≤4); English-only
TIMELESS comments (no Phase/Task refs in committed source or .github config — the runbook and planning docs
may name phases, the shipped code may not); Conventional Commits with NO Co-Authored-By trailer;
`git switch -c` (never checkout -b); no .gitkeep / empty-dir placeholders; memory-safe tests
(Jest maxWorkers '50%', one suite at a time, never fan out).
```

---

## 4. Mandatory conventions (apply in every phase)

These derive from `docs/development_plan.md` (§1.1 Development strategy, §1.2 Guiding principles,
§1.7 Global Done criteria), `docs/technical_specification.md` (§1.6 Design principles, §6 Transports,
§8 Auth, §9 Rooms/Multi-tenant, §11 Horizontal scalability, §13 Event catalog, §14 Error catalog,
§15 What is NOT in the package, §16 Dependencies, §18 Known limitations), `docs/tasks/README.md`,
and the Bymax Code-Craft Standard.

### Dependencies & API surface
- **Zero runtime deps** — `package.json` ships `"dependencies": {}`. `@nestjs/common ^11`, `@nestjs/core ^11`,
  `rxjs ^7.8`, `reflect-metadata ^0.2` are **required** peers. `@nestjs/websockets ^11`,
  `@nestjs/platform-socket.io ^11`, `socket.io ^4`, `@socket.io/redis-adapter ^8`, `ioredis ^5`,
  `react ^19`, `react-dom ^19`, `socket.io-client ^4` are **optional** peers (`peerDependenciesMeta`),
  installed per transport / per subpath.
- **Three subpaths** — `.` (server), `./shared` (zero-dep types + constants, re-exported by the server
  barrel — `RESERVED_EVENT_NAMES`/`ROOM_PREFIXES` are single-sourced here), `./react` (peer React 19).
- **Transport-agnostic API** — `RealtimeService` is identical across SSE / WebSocket / 'both'; switching
  transport is a one-line config change. `ITransport.kind` is `'sse' | 'websocket'`; the module-level
  `TransportMode` is `'sse' | 'websocket' | 'both'`. `CompositeTransport.kind === 'sse'` (dominant).
- **Current API only (context7 first)** — NestJS 11 `@Sse()`/`@WebSocketGateway()`, socket.io v4,
  `@socket.io/redis-adapter` v8 `createAdapter(pub, sub)`, RxJS 7. Never code an API from memory.

### Transport correctness (the audited invariants — highest engineering priority)
- **SSE heartbeat is a raw `: keepalive\n\n` comment** written to the response stream by `HeartbeatService`
  — NOT a `MessageEvent` (the `@Sse()` Observable can't emit comment lines and would consume an auto-id
  that corrupts `Last-Event-ID`), NOT a named event, ABSENT from the §13 reserved-event catalog.
- **RxJS teardown** — one `Subject<MessageEvent>` + one `close$` per connection; the stream is
  `merge(replay$, subject$).pipe(takeUntil(close$), finalize(...))`; `disconnect()` does `close$.next()`
  then `close$.complete()`. Completing only the subject is insufficient for a server-initiated close.
- **EventReplayBuffer** — inject the options token; parenthesize the cap
  (`const cap = this.opts.sse?.replayBufferSize ?? 100; if (buf.length > cap) buf.shift()`); event-ids are
  lexicographically orderable (zero-padded fixed width) so `since()`/`retrieveSince()` string-compares hold.
- **Cross-instance fan-out** — public `emit*`/`broadcast`/`disconnect` = local delivery + a SINGLE
  `IRealtimePubSub.publish`; the subscriber dispatches remote messages to the NON-publishing `*Local`
  methods only (no re-publish → no A→B→A loop; the origin self-filter is a secondary guard). `op:'disconnect'`
  is the cross-instance revocation producer; WS uses the adapter-aware `server.in(id).disconnectSockets(true)`.
  ioredis pub/sub needs a separate sub connection via `.duplicate()` (a subscribed client can't issue commands).
- **WebSocket** — the config-driven namespace + handshake cookie/auth extraction live in a custom `IoAdapter`
  (the `@WebSocketGateway()` decorator is evaluated at class-definition time); `@socket.io/redis-adapter`
  takes two clients; WS CORS is Socket.IO's own `cors` option (separate from HTTP CORS); **sticky sessions
  are MANDATORY** for a horizontally-scaled WS with the polling fallback (the adapter syncs messages, not
  handshake affinity).
- **FIFO connection limit** — exceeding `maxConnectionsPerUser` evicts the user's OLDEST connection (closed
  with `REALTIME_TOO_MANY_CONNECTIONS`) and admits the new one — NEVER a 429.
- **Frontend bundle** — `socket.io-client` is loaded via `await import()` only and must NEVER appear in the
  SSE-only static bundle (`grep socket.io-client dist/react/index.mjs` → zero); let native `EventSource`
  drive reconnect (it resends `Last-Event-ID`).

### Security (spec §8 / §9.5 / §18)
- **Auth inversion is structural** — `src/` NEVER imports `@nestjs/jwt`/`@bymax-one/nest-auth`/`passport-*`;
  all auth flows through the consumer-provided `IConnectionAuthenticator`. CI gate:
  `grep -rE '@nestjs/jwt|@bymax-one/nest-auth|passport' src/` returns zero. Bridge examples live only in
  `docs/`, mocks only in tests.
- **EventSource cannot send custom headers** → cookie (HttpOnly) or the ticket pattern (one-shot, short TTL,
  query string); Bearer is WebSocket-only. **No token in an EventSource header, ever.**
- **`connection:established` emits a client-safe trait subset** (`{userId, tenantId, roles}`) — never the
  whole `AuthenticationResult`.
- **Multi-tenant anti-IDOR** — the lib does not validate the `tenantId` passed to `emitToTenant`; the
  consuming app must. Room convention: `user:{id}`, `tenant:{id}`, `resource:{type}:{id}`.
- **SSE infra** — body compression (`compression` / a global `ClassSerializerInterceptor`) and proxy
  buffering break the stream → exclude `text/event-stream`, send `Cache-Control: no-cache, no-transform` +
  `X-Accel-Buffering: no`, nginx `proxy_buffering off`. HTTP/2 does not gzip bodies.
- **Secrets only via env; secret-scan stays clean** — dev/test values only; no real keys committed.
- **Supply chain** — SHA-pinned Actions, least-privilege `permissions:`, dependency-review + codeql +
  scorecard + secret-scan clean, committed lockfile, npm publish with **provenance** (OIDC trusted
  publishing), an `npm-publish` environment approval gate + a tag↔`package.json` version-match guard on
  `release.yml`.

### Error handling
- **Typed error catalog** — the `REALTIME_*` codes (§14); FIFO eviction surfaces `REALTIME_TOO_MANY_CONNECTIONS`
  (not 429); `REALTIME_REPLAY_BUFFER_MISS` falls back to `IOfflineQueueStorage` or is unrecoverable. No
  stringly-typed errors.

### Quality floor
- **TS strict, zero `any`** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); no
  suppression comments (`@ts-ignore`, `eslint-disable`).
- **100% line + branch coverage** on every implemented file (`pnpm test:cov`, `jest.coverage.config.ts`
  thresholds `100/100/100/100`) — hard gate.
- **Mutation `break 95`** (high 99, low 95, driven toward 100) — Stryker, a **Phase 6 pre-release** gate
  (not per task/commit); survivors documented as provable equivalents in `docs/mutation_testing_results.md`.
- **Bundle budgets (KiB-brotli)** — `dist/server/index.mjs` ≤ 18 KB brotli, `dist/shared/index.mjs` ≤ 3 KB,
  `dist/react/index.mjs` (SSE-only) ≤ 4 KiB (`pnpm size`); socket.io / @nestjs/websockets / ioredis stay
  external to the bundle.
- **Clean Code sizing & SRP** — functions ≤ 50 lines, files ≤ 800 (200–400 typical); one responsibility per
  file/function. Over the limit is a HIGH code-review finding.
- **`@fileoverview` + `@layer` header on every file; JSDoc on every export** (with `@example` where applicable).
- **CI green from the first PR** — `ci`/`codeql`/`scorecard` + `.github/dependabot.yml` are created in
  **Phase 1 (Task 1.16)** and every per-PR gate is incremental-safe (jest `--passWithNoTests`, coverage on
  implemented files, size budgets); `release.yml` + `e2e-cross-instance.yml` are finalized in **Phase 6**
  (release.yml is tag-driven and inert until then). The job names are contractual (branch protection
  references them) — do not rename them mid-roadmap.

### Memory safety
- **One implementer at a time; one suite at a time; bounded Jest workers** (`maxWorkers: '50%'` baked into
  the configs; `NODE_OPTIONS=--max-old-space-size=4096`). One Testcontainers Redis at a time (Phase 4 E2E);
  the Phase 3 cross-instance suite spins multiple `worker_threads` against Redis — bound it and keep it out
  of the per-PR path (scheduled `e2e-cross-instance.yml`).
- **Never fan out parallel `Agent`/`Workflow` runs that execute a test suite**; never run the unit and E2E
  suites at once. Long-lived SSE/WS connections + worker_threads + Redis containers multiply memory fast.

### Comments, git & commits
- **Timeless, English-only comments** — never reference `Phase N` / `Task N` / plan stages in committed
  source, JSDoc, or `.github/**` docs-as-config (the runbook and the planning docs may; shipped code/config
  may not). A reference to a doc SECTION (`spec §6.1`, `plan §1.5`) is allowed.
- **`git switch -c` to branch** — never `git checkout -b` (hook-blocked). **No `.gitkeep`** / empty-dir
  placeholders.
- **Conventional Commits** — `feat/fix/chore/docs/refactor/test/ci(realtime): …`; **never** a
  `Co-Authored-By` (or any AI-attribution) trailer.

---

## 5. Operational playbook (the lessons, as concrete procedure)

### 5.1 Merge gate — a conjunction, after a bounded grace window
Never merge the instant CI goes green. A second bot review can land ~90 s after a push; merging too early
turns it into a stray follow-up PR. Merge only when ALL hold:
- **CI green** — `gh pr checks <N> --json bucket` shows **0 fail and 0 pending** (the pipeline has many
  required jobs — install, typecheck, lint, test:cov, build, size, e2e (excl. cross-instance),
  dependency-review, codeql, scorecard, secret-scan — all must pass).
- **No pending review** — `gh pr view <N> --json reviewRequests` is an empty array.
- **No open bot threads** — every `reviewThreads` node `isResolved: true`.
- **No bot review newer than the pending HEAD** — compare each `reviews[].submittedAt` against
  `commits[-1].committedDate`.
- **Grace elapsed** — **≥ 4–5 min since the last push**, measured concretely (record the push time; compute
  elapsed — do not eyeball it).

After a fix-push, the poll has **two valid exit criteria**:
- `COPILOT_REREVIEWED` — a review with `submittedAt` > HEAD `committedDate` arrived, **or**
- `GRACE_NO_REVIEW` — `reviewRequests` empty **and** the grace window has elapsed with no new review (covers
  PRs where the bot doesn't re-review).

Don't idle during the window — sync main, read the next phase, pre-draft thread replies — so the merge is
immediate when the gate opens.

### 5.2 Resolving bot threads (anti-stale)
- **Re-fetch thread IDs FRESH each time**, and check `viewerCanResolve`. Thread IDs change when the bot
  re-reviews a new commit; reusing an old ID returns `NOT_FOUND` and looks (falsely) like a permission error.
- **Respond + resolve one call at a time** — do NOT batch GraphQL mutations (one failure cancels its
  siblings). Verify `isResolved: true` before declaring a thread done. Cite the **real fix SHA** in each reply.

### 5.3 Autonomy backbone — never end a turn with a "dead gap"
- The chain stays alive only while there is **always** either a tracked background job pending **or** a
  `ScheduleWakeup` armed. End a turn with neither and nothing re-invokes the loop — the chain stalls waiting
  for a human.
- `ScheduleWakeup` is a **long fallback (1200 s+)**, not a poll. Don't use a short interval to "poll" tracked
  work (it auto-notifies on completion). Re-arm it each relevant turn with a prompt describing the **current**
  state (not a stale one).
- **Silent-death detection**: an implementer worktree still at base (0 commits) after ~60 min with no
  completion notification ⇒ suspect death; investigate file mtimes (recent = alive; stale = dead) → re-spawn.
  Signs of life: worktree locked, new files, recent mtimes. The Phase-3 cross-instance (worker_threads) and
  Phase-4 E2E (Testcontainers) runs are slow — give those phases a wider window before declaring death.

### 5.4 Worktree discipline
- **Every file-writing subagent runs in its own worktree** (`isolation: "worktree"`), **one agent per
  directory**. Two agents in the same tree collide — uncommitted edits mix and the husky hook breaks on the
  blended tree (recovery: kill both, `git reset --hard` + `git clean -fd`, re-run isolated).
- **Release a branch before a fix-agent touches it.** A branch is pinned to the worktree that created it; git
  refuses the same branch in two worktrees. Remove the prior worktree first: `git worktree remove <path> --force`.
- **Clean up on merge — always delete the merged PR's own branch** from BOTH the remote and the local repo.
  Order: `gh pr merge --squash --delete-branch` → `git worktree remove <path> --force` → `git branch -D
  <branch>` → `git push origin --delete <branch>` (fallback) → verify with `git ls-remote --heads origin
  <branch>` AND `git branch --list <branch>` (both must print nothing — §STEP 4). Prune stale worktrees:
  `git worktree prune`.

### 5.5 Anti-hallucination — verify, never trust narration
- An agent's final message **can confabulate state** (claims fixes it didn't make, invents a SHA). **Always
  confirm real state via git/gh**, never via the agent's prose.
- **`TaskList` is unreliable here** (has returned empty with jobs still active). The real "still running"
  signal is the **absence of a completion task-notification**.
- **Never `Read` an agent's `.output` file** — it's the JSONL transcript and will blow your context. Only read
  the output files your **bash polls** write.

### 5.6 Concrete `gh` signal vocabulary
- **CI status:** `gh pr checks <N> --repo bymaxone/nest-realtime --json bucket` → count `pass` / `fail` / `pending`.
- **Pending review:** `gh pr view <N> --json reviewRequests` (empty = nothing queued).
- **Re-review detection:** `reviews[].submittedAt` vs `commits[-1].committedDate`.
- **Threads (GraphQL):** `reviewThreads.nodes[]` → `isResolved`, `viewerCanResolve`,
  `comments[0].databaseId` (the comment to reply under).
- **PR identity:** `gh pr view <N> --json number,headRefName,state,mergeStateStatus`.

---

## 6. The roadmap & the final phase

All 6 phases run in **this** repo (`bymaxone/nest-realtime`). The sequence (see
`docs/development_plan.md` §1.5 and the per-phase files in `docs/tasks/`):

`Phase 1` Foundation + SSE Transport — contracts + registries + `EventReplayBuffer` + `HeartbeatService`
(`: keepalive` comment) + `SseTransport`/`SseController` + `RealtimeService` + `forRoot` + **the CI skeleton
(Task 1.16: ci/codeql/scorecard/dependabot — CI from day one)** [16 tasks, MEDIUM] → `Phase 2` Auth +
Last-Event-ID + Reauthentication — the three auth patterns, `SseSubscriptionHandler` (FIFO eviction),
replay wiring, periodic reauth, lifecycle hooks, `forRootAsync` [12, MEDIUM] → `Phase 3` Horizontal Scaling
(SSE) — `IRealtimePubSub` fan-out with the non-publishing `*Local` path + `op:'disconnect'`,
`RedisRealtimePubSub`, `IOfflineQueueStorage`, worker_threads multi-instance tests [11, HIGH] → `Phase 4`
WebSocket Transport — `RealtimeGateway` + custom `IoAdapter` (handshake auth + namespace) +
`@socket.io/redis-adapter` + sticky-session docs + `CompositeTransport` ('both') [12, HIGH] → `Phase 5`
Frontend (`./react`) — `useRealtime`/`useRealtimeConnection`/`usePresence`/`RealtimeProvider`, the dynamic
socket.io-client import + SSE-only bundle proof [12, MEDIUM] → **`Phase 6` Release v0.1.0** [10, LOW].

Dependency notes: the track is linear (1 → 2 → 3 → 4 → 5 → 6); every phase's `Depends on` references resolve
to earlier task IDs (verified — 73 tasks total). Phase 3 and Phase 4 are the highest-complexity phases (the
cross-instance fan-out loop + worker_threads simulation; the IoAdapter handshake auth + redis-adapter +
sticky-session).

**Phase 6 is the finish line**: author `README.md` (badges, the 4 Quick-Start scenarios — single-instance
SSE, SSE + Redis pub/sub, WebSocket-only, `'both'` migration —, Auth-Inversion section, configuration,
replay/offline, frontend, horizontal scaling, infra notes), `CHANGELOG.md`/`SECURITY.md`/`CLAUDE.md`/
`AGENTS.md` + the four Copilot review files; **FINALIZE & harden the CI workflows** created in Phase 1 (add
the hardened `release.yml` — OIDC trusted publishing, `npm-publish` environment gate, tag↔version guard — and
the scheduled `e2e-cross-instance.yml`); enforce the KiB-brotli bundle budgets; run the Stryker mutation gate
(`break 95`) and record `docs/mutation_testing_results.md`; run the complete pre-publish gate; then tag
`v0.1.0` and `pnpm publish --provenance`. When all of Phase 1–6 are ✅ and CI is green on main, the
orchestrator reports completion and STOPS.

> **CI is not a final phase here — it exists from Phase 1 (Task 1.16)** and gates every single PR. The job
> names are contractual (branch protection references them); do not rename them mid-roadmap. Phase 6 only
> *finalizes* CI (adds the release + scheduled cross-instance workflows) and publishes the package.
