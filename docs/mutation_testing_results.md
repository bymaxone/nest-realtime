# Mutation Testing Results — @bymax-one/nest-realtime

## v0.1.0 — 2026-06-30

### Run summary

| Attribute                 | Value                                            |
| ------------------------- | ------------------------------------------------ |
| Run date                  | 2026-06-30                                       |
| Tool                      | Stryker Mutator 8.x                              |
| Thresholds                | high: 99, low: 95, **break: 95**                 |
| **Global mutation score** (superseded — see the dated re-run) | **99.27% — 678 / 683**                           |
| Exit code                 | **0 (PASS — well above break threshold of 95%)** |
| Report                    | `reports/mutation/mutation.html`                 |

### Overall counts

| Status                                        | Count                                              |
| --------------------------------------------- | -------------------------------------------------- |
| Total mutants                                 | 1150                                               |
| Killed                                        | 671                                                |
| Timed out (counted as killed)                 | 7                                                  |
| **Survived**                                  | **5**                                              |
| Compiler/runtime errors (excluded from score) | 467                                                |
| **Effective mutation score**                  | **(671 + 7) / (671 + 7 + 5) = 678 / 683 ≈ 99.27%** |

### Score journey

The final score was reached across multiple rounds of targeted kill-test authorship, each verified by an orchestrator-owned Stryker run:

| Round     | Score      |
| --------- | ---------- |
| Baseline  | 81.99%     |
| Round 1   | 90.19%     |
| Round 2   | 95.75%     |
| Round 3   | 98.39%     |
| **Final** | **99.27%** |

### Run of 2026-08-02 — after the WebSocket entry-point split

| Metric                        | Value                  |
| ----------------------------- | ---------------------- |
| **Global mutation score**     | **99.25% — 666 / 671** |
| Killed                        | 659                    |
| Timed out (counted as killed) | 7                      |
| Survived                      | 5                      |
| No coverage                   | 0                      |

The five survivors are the same documented equivalent mutants in
`sse-subscription.handler.ts` listed below — a file this change does not touch.
**Every killable mutant is killed**, as in the previous run.

The score reads 99.25% against the earlier 99.27% because the denominator moved,
not because anything stopped being covered: the survivor set is byte-for-byte the
same five.

Re-measured after the shared runtime moved behind `./internal` and the Socket.IO
transports moved under `src/websocket/`: **identical — 659 killed, 7 timed out,
5 survived, 99.25%**. The change is structural, so the mutant set is the same
one relocated, and the paths in the table below reflect where those files live.

One further mutant was killed along the way, in a file this change does not
touch. `evictBeyondLimit` picks the oldest connection with
`reduce((a, b) => (a.connectedAt <= b.connectedAt ? a : b))`, and `<=` versus `<`
differs **only** when two connections share a timestamp — the tie the documented
FIFO eviction resolves by registration order. No test forced a tie, so the mutant
lived or died according to whether the clock happened to tie during the run, which
is why it surfaced intermittently rather than at the baseline. A test now opens two
connections at the same instant and asserts the first-registered is evicted.

The split itself was mutation-tested. Three mutants survived the first run, all
in the new `realtime-module.factory.ts` — the list of transports a module serves,
inside the message that rejects a transport it does not. Two kill tests now assert
that list, one per module: the root's names a single mode, the WebSocket module's
names two and so pins the separator, which a `join('')` mutant would drop.

---

### Methodology

Stryker runs were orchestrator-owned and authoritative. Kill tests were written by agent subagents targeting specific surviving mutants; the orchestrator re-ran Stryker after each round to confirm progress and detect regressions. No threshold was lowered and no `// Stryker disable` suppression was added to source files — every previously surviving mutant is either now killed or documented as a genuine equivalent mutant below.

---

### Per-file results

Every file except `sse-subscription.handler.ts` reached a 100% effective mutation score in the final run. That file's 5 surviving mutants are all genuine equivalent mutants (documented in the next section), so 100% of _killable_ mutants are covered.

