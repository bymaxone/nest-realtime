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
  Editing notes: AGENTS.md in bymaxone/.github.
-->

These rules hold in every Bymax repository. What is specific to this one is written after this
block, and the two are read together.

The pipeline already enforces formatting, linting, dependency policy, coverage and — where the
repository has one — the mutation gate. Do not spend a review on a **violation** of one of those: it
is a red check, not a comment. What follows is what CI cannot see.

A violation of a rule in this block is reported at **P1** at minimum. Codex surfaces only P0 and P1
on a pull request, so a rule whose violations land at P2 is a rule nobody sees.

**When a rule moves from here into a check, it leaves here.** A red check is proportionate to a
correctness failure that is invisible without it, and disproportionate to style enforced at an
inconvenient moment. Never carry both: a rule stated here _and_ enforced by CI spends a reviewer's
attention on what a gate already reports.

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

| Claim about                             | Read this                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| A library's API **shape**               | `node_modules/<pkg>/dist/**/*.d.ts` in this tree                               |
| A library's **runtime behaviour**       | that version's changelog entry, its documentation, or a test that exercises it |
| A commit's author or committer identity | out of scope: it is not text a change introduces                               |
| What a file contains                    | the file at the revision under review, not an earlier one                      |

The first two rows are separate on purpose: a `.d.ts` settles what a signature accepts and nothing
about what the implementation does with it, so a behavioural claim resting on one is unfounded.

Weight the checking by what acting on the finding would cost. A comment that asks for a reworded
sentence is cheap to be wrong about; one that asks for history to be rewritten, a merge reverted, or
a release pulled is not — verify that class before raising it, and raise it at the severity the
evidence supports rather than the severity the consequence would deserve if true.

### A bug reproduces, and a finding is this change's

Unless a rule here says to report without one, raise a bug only with its trigger: the input or
repository state, the command, the wrong result. Letting through what should be refused is P1 at
least, as is a crash an untrusted caller can trigger; a refusal, or a crash no untrusted caller can
reach, on input the project does not claim to support is not. Behaviour already present at the merge
base belongs to another change. On new commits, review what changed since the last reviewed commit.
A thread is settled only when the reply cites evidence that disproves the finding (a command, a
test, a file:line) or the code it names changed; a resolved thread or a bare reason is not evidence,
so re-check the current code and raise the finding again only if its trigger still reproduces. One
comment per root cause, its siblings named in it.

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
last one: adopting `@bymax-one/nest-cache` 1.1.0 → 1.2.1 skipped 1.2.0, whose entry holds a security
fix. Diff the `.d.ts` of the **previously adopted** version against the **proposed** one — `npm
pack` both, and name the two versions. Reaching for "the installed declarations" is the trap: in a
checkout of the branch under review the installed tree is already the new version, so that diff
compares a release with itself and shows nothing.

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

### A key built from more than one field keeps its boundaries

A key or digest derived from **two or more variable fields** must not let a field's content move the
boundary between them. `${tenantId}:${recipient}` makes `('a:b','c')` and `('a','b:c')` one key,
which no digest strength repairs, and one tenant's lookup then resolves another's record. Rejecting
empty fields does not fix it, and neither does a caller that validates its input — the property has
to hold in the construction. A fixed prefix beside a single field is not this shape.

**Safe path:** encode each field so it cannot contain the delimiter, or hash each to a fixed width.
Any other composition needs an argument that every boundary is recoverable, and one bounded field
does not rescue two free ones beside it. Then assert it in a test: where the property holds only
because of the values in play, the next one added takes it away and nothing says so.

### Comments state constraints, never history

A comment must read as true for whoever opens the file next. Flag any comment that narrates what a
previous version did, names a phase, task, ticket or review round, or explains a change rather than
the code. **Safe path:** state the constraint that still holds, and let `git log` carry the history.

Evidence for a constraint is not history, and how the evidence was obtained does not decide which it
is. The test is whether the fact still binds the next reader. A measurement that predicts what they
will hit on the other path — what the alternative did, what it costs in numbers — belongs beside the
constraint it supports, however it was obtained. What ages is the part that cannot recur for them:
what a previous version of this code did, a version number, a registry state, a review round, a
failure that has since been fixed. Flag those; keep the measurement.

### Size and layering

Functions over **50 lines** and nesting deeper than four levels are findings **for what a change
introduces** — a new function, or a change that pushes an existing one past the limit — in the
repository's own source and test directories. A test-suite grouping construct (`describe`, `context`,
`mod tests`, a table of cases) is not a function; the unit under the limit is the body of a single
`it`/`test`/`#[test]`. On the same terms, every non-trivial source file a change introduces opens
with a header stating its purpose and its layer, and every exported symbol a change introduces
carries a doc comment.

