# Mutation Testing Plan — @bymax-one/nest-realtime

## Strategy

### Tool

[Stryker Mutator](https://stryker-mutator.io/) with the following configuration (see `stryker.config.json`):

| Setting | Value |
|---|---|
| Test runner | `jest` (via `@stryker-mutator/jest-runner`) |
| TypeScript checker | `@stryker-mutator/typescript-checker` |
| Coverage analysis | `perTest` |
| Concurrency | `2` (memory-safe for this repository size) |
| Report path | `reports/mutation/mutation.html` |
| Incremental state | `reports/stryker-incremental.json` |

### Thresholds (Bymax library standard)

| Threshold | Value | Meaning |
|---|---|---|
| `high` | **99** | Reported as "high quality" |
| `low` | **95** | Reported as "low quality" (warning) |
| `break` | **95** | Fails the run — do not lower this |

These match the Bymax portfolio standard (same as `nest-logger`, `nest-auth`, `nest-cache`). `@bymax-one/nest-realtime` is the largest library in the portfolio; document genuinely equivalent mutants inline rather than lowering the bar.

### Mutated files

Stryker mutates all files matching:

```
src/server/**/*.ts
```

Excluding:
- `src/server/**/*.spec.ts` — test files
- `src/server/**/index.ts` — barrel re-exports (no logic)
- `src/server/interfaces/**` — interface-only files (no runtime code)
- `src/server/**/*.interface.ts` — interface-only files

The `src/shared/` and `src/react/` directories are not mutated (constants + pure types in shared; React hooks tested separately).

### Run command

```bash
pnpm mutation
```

**Run manually, pre-release only** — not in per-commit CI. Running time is approximately 15–25 minutes on a developer machine. The CI pipeline (`ci.yml`) does not include mutation testing; it is exercised once before tagging a release.

Incremental mode (for iterative development after the first baseline):

```bash
pnpm mutation:incremental
```

### Equivalent mutant documentation

When a mutant genuinely cannot be killed (true equivalent), document it — with a file:line reference, the mutator, and a justification proving equivalence — in the "Documented equivalent mutants" section of [`mutation_testing_results.md`](./mutation_testing_results.md). This is the convention used in this project (no inline suppressions were added). An inline `// Stryker disable next-line <Mutator>: <reason>` annotation is an acceptable alternative where it reads more clearly at the call site:

```typescript
// Stryker disable next-line ArithmeticOperator: <reason why the mutant is equivalent>
const offset = base + delta
```

Never suppress by lowering `thresholds.break`. Every documented equivalent (or suppression) requires a clear, provable reason.

---

## Critical Paths (≥ 95% required)

These files represent the core correctness invariants of the library. Any surviving mutant here must be documented as a proven equivalent.

| File | Why critical |
|---|---|
| `src/server/services/connection-registry.service.ts` | FIFO eviction, per-user connection tracking |
| `src/server/services/room-registry.service.ts` | Room membership, multi-tenant scoping |
| `src/server/transports/sse/sse.transport.ts` | SSE delivery, connection Subject lifecycle |
| `src/server/transports/sse/event-replay-buffer.ts` | Last-Event-ID ring buffer correctness |
| `src/server/services/event-id-generator.service.ts` | Monotonic ID generation for replay |
| `src/server/transports/sse/encode-sse-event.ts` | SSE wire-format encoding correctness |
| `src/server/pubsub/realtime-pubsub-subscriber.ts` | Echo-prevention, local-only re-emit |
| `src/server/transports/composite/composite.transport.ts` | Dual-transport fan-out correctness |
| `src/server/config/validate-options.ts` | Option validation prevents invalid configs |

---

## Incremental Workflow

After the first full baseline:

1. Make code changes.
2. Run `pnpm mutation:incremental` — Stryker re-tests only affected mutants.
3. If new surviving mutants appear, either fix the tests or document the equivalence.
4. Before tagging any release, run `pnpm mutation` (full, not incremental) to confirm the final score.