| File                                              | Survived | Status                                      |
| ------------------------------------------------- | -------- | ------------------------------------------- |
| `config/default-options.ts`                       | 0        | ✅                                          |
| `config/validate-options.ts`                      | 0        | ✅ CRITICAL                                 |
| `factories/sse-controller.factory.ts`             | 0        | ✅                                          |
| `offline-queue/offline-queue-delivery.service.ts` | 0        | ✅                                          |
| `offline-queue/redis-offline-queue.ts`            | 0        | ✅                                          |
| `pubsub/in-memory-pubsub.ts`                      | 0        | ✅                                          |
| `pubsub/realtime-pubsub-subscriber.ts`            | 0        | ✅ CRITICAL                                 |
| `pubsub/redis-realtime-pubsub.ts`                 | 0        | ✅                                          |
| `services/connection-registry.service.ts`         | 0        | ✅ CRITICAL                                 |
| `services/event-id-generator.service.ts`          | 0        | ✅ CRITICAL                                 |
| `services/realtime.service.ts`                    | 0        | — (all compile-errors, excluded from score) |
| `services/reauthentication.service.ts`            | 0        | ✅                                          |
| `services/room-registry.service.ts`               | 0        | ✅ CRITICAL                                 |
| `transports/sse/event-replay-buffer.ts`           | 0        | ✅ CRITICAL                                 |
| `transports/sse/heartbeat.service.ts`             | 0        | ✅                                          |
| `transports/sse/sse-subscription.handler.ts`      | **5**    | ✅ All equivalent (documented below)        |
| `transports/sse/sse.transport.ts`                 | 0        | ✅ CRITICAL                                 |
| `websocket/transports/websocket/realtime-io-adapter.ts`     | 0        | ✅                                          |
| `websocket/transports/websocket/realtime.gateway.ts`        | 0        | ✅                                          |
| `websocket/transports/websocket/websocket.transport.ts`     | 0        | ✅                                          |
| `utils/compose-room-id.ts`                        | 0        | ✅                                          |
| `utils/encode-sse-event.ts`                       | 0        | ✅ CRITICAL                                 |
| `utils/parse-cookie-header.ts`                    | 0        | ✅                                          |
| `websocket/transports/composite/composite.transport.ts` | 0  | ✅ CRITICAL                                 |
| `websocket/websocket-wiring.ts`                   | 0        | ✅                                          |
| `realtime.module.ts`                              | 0        | ✅                                          |

---

### Critical path summary

| Critical file                    | Score | Target | Result |
| -------------------------------- | ----- | ------ | ------ |
| `connection-registry.service.ts` | 100%  | ≥ 95%  | ✅     |
| `room-registry.service.ts`       | 100%  | ≥ 95%  | ✅     |
| `sse.transport.ts`               | 100%  | ≥ 95%  | ✅     |
| `event-replay-buffer.ts`         | 100%  | ≥ 95%  | ✅     |
| `event-id-generator.service.ts`  | 100%  | ≥ 95%  | ✅     |
| `encode-sse-event.ts`            | 100%  | ≥ 95%  | ✅     |
| `realtime-pubsub-subscriber.ts`  | 100%  | ≥ 95%  | ✅     |
| `composite.transport.ts`         | 100%  | ≥ 95%  | ✅     |
| `validate-options.ts`            | 100%  | ≥ 95%  | ✅     |

---

### Status: PASS — Release threshold met by a wide margin

The global score of **99.27%** far exceeds the `break: 95` threshold. The `pnpm mutation` gate passes (exit code 0). The 5 remaining survivors are all genuine equivalent mutants (documented below); no test can distinguish them from a correct implementation without breaking semantics or asserting meaningless behavior.

The HTML report with per-mutant details is at `reports/mutation/mutation.html` (run `pnpm mutation` locally to regenerate).

---

## Documented Equivalent Mutants

The following 5 mutants survive because they are genuinely equivalent to the original code — no observable difference in behavior exists between the original and the mutant under any meaningful test input. They are documented here to justify not killing them. No `// Stryker disable` comment was added to source files; the justification lives in this document only.

All 5 are in `src/server/transports/sse/sse-subscription.handler.ts`.

---

### Mutant 1 — L192, ConditionalExpression: `replayEvents.length > 0` → `true`

When `replayEvents` is empty, `of(...[])` (spreading an empty array) emits zero values and immediately completes — which is observably identical to `EMPTY`. Replacing the guard with `true` means the `of(...replayEvents)` branch is always taken, but when the array is empty, the branch still produces an empty observable that completes immediately. No subscriber sees any difference in emitted values, timing, or completion signal.

**Proof of equivalence:** `of()` and `EMPTY` both call `subscriber.complete()` synchronously with zero `next` emissions. There is no side effect inside the branch that would fire when the array is empty.

---

### Mutant 2 — L192, EqualityOperator: `length > 0` → `length >= 0`

This mutation differs from Mutant 1 only when `length === 0`. When `length` is 0, `of(...[])` ≡ `EMPTY` (same zero-value completion), so the divergence point never produces an observable difference.

**Proof of equivalence:** `Array.length` is always `≥ 0`, so `>= 0` and `> 0` differ only at 0, which maps to the identical `of()` ≡ `EMPTY` case described above.