**The 800-line file limit applies to what a change introduces, not to what it inherits.** A
repository that already carries a file past the line — a generator, a long end-to-end suite — would
otherwise produce a finding on every pull request touching three lines of it, which the author
cannot act on and did not cause. Raise it for a **new** file over the limit, or when a change pushes
a file past it or materially grows one already over.

Markdown, generated output and lockfiles are **out of scope**: none has layers, and reporting their
length fires on every dependency bump and release note.

**Safe path:** extract by responsibility rather than by line count — the limit is a symptom, and one
file doing two jobs is the defect.

### Language and attribution

Everything published is English — source, comments, tests, commit messages, pull request titles and
bodies, `README.md`, `CHANGELOG.md` and everything under `.github/`.

Each repository states its language policy for `docs/` below this block. Report a language finding in
`docs/` only against what the repository states; where it states nothing, `docs/` is English like
everything else. A `docs/` language other than English is a repository-owner decision recorded in the
narrowings, not a convention a contributor may introduce.

No commit, pull request, comment or code may attribute authorship to an AI assistant or coding tool,
in any form. **Only text the change introduces is in scope** — a trailer, a "generated with" line, a
signature in a comment or a description.

A commit's author and committer fields are not that: they come from the contributor's git
configuration rather than from the diff, and a review reading the diff cannot see them. Never report
an identity field, and never present a command's reconstructed output as evidence for one. Measured:
twenty-six such findings, every SHA resolving nowhere and every `git log` line unrun, each asking to
rewrite published history.

<!-- shared:end -->

## Where this repository narrows a shared rule

Only what a reviewer of **these** diffs gets wrong: each case is one where the type, the name or the
obvious reading says one thing and the runtime does another.

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

Four subpaths under `src/`, listed in `CLAUDE.md`: `server/` (`.`), `websocket/` (`./websocket`, the
only graph that imports Socket.IO), `shared/` (`./shared`), `react/` (`./react`), plus `internal/`
(`./internal`, not public API: the one bundle both server entries import, so classes and `Symbol`
tokens keep one identity). The directory tree, the transport details, the registry shapes, the React
hook signatures, the test patterns and the error-code table are in
[`docs/architecture/source-layout-and-reference.md`](docs/architecture/source-layout-and-reference.md).

---

## Transport Architecture

- `ITransport.kind` is `'sse' | 'websocket'`, never `'both'`. `CompositeTransport` (`transport: 'both'`)
  reports `kind === 'sse'`, because SSE is the dominant transport and WebSocket is the opt-in addition.
- The SSE heartbeat is a raw `: keepalive` comment line written by `HeartbeatService` at
  `sse.heartbeatMs` (default 30 s). It is **not** a `MessageEvent` and is **not** assigned an event ID.
- `EventReplayBuffer` is a per-user ring buffer of the last `replayBufferSize` events. On reconnect,
  `SseSubscriptionHandler` replays what follows `Last-Event-ID` before the live stream.
- The Redis adapter is wired in `RealtimeIoAdapter` when `websocket.redisAdapter.pubClient` is given; it
  calls `.duplicate()` on that client for the subscriber, and the library never opens its own Redis
  connection. An adapter that cannot be installed fails the boot (`REALTIME_REDIS_ADAPTER_FAILED`); an
  unreachable Redis does not. The ESM bundle declares its own `require` for this load; `pnpm size` and
  `pnpm check:runtime` fail if that is lost.

---

## Cross-Instance Emit Shape

This invariant must be respected in all implementations and descriptions:

```
emitToUser(userId, event)
  ├─ 1. local delivery:  emitToUserLocal(userId, event)   (connections on THIS instance)
  └─ 2. publish once:    IRealtimePubSub.publish({ op: 'emitToUser', args: { userId, event, data, id } })

Subscriber (other instances): message arrives → emitToUserLocal(userId, event)   (no re-publish → no loop)
```

The same shape applies to `emitToTenant`, `emitToRoom` and `broadcast` (`op` is the method name).
Cross-instance revocation on SSE: `disconnect(connectionId)` closes a connection this instance owns and
stops there; only for a connection it does not own does it publish
`{ op: 'disconnect', args: { connectionId, reason } }`, and the subscriber calls
`disconnectLocal(connectionId)`. WebSocket reaches other instances through the Socket.IO adapter, when one is configured.

