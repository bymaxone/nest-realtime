# Mutation Testing Results — @bymax-one/nest-realtime

## v0.1.0 — 2026-06-30

### Run summary

| Attribute | Value |
|---|---|
| Run date | 2026-06-30 |
| Tool | Stryker Mutator 8.x |
| Duration | ~12 minutes |
| Thresholds | high: 99, low: 95, **break: 95** |
| **Global mutation score** | **⚠️ 81.99%** |
| Exit code | **1 (FAILED — below break threshold of 95%)** |
| Report | `reports/mutation/mutation.html` |

### Overall counts

| Status | Count |
|---|---|
| Total mutants | 1150 |
| Killed | 553 |
| Timed out (counted as killed) | 7 |
| **Survived** | **123** |
| Compiler/runtime errors (excluded from score) | 467 |
| **Effective mutation score** | **(553 + 7) / (553 + 123 + 7) = 560 / 683 ≈ 81.99%** |

---

### Per-file results

| File | Score | Killed | Timeout | Survived | Errors | Status |
|---|---|---|---|---|---|---|
| `config/default-options.ts` | 33.33% | 1 | 0 | 2 | 4 | ❌ LOW |
| `config/validate-options.ts` | 98.00% | 49 | 0 | 1 | 26 | ✅ |
| `factories/sse-controller.factory.ts` | 0.00% | 0 | 0 | 3 | 2 | ❌ NO COVERAGE |
| `offline-queue/offline-queue-delivery.service.ts` | 75.00% | 12 | 0 | 4 | 12 | ❌ |
| `offline-queue/redis-offline-queue.ts` | 88.33% | 53 | 0 | 7 | 11 | ❌ |
| `pubsub/in-memory-pubsub.ts` | 100.00% | 4 | 0 | 0 | 1 | ✅ |
| `pubsub/realtime-pubsub-subscriber.ts` | 60.87% | 14 | 0 | 9 | 14 | ❌ CRITICAL |
| `pubsub/redis-realtime-pubsub.ts` | 80.00% | 12 | 0 | 3 | 10 | ❌ |
| `services/connection-registry.service.ts` | 95.45% | 21 | 0 | 1 | 30 | ✅ CRITICAL |
| `services/event-id-generator.service.ts` | 100.00% | 8 | 0 | 0 | 1 | ✅ CRITICAL |
| `services/realtime.service.ts` | n/a | 0 | 0 | 0 | 7 | — (all errors) |
| `services/reauthentication.service.ts` | 81.08% | 29 | 1 | 7 | 31 | ❌ |
| `services/room-registry.service.ts` | 83.33% | 15 | 0 | 3 | 14 | ❌ CRITICAL |
| `transports/composite/composite.transport.ts` | 75.00% | 15 | 0 | 5 | 12 | ❌ CRITICAL |
| `transports/sse/event-replay-buffer.ts` | 100.00% | 14 | 0 | 0 | 14 | ✅ CRITICAL |
| `transports/sse/heartbeat.service.ts` | 95.24% | 20 | 0 | 1 | 0 | ✅ |
| `transports/sse/sse-subscription.handler.ts` | 76.79% | 43 | 0 | 13 | 67 | ❌ |
| `transports/sse/sse.transport.ts` | 77.27% | 47 | 4 | 15 | 72 | ❌ CRITICAL |
| `transports/websocket/realtime-io-adapter.ts` | 71.43% | 5 | 0 | 2 | 5 | ❌ |
| `transports/websocket/realtime.gateway.ts` | 86.21% | 25 | 0 | 4 | 18 | ❌ |
| `transports/websocket/websocket.transport.ts` | 80.95% | 32 | 2 | 8 | 41 | ❌ |
| `utils/compose-room-id.ts` | 100.00% | 2 | 0 | 0 | 1 | ✅ |
| `utils/encode-sse-event.ts` | 100.00% | 39 | 0 | 0 | 8 | ✅ CRITICAL |
| `utils/parse-cookie-header.ts` | 88.24% | 15 | 0 | 2 | 1 | ❌ |
| `realtime.module.ts` | 70.27% | 78 | 0 | 33 | 65 | ❌ |

---

### Critical path summary

| Critical file | Score | Target | Result |
|---|---|---|---|
| `connection-registry.service.ts` | 95.45% | ≥ 95% | ✅ |
| `room-registry.service.ts` | 83.33% | ≥ 95% | ❌ needs +12pp |
| `sse.transport.ts` | 77.27% | ≥ 95% | ❌ needs +18pp |
| `event-replay-buffer.ts` | 100.00% | ≥ 95% | ✅ |
| `event-id-generator.service.ts` | 100.00% | ≥ 95% | ✅ |
| `encode-sse-event.ts` | 100.00% | ≥ 95% | ✅ |
| `realtime-pubsub-subscriber.ts` | 60.87% | ≥ 95% | ❌ needs +34pp |
| `composite.transport.ts` | 75.00% | ≥ 95% | ❌ needs +20pp |
| `validate-options.ts` | 98.00% | ≥ 95% | ✅ |

---

### ⚠️ Status: BELOW THRESHOLD — Needs Improvement Before Release

The global score of **81.99%** is below the `break: 95` threshold. The `pnpm mutation` gate fails (exit code 1).

**Files requiring the most attention (by survivors):**
1. `realtime.module.ts` — 33 surviving mutants (module wiring, conditional providers)
2. `transports/sse/sse-subscription.handler.ts` — 13 surviving mutants
3. `transports/sse/sse.transport.ts` — 15 surviving mutants (critical path)
4. `pubsub/realtime-pubsub-subscriber.ts` — 9 surviving mutants (critical path)
5. `transports/composite/composite.transport.ts` — 5 surviving mutants (critical path)

**Action required:** Add targeted mutation-killing tests before tagging v0.1.0. Focus on the critical paths first: `realtime-pubsub-subscriber.ts`, `sse.transport.ts`, `composite.transport.ts`, and `room-registry.service.ts`.

The HTML report with per-mutant details is at `reports/mutation/mutation.html` (run `pnpm mutation` locally to regenerate).