---

### Mutant 3 — L253, ConditionalExpression: `queueEvents.length > 0` → `true`

Same reasoning as Mutant 1, applied to the offline-queue replay branch. When `queueEvents` is empty, `of(...[])` completes with zero emissions — identical to `EMPTY`. Replacing the guard with `true` does not change the observable stream for the empty-queue case.

**Proof of equivalence:** The offline-queue replay path is structurally identical to the event-replay path; `of(...[])` ≡ `EMPTY` in both branches.

---

### Mutant 4 — L253, EqualityOperator: `length > 0` → `length >= 0`

Same reasoning as Mutant 2, applied to the `queueEvents.length` guard. The divergence point at `length === 0` maps to `of(...[])` ≡ `EMPTY`.

**Proof of equivalence:** `Array.length` is never negative; the only distinguishable value is 0, which is handled identically by both expressions.

---

### Mutant 5 — L241, ArrowFunction: `return () => inner.unsubscribe()` → `return () => undefined`

RxJS 7's subscription linkage automatically triggers teardown logic (including `finalize` operators) when the outer `Subscriber` closes, regardless of whether an explicit teardown function is returned from `subscribe`. The explicit `inner.unsubscribe()` call is therefore redundant: verified empirically, `finalize` fires identically in both variants during test execution. The teardown is a defensive pattern that improves clarity but does not alter observable behavior.

**Proof of equivalence:** RxJS 7 `Subscriber` auto-propagates unsubscription to chained observables via `_teardown`. The explicit teardown provides no additional signal because the inner observable's completion path is already wired through `finalize`.

---

## Re-run — 2026-08-06

| Metric              | Value            |
| ------------------- | ---------------- |
| **Mutation score**  | **100.00 %**  |
| Surviving mutants   | 0               |
| Break threshold     | 95 % -> PASS     |

All five survivors were equivalent, and proving the last one took running it rather than reading
it. `subscribePipeline` ends in `.subscribe(subscriber)`, and RxJS registers that source
subscription as a teardown of `subscriber` itself, so closing the outer one already unwinds the
inner — removing the explicit `inner.unsubscribe()` by hand leaves the suite green and the merged
subject unobserved. It stays because ownership should be explicit rather than inherited from that
linkage, and a test now pins the teardown whichever way it is achieved.

The other four are `of(...events)` against `EMPTY` on an empty array. `of()` with no arguments
emits nothing and completes, exactly as `EMPTY` does — checked, not assumed.

Every equivalence claim in this section was checked by running the mutant, not by reading it.
Where a `// Stryker disable next-line` directive was found not to apply — above a `} catch {`, a
`.replace()` inside a method chain, a multi-line `sort(...)` argument, or anywhere inside a
builder chain — it was replaced with the block `disable`/`restore` form, or, where that does not
work either, with a plain comment at the line so the reasoning is visible rather than silently
ineffective.

---

## Re-run — 2026-08-29 (v1.2.0)

| Metric             | Value                     |
| ------------------ | ------------------------- |
| **Mutation score** | **100.00 %**              |
| Killed             | 680                       |
| Timed out          | 7 (counted as detected)   |
| Surviving mutants  | 0                         |
| Break threshold    | 100 % -> PASS             |
| Cold running time  | 7 min 28 s                |

Run cold (`pnpm mutation:full`) three times over this change, and the two intermediate runs are
the point of recording it.

**First run: 99.42 %, four survivors — all of them string literals in error messages I had just
written.** The assertions used `toThrow(/fragment/)`, which pins the one clause the regex names
and leaves every other segment of a concatenated template free to be blanked. The messages here
are multi-part: the second half of the SSE-endpoint mismatch error is the half that tells the
consumer the fix is `sseEndpoint` on the registration, and a mutant that deletes it leaves an
error that still reads plausibly and diagnoses nothing. Fixed by pinning the whole message with
`toThrow('<full string>')` — Jest matches a string as a substring, so one assertion covers every
segment and any deletion fails it.

**Second run followed a test-only change and had to be re-run cold for that reason alone.**
`realtime.module.spec.ts` crossed 800 lines, so the new `describe` moved to
`realtime.module.async-endpoint.spec.ts`. Moving a spec is not a pure refactor here: Stryker's
`perTest` coverage attribution is computed from `jest.stryker.config.ts`'s `roots`, so a move can
change which tests are credited with covering a mutant without changing a line of source. The new
file sits under `src/`, which is inside `roots`, and the score held at 100 % — but that was
verified by running it, not assumed.
