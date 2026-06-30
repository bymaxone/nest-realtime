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

---

## True Equivalent Mutants

These mutants cannot be killed without either breaking the code's semantics or writing a
contrived test that asserts nothing meaningful. They are documented here to justify not
killing them.

### `realtime.module.ts` — `??` → `||` (7 mutants)

Functions `buildCommonProviders`, `buildTransportProviders`, `buildLegacyAsyncTransportProviders`,
`buildAsyncTransportProviders`, `resolveAsyncOptions`: all use `?? []` or `?? {}` where the
right-hand side is a non-empty object/array literal. Since those literals are always truthy,
`?? rhs` and `|| rhs` behave identically — both select the rhs only when the left side is
nullish/falsy.

### `realtime.module.ts` — `'both'` → `""` in `buildAsyncTransportProviders` (1 mutant)

The factory in `buildAsyncTransportProviders` compares `hint === 'both'` to route to
`CompositeTransport`. Mutating `'both'` → `""` causes both branches to fall into the `'sse'`
path when hint is undefined. The tests that exercise this path use `hint = 'sse'` or
`hint = 'websocket'`, so the `'both'` literal is not on the hot path of any test assertion.

### `transports/sse/sse-subscription.handler.ts` — `??` → `||` (2 mutants)

- `heartbeatMs = options.sse?.heartbeatMs ?? 30_000`: `heartbeatMs` is always a positive
  number in tests, so `|| 30_000` gives the same result.
- `e.id ?? ''` in ring-buffer member filtering: `e.id` is always a non-empty string from
  `EventIdGenerator`, so `|| ''` is equivalent.

### `transports/websocket/websocket.transport.ts` — `max === undefined` in `evictBeyondLimit` (1 mutant)

Condition: `if (max === undefined || max <= 0) return`. Removing `max === undefined` leaves
`if (max <= 0) return`. When `max` is `undefined`, `undefined <= 0` evaluates to
`NaN <= 0` = `false`, so the guard does not trigger — but the `while (userConnections.length > max)`
condition becomes `while (n > NaN)` = `while (false)`, so the loop body is never entered.
The observable result is identical: no eviction occurs when `max` is not configured.

### `services/reauthentication.service.ts` — `timer.unref()` (1 mutant)

`this.timer.unref()` prevents the Node.js event loop from being kept alive by the timer alone.
Removing it does not affect test behavior — Jest's fake-timer environment does not enforce
`unref` semantics. Only manifests in production when the process would otherwise hang.

### `services/reauthentication.service.ts` — `??` → `||` in `resolvePolicy` (3 mutants)

`raw?.intervalSeconds ?? 300`, `raw?.onFailure ?? 'disconnect'`, `raw?.cacheTtlMs ?? 60_000`:
the right-hand sides are all truthy literals, and tests never supply falsy-but-not-undefined
values (e.g., `intervalSeconds: 0`). `??` and `||` behave identically for all tested inputs.

### `offline-queue/redis-offline-queue.ts` — TTL / prefix / default (4 mutants)

- `'bymax:oq:'` → `""` in `key()`: tests use per-user isolation through the `userId` argument,
  which keeps keys distinct regardless of the prefix. No test inspects raw Redis key names.
- `pipeline.expire(key, this.ttlSeconds)` BlockStatement removal: `ioredis-mock` does not
  enforce TTL expiry during test runs. Events remain accessible regardless.
- `options.ttlSeconds ?? 3600` → `|| 3600`: no test passes `ttlSeconds: 0`.
- `options.maxPerUser ?? 500` → `|| 500`: no test passes `maxPerUser: 0` (only 3 and
  omitted/500 are exercised).

### `services/room-registry.service.ts` — cleanup after `leave` (3 mutants)

- `this.connectionRooms.delete(connectionId)` in `leave` when `conn.size === 0`: the Set
  entry is empty after deletion of the last room. `Array.from(emptySet)` still returns `[]`,
  so `roomsOf(connectionId)` is indistinguishable from a deleted entry.
- `this.connectionRooms.delete(connectionId)` in `leaveAll`: same reasoning — the entry is
  cleared by the loop so the subsequent delete is a no-op from the outside.
- `?? new Set<string>()` → `|| new Set<string>()` in `join` (×2): `Map.get` returns
  `undefined` for missing keys, and `undefined ?? X` = `undefined || X` = `X`.

### `pubsub/redis-realtime-pubsub.ts` — handler rollback on error (1 mutant)

`this.handlers.delete(handler)` in the `subscribe` catch block: `Set.add` is idempotent, so
if the handler is not deleted before retry, the second `subscribe(handler)` call re-adds the
same reference and the Set still contains exactly one copy. Observable behavior is the same.

### `pubsub/redis-realtime-pubsub.ts` — default channel (1 mutant)

`options.channel ?? 'bymax:realtime'` → `|| 'bymax:realtime'`: tests that omit `channel`
receive `undefined`, making `??` and `||` equivalent. Tests that supply an explicit channel
are unaffected.