`RealtimePubSubSubscriber` must NOT re-publish what it receives (infinite loop): it ignores messages carrying
its own per-instance ID (`REALTIME_INSTANCE_ID_TOKEN`).

---

## Registries and Rooms

- When `maxConnectionsPerUser` is reached, the **oldest** connection is evicted (closed with
  `REALTIME_TOO_MANY_CONNECTIONS`) and the new one is admitted. The new connection is **never rejected
  with HTTP 429**.
- Auto-joined rooms: `user:{userId}` on every connect, `tenant:{tenantId}` when `tenantId` is present.
  Everything else is the consumer's, through `joinRoom` / `leaveRoom`.

---

## Authentication Flow

`IConnectionAuthenticator.authenticate(ctx)` returns an `AuthenticationResult` or `null`; `null` is
a 401 on SSE (`UnauthorizedException` carrying `REALTIME_AUTH_FAILED`) and a `connect_error` on
WebSocket (`err.data.code === 'REALTIME_AUTH_FAILED'`), refused in a Socket.IO middleware before the
socket connects; a throw (a blank identity included) is a generic `Internal Server Error` `connect_error`. A success is registered in
`ConnectionRegistry`, auto-joined to its rooms, and announced with `connection:established` when
`emitConnectionEvent` is true.

`roles` and `metadata` are stored on `ConnectionRecord.originalAuth` and surface on
`ConnectionEventMeta` in the three hooks that receive that type — `onConnect`, `onDisconnect` and
`onReauthenticationFailed`. `onError` takes a narrower payload (`connectionId?`, `error`, `transport`)
and carries neither, because it can fire before authentication resolves. Both are **connect-time
snapshots**: a `revalidate` that keeps the connection alive does not refresh either, and the library
never reads a key of `metadata`. That bag is the only channel from the handshake into the hooks:
`authenticate` sees the request headers but has no `connectionId` yet, and the hooks have the
`connectionId` but never see the headers.

### Re-authentication

With `reauthenticationPolicy.intervalSeconds` set, `ReauthenticationService` calls
`revalidate(connectionId, originalAuth)` periodically and caches a positive result for `cacheTtlMs`
(default 60 s). On failure `onFailure: 'disconnect'` (default) closes the connection and `'event'`
emits `connection:reauthentication-failed` instead.

---

## Offline Queue and Replay

When this instance holds no SSE connection for the user, `emitToUser` appends the event through
`IOfflineQueueStorage.append`, fire-and-forget: a queue failure never breaks the live emit. On reconnect,
`OfflineQueueDeliveryService` retrieves what the client missed since `Last-Event-ID`, de-duplicates it
against the replay buffer, and acknowledges only after the events reach a live subscriber, so a client
that drops mid-delivery keeps them durable (at-least-once).

---

## React Subpath Architecture

### `socket.io-client` dynamic import invariant

`RealtimeProvider` loads `socket.io-client` with `await import('socket.io-client')`. The static bundle
of `dist/react/index.mjs` must never contain a static `import ... from 'socket.io-client'` or
`require('socket.io-client')`; `pnpm size` checks this with a regex on the bundle.

---

## Testing Patterns

Unit-test and E2E patterns are in the reference file above.

### Stryker mutation testing

Configuration: `stryker.config.json` — thresholds `high: 100, low: 100, break: 100`.

`pnpm mutation:full` measures cold (~15 min); `pnpm mutation` is incremental and can be stale; see "`pnpm mutation` can report a stale score" above.

Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs, and only when a changed path matches `mutation-source-globs` in `ci.yml`. When nothing matches, the job skips its steps and still reports success — a green `CI passed` is not by itself evidence the gate ran. The weekly cold run lives in `mutation-full.yml`.

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

`REALTIME_ERROR_CODES` in `src/shared/constants/` is authoritative; the table of when each code is
emitted is in the reference file above.

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

## Session memory (Obsidian vault)

Lessons from earlier sessions live outside the repository, in the owner's Obsidian vault at `~/Documents/MyApps/obsidian/Brain/`, when it is present on this machine. Before a task, find this repository's hub under `02 - Areas/` (the table in `02 - Areas/Bymax/Bymax.md` maps each Bymax repository to its folder; otherwise search by name). Read the hub with its `Learnings.md` and `Decisions.md`, and the relevant stack notes under `03 - Resources/`. When the vault and the code disagree, the code wins. Record each non-obvious gotcha, root cause or decision in the hub as the vault's `_meta/conventions.md` describes; a repository without a hub gets one from `_meta/templates/project-hub.md`.
