# Phase 3 — Horizontal Scaling (SSE)

> **Status**: 👀 Review · **Progress**: 11 / 11 tasks · **Last updated**: 2026-06-29
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 4
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md) § 5.4, § 5.5, § 10, § 11

---

## Context

Phase 1 and Phase 2 produced a single-instance SSE server: a process can authenticate a connection, push events to it, replay missed events from the in-memory ring buffer, and keep the stream warm with a heartbeat comment. None of that survives horizontal scaling. When the app runs on ≥ 2 instances behind a load balancer, a user can hold tab A on instance #1 and tab B on instance #2; an `emitToUser` executed on instance #1 reaches only tab A. Cross-instance fan-out is missing.

This phase makes the SSE transport **horizontal-scaling capable**. It delivers the cross-instance bus contract (`IRealtimePubSub`), an in-memory reference for same-process multi-handler tests, a Redis-backed reference implementation, a subscriber that re-emits remote messages **locally only** (no re-publish — that would loop forever), a durable per-user offline queue (`IOfflineQueueStorage` + a Redis sorted-set reference) for users who were disconnected when an event fired, and the module wiring that ties it together with **graceful degradation** when the pub/sub backend is unreachable. The phase closes with a cross-instance test that proves an emit on one instance reaches a connection held by another. When Phase 3 is done, N app instances behind a load balancer each see the events emitted by the others.

**Complexity: HIGH.** Echo prevention, the non-publishing local re-emit path, cross-instance event-id consistency, and graceful degradation when the backend goes down are the areas most prone to subtle bugs — they warrant extra-careful human review.

---

## Rules-of-phase

1. **English-only & timeless comments.** No Portuguese. No `Phase N` / `Task` / roadmap-stage references in any committed file (code, config, docs-as-config). A reference to a **doc section** (spec § 5.4, plan § 4.2) is allowed; a reference to a **plan stage** is not.
2. **Never create `.gitkeep` / `.keep` or empty-directory placeholders.** Directories emerge only when the first real file is written. `test/e2e/` is created when the first e2e spec in this phase lands; `src/server/offline-queue/` is created when its first real file (`redis-offline-queue.ts` or the barrel) is written.
3. **Auth inversion is a structural rule.** There must be **NO** reference to `JwtService`, `JwtPayload`, `@bymax-one/nest-auth`, or any `passport-*` package in any file you create or modify here, nor anywhere else in `src/`. The only allowed auth references are bridge **examples** in `docs/` and **mocks** in tests.
4. **Echo prevention lives in the subscriber, never in pub/sub.** `IRealtimePubSub` implementations only deliver; the subscriber drops any message whose `origin === instanceId` (it was already delivered locally by the originating instance).
5. **The local re-emit path never publishes.** The subscriber calls the transport's `*Local` methods (`emitToUserLocal` / `emitToTenantLocal` / `emitToRoomLocal` / `broadcastLocal` / `disconnectLocal`), which deliver to local connections only. Calling a publishing method from the subscriber would create an infinite feedback loop.
6. **Public emit = one local delivery + exactly ONE publish.** `RealtimeService.emitTo*` / `broadcast` / `disconnect` deliver locally first, then publish a single `RealtimePubSubMessage` carrying `origin = instanceId`. The published `args` include the already-generated event `id`, and the remote subscriber reuses that same `id` in the `*Local` call — so an event keeps an identical id on every instance (required for `Last-Event-ID` replay consistency, spec § 10.1 / § 10.3 ordering invariant).
7. **Cross-instance revocation uses an `op: 'disconnect'` producer.** Disconnecting a connection that lives on another instance is done by publishing a `disconnect` message; the remote subscriber resolves it via `disconnectLocal`.
8. **Graceful degradation.** If `pubsub.publish` (or `subscribe` at bootstrap) fails, the failure is logged internally and the **local** emit still succeeds — the lib degrades to single-instance, it never throws upstream (error code `REALTIME_PUBSUB_UNAVAILABLE`, spec § 14).
9. **Heartbeat is a raw `: keepalive\n\n` SSE comment** written directly to the response stream by `HeartbeatService` — it is **not** a `MessageEvent`, **not** a named event, and is **not** in the § 13 reserved-event catalog. None of the `*Local` emit paths or the offline queue ever produce a heartbeat as an event.
10. **`maxConnectionsPerUser` is enforced by FIFO eviction**, never by a 429: evict the user's **oldest** connection (close it with `REALTIME_TOO_MANY_CONNECTIONS`) and admit the new one. This phase does not add new limit logic but must not regress it.
11. **Event-id ordering invariant.** The in-memory `EventReplayBuffer.since()` and the Redis offline queue's `retrieveSince()` both compare ids as **strings** (`e.id > sinceId`). `EventIdGenerator` emits lexicographically-orderable, fixed-width ids — keep the comparisons identical across both code paths.
12. **`ioredis` is an optional peer dependency** and the lib never imports it at runtime: the Redis reference classes use a **type-only** `import type Redis from 'ioredis'` so `pnpm typecheck` / `pnpm build` succeed when `ioredis` is not installed. Tests run against `ioredis-mock` (a devDependency).
13. **Quality floor.** TypeScript strict (no `any`); **100% line/branch coverage on every file implemented in this phase** (Bymax library standard); mutation focus (Stryker — break 95, high 99 / low 95) on the critical paths at the pre-release gate; functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header and JSDoc on every export. Toolchain is **pnpm@11.0.0**. Server bundle budget: **≤ 18 KB brotli**.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 5.4 `IRealtimePubSub` + `RealtimePubSubMessage`, § 5.5 `IOfflineQueueStorage`, § 6.1 `SseTransport` (heartbeat-comment note), § 7.1 `RealtimeService`, § 10.1–§ 10.3 replay & offline queue (+ ordering invariant), § 11.1–§ 11.3 horizontal scalability, § 13 reserved events, § 14 error catalog (`REALTIME_PUBSUB_UNAVAILABLE`).
- [`docs/development_plan.md`](../development_plan.md) — § 4 (Phase 3 detail: § 4.1 InMemoryPubSub, § 4.2 subscriber + `*Local`, § 4.3 RedisRealtimePubSub, § 4.4 RedisOfflineQueue, § 4.5 cross-instance tests, § 4.6 validation), § 1.5 Phase dashboard, § 1.7 Done criteria, § 1.11 attention points.
- `/bymax-workflow:standards` skill — universal Bymax coding rules (TypeScript track).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 3.1 | `InMemoryPubSub` refactor — async handlers + fan-out | ✅ Done | P0 | S | 1.13 |
| 3.2 | `RealtimePubSubSubscriber` + `*Local` re-emit path + single-publish wiring | ✅ Done | P0 | L | 3.1, 1.13 |
| 3.3 | `RedisRealtimePubSub` reference implementation | ✅ Done | P0 | S | 3.2 |
| 3.4 | `IOfflineQueueStorage` wiring + `RedisOfflineQueue` + delivery service | ✅ Done | P1 | M | 1.9 |
| 3.5 | Module wiring — pub/sub + offline-queue providers + graceful degradation | ✅ Done | P0 | M | 3.2, 3.3, 3.4, 2.8 |
| 3.6 | Tests — `InMemoryPubSub` (async + handler errors) | ✅ Done | P1 | S | 3.1 |
| 3.7 | Tests — `RealtimePubSubSubscriber` (echo prevention + dispatch) | ✅ Done | P0 | M | 3.2 |
| 3.8 | Tests — `RedisRealtimePubSub` (`ioredis-mock`) | ✅ Done | P0 | M | 3.3 |
| 3.9 | Tests — `RedisOfflineQueue` + delivery integration | ✅ Done | P1 | M | 3.4 |
| 3.10 | Cross-instance fan-out test (2 simulated instances) | ✅ Done | P0 | L | 3.2, 3.3, 3.8 |
| 3.11 | Phase 3 validation + barrel verification | ✅ Done | P0 | S | 3.1…3.10 |

---

## Tasks

### Task 3.1 — `InMemoryPubSub` refactor — async handlers + fan-out

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.13

#### Description

Phase 1 left `InMemoryPubSub` as a synchronous, no-op-publish stub. Make it an async, microtask-deferred fan-out implementation of `IRealtimePubSub` that matches the Redis async callback semantics, so same-process multi-handler tests (and the single-instance default) behave like the real backend. One handler that throws must not block the others. Echo prevention is **not** added here — it lives in the subscriber (Task 3.2).

#### Acceptance criteria

- [x] `InMemoryPubSub.publish` is asynchronous (`Promise`-based) and defers delivery one microtask (`await Promise.resolve()`) before iterating handlers, matching Redis async-callback semantics.
- [x] `publish` iterates every subscribed handler and calls each with the message.
- [x] A handler that throws is caught internally and does not block the remaining handlers nor propagate upstream.
- [x] `subscribe` registers the handler and returns an async unsubscribe that actually removes it (the next `publish` does not call a removed handler).
- [x] Existing Phase 1/2 tests still pass (the contract is preserved).
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/pubsub/in-memory-pubsub.ts` (modify)

#### Agent prompt

````
You are a senior NestJS backend engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — a dual-transport (SSE-default, WebSocket opt-in) realtime
library for NestJS. Backend entry `@bymax-one/nest-realtime`; frontend `@bymax-one/nest-realtime/react`.
The library NEVER imports a concrete auth library — authentication is inverted via
`IConnectionAuthenticator`. Toolchain pnpm@11.0.0, TypeScript strict, tsup build.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.1 of 11 (FIRST of the phase)

PRECONDITIONS
- The `IRealtimePubSub` / `RealtimePubSubMessage` interfaces exist (interfaces task 1.13).
- `src/server/pubsub/in-memory-pubsub.ts` exists as a Phase 1 stub whose `publish` is a no-op.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.1 "InMemoryPubSub revision — cross-handler fan-out".
- `docs/technical_specification.md` § 5.4 "`IRealtimePubSub` — horizontal scaling" (the
  `RealtimePubSubMessage` shape and the publish/subscribe contract).

TASK
Refactor `InMemoryPubSub` into an async, microtask-deferred fan-out implementation of
`IRealtimePubSub`. Echo prevention is NOT added here — it lives in the subscriber (Task 3.2).

DELIVERABLES

`src/server/pubsub/in-memory-pubsub.ts`:

```typescript
@Injectable()
export class InMemoryPubSub implements IRealtimePubSub {
  private handlers = new Set<(message: RealtimePubSubMessage) => void>()

  async publish(message: RealtimePubSubMessage): Promise<void> {
    // Defer one microtask so delivery matches Redis async-callback semantics and a
    // handler that enqueues further publishes does not deepen the current call stack.
    await Promise.resolve()
    for (const handler of this.handlers) {
      try {
        handler(message)
      } catch {
        // Best-effort fan-out — one handler's failure must not block the others.
      }
    }
  }

  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
    }
  }
}
```

Keep the `@fileoverview` + `@layer` header and JSDoc on the class and public methods.

Constraints:
- TypeScript strict, no `any`. Function/file size within limits.
- English-only, timeless comments. No auth-library references anywhere in `src/`.
- Do NOT add echo prevention here; do NOT create `.gitkeep`/placeholder files.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm test src/server/pubsub/in-memory-pubsub` — expected: existing specs pass (refreshed in Task 3.6).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.2 — `RealtimePubSubSubscriber` + `*Local` re-emit path + single-publish wiring

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 3.1, 1.13

#### Description

Add the cross-instance core. A new `RealtimePubSubSubscriber` subscribes to `IRealtimePubSub` on module init and, for every message **not** originating from this instance, re-applies it **locally only** via the transport's `*Local` methods. `SseTransport` gains those non-publishing `*Local` methods (each accepts an optional `id` so the same event id is preserved across instances). `RealtimeService` is wired so every public emit delivers locally first and then publishes exactly one `RealtimePubSubMessage` carrying `origin = instanceId` and the already-generated event `id`; `disconnect` becomes an `op: 'disconnect'` producer for cross-instance revocation. The subscriber is registered as a module provider, and the `REALTIME_INSTANCE_ID_TOKEN` it consumes is introduced if not already present.

#### Acceptance criteria

- [x] `RealtimePubSubSubscriber` is created, implements `OnModuleInit` (subscribes) and `OnApplicationShutdown` (unsubscribes), and is registered in the module providers.
- [x] **Echo prevention**: a message with `origin === instanceId` is dropped before dispatch.
- [x] The subscriber dispatches the five ops to the transport's **`*Local`** methods only (`emitToUserLocal`, `emitToTenantLocal`, `emitToRoomLocal`, `broadcastLocal`, `disconnectLocal`) — it NEVER calls a publishing method.
- [x] An unknown `op` is logged and skipped without throwing; a failure inside `handle` is caught and does not propagate.
- [x] A `subscribe` failure at bootstrap is logged (warn) and does **not** throw — the instance degrades to single-instance mode.
- [x] `SseTransport` exposes `emitToUserLocal` / `emitToTenantLocal` / `emitToRoomLocal` / `broadcastLocal` / `disconnectLocal`; none of them publish; each reuses the provided `id` (or generates one when absent) and appends to the replay buffer where the public path does.
- [x] `RealtimeService.emitTo*` / `broadcast` / `disconnect` do local delivery first, then a **single** `pubsub.publish({ op, args, origin: instanceId })` whose `args` carry the generated event `id`; `disconnect` publishes `op: 'disconnect'`.
- [x] `REALTIME_INSTANCE_ID_TOKEN` exists as a `Symbol` injection token (added to `constants/injection-tokens.constants.ts` if absent).
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/pubsub/realtime-pubsub-subscriber.ts` (create)
- `src/server/transports/sse/sse.transport.ts` (modify — add the `*Local` methods)
- `src/server/services/realtime.service.ts` (modify — local-then-single-publish + `disconnect` producer)
- `src/server/constants/injection-tokens.constants.ts` (modify — add `REALTIME_INSTANCE_ID_TOKEN` if not present)
- `src/server/realtime.module.ts` (modify — register `RealtimePubSubSubscriber` provider)

#### Agent prompt

````
You are a senior NestJS backend engineer (distributed-systems focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport (SSE-default, WebSocket opt-in) realtime library
for NestJS. Backend `@bymax-one/nest-realtime`; frontend `@bymax-one/nest-realtime/react`. Auth is
inverted via `IConnectionAuthenticator` — the lib never imports a concrete auth library. pnpm@11.0.0,
TypeScript strict, tsup.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.2 of 11

PRECONDITIONS
- Task 3.1 done: `InMemoryPubSub` is async fan-out.
- `SseTransport`, `ConnectionRegistry`, `RoomRegistry`, `EventReplayBuffer`, `EventIdGenerator`,
  and `RealtimeService` exist (Phases 1–2). The injection tokens module exists.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.2 "RealtimePubSubSubscriber — local re-emit of cross-instance
  messages" (the subscriber skeleton + the `*Local` method bodies).
- `docs/technical_specification.md` § 5.4 (`RealtimePubSubMessage` ops/origin), § 11.1–§ 11.2
  (why cross-instance fan-out is needed + the emit flow diagram), § 7.1 (`RealtimeService` is the
  unified public API), § 6.1 (the SseTransport heartbeat-comment note — heartbeats are NOT events).

TASK
Implement cross-instance fan-out for SSE: a subscriber that re-emits remote messages locally only,
the transport's non-publishing `*Local` methods, and `RealtimeService` single-publish wiring.

DELIVERABLES

1. `src/server/pubsub/realtime-pubsub-subscriber.ts` — subscribes on `onModuleInit`, unsubscribes on
   `onApplicationShutdown`, drops self-originated messages, and dispatches to the transport's `*Local`
   methods. Echo prevention + non-publishing dispatch:

   ```typescript
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
       } catch (err) {
         // Pub/sub unavailable at bootstrap — degrade to single-instance, never throw.
         this.logger.warn(`Failed to subscribe to pub/sub: ${(err as Error).message}. Single-instance mode.`)
       }
     }

     async onApplicationShutdown(): Promise<void> {
       if (this.unsubscribe) {
         try { await this.unsubscribe() } catch (err) {
           this.logger.warn(`Unsubscribe failed: ${(err as Error).message}`)
         }
       }
     }

     private handle(msg: RealtimePubSubMessage): void {
       if (msg.origin === this.instanceId) return // self — already delivered locally
       try {
         switch (msg.op) {
           case 'emitToUser':   this.sse.emitToUserLocal(msg.args as { userId: string; event: string; data: unknown; id?: string }); break
           case 'emitToTenant': this.sse.emitToTenantLocal(msg.args as { tenantId: string; event: string; data: unknown; id?: string }); break
           case 'emitToRoom':   this.sse.emitToRoomLocal(msg.args as { roomId: string; event: string; data: unknown; id?: string }); break
           case 'broadcast':    this.sse.broadcastLocal(msg.args as { event: string; data: unknown; id?: string }); break
           case 'disconnect':   this.sse.disconnectLocal(msg.args as { connectionId: string; reason?: string }); break
           default:             this.logger.warn(`Unknown pub/sub op: ${(msg as RealtimePubSubMessage).op}`)
         }
       } catch (err) {
         this.logger.warn(`Pub/sub message handling failed: ${(err as Error).message}`)
       }
     }
   }
   ```

   Prefer a typed local interface (e.g. `ISseLocalOps`) over bracket access — expose the `*Local`
   methods as real public methods on `SseTransport` and inject the transport directly.

2. `src/server/transports/sse/sse.transport.ts` — add the five non-publishing `*Local` methods.
   Each reuses the supplied `id` (so the event keeps an identical id on every instance) or generates
   one when absent, and the user path appends to the replay buffer exactly as the public path does:

   ```typescript
   emitToUserLocal(args: { userId: string; event: string; data: unknown; id?: string }): void {
     const msg: MessageEvent = { id: args.id ?? this.idGen.next(), type: args.event, data: args.data as object }
     this.replayBuffer.append(args.userId, msg)
     for (const conn of this.connections.byUser(args.userId, 'sse')) conn.subject?.next(msg)
   }
   // emitToTenantLocal / emitToRoomLocal / broadcastLocal — analogous, no replay append for tenant/room/broadcast.
   disconnectLocal(args: { connectionId: string; reason?: string }): void {
     const record = this.connections.get(args.connectionId)
     if (!record || record.transport !== 'sse') return
     record.subject?.complete()
     void this.unregisterConnection(args.connectionId, args.reason)
   }
   ```

3. `src/server/services/realtime.service.ts` — every public emit delivers locally then publishes ONE
   message carrying the generated `id` and `origin = instanceId`; `disconnect` is the `op: 'disconnect'`
   producer. The published `args` include the same `id` the local emit used:

   ```typescript
   async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
     const id = this.transport.emitToUser(userId, event, data) // local delivery returns the event id
     await this.pubsub.publish({ op: 'emitToUser', args: { userId, event, data, id }, origin: this.instanceId })
   }
   ```
   Apply the same shape to `emitToTenant`, `emitToRoom`, `broadcast`, and `disconnect`
   (`{ op: 'disconnect', args: { connectionId, reason }, origin }`). The publish stays a SINGLE call;
   wrapping it in try/catch for graceful degradation is Task 3.5.

4. `src/server/constants/injection-tokens.constants.ts` — add, if not already present:
   `export const REALTIME_INSTANCE_ID_TOKEN = Symbol('BYMAX_REALTIME_INSTANCE_ID')`.

5. `src/server/realtime.module.ts` — register `RealtimePubSubSubscriber` in the providers list.

Constraints:
- The `*Local` methods MUST NOT publish — publishing from the re-emit path is an infinite loop.
- Heartbeats are raw `: keepalive` comments via HeartbeatService — never produce one as a MessageEvent here.
- TypeScript strict, no `any`; functions ≤ 50 lines. `@fileoverview`/`@layer` header + JSDoc on exports.
- English-only, timeless comments. No auth-library references anywhere in `src/`. No `.gitkeep` files.

Verification:
- `pnpm typecheck` — expected: clean.
- Reason through: an emit on instance A delivers to A's local connections once (public path), publishes
  once; A's own subscriber drops it (origin === instanceId); B's subscriber re-emits via `*Local` reusing
  the same id. No double-delivery on A, identical id on B.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.3 — `RedisRealtimePubSub` reference implementation

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.2

#### Description

Provide a concrete `IRealtimePubSub` backed by `ioredis`: a publish client plus one lazily-duplicated subscribe client, JSON-encoded messages on a customizable channel (`bymax:realtime` by default), shared subscriber across multiple handlers, cleanup on the last unsubscribe, and silent drop of malformed payloads. The `ioredis` import is **type-only** so the lib still typechecks and builds when `ioredis` is not installed (it is an optional peer dependency). The class is added to the pub/sub barrel only; the main server barrel export is wired in Task 3.5.

#### Acceptance criteria

- [x] `src/server/pubsub/redis-realtime-pubsub.ts` is created with a type-only `import type Redis from 'ioredis'` (does not break `pnpm typecheck` / `pnpm build` when `ioredis` is absent).
- [x] Constructor takes `{ pubClient, channel? }`; `channel` defaults to `'bymax:realtime'`.
- [x] `publish` JSON-encodes the message and `PUBLISH`es it to the channel.
- [x] `subscribe` lazily creates the subscribe client via `pubClient.duplicate()` on the first call only; multiple handlers share that one subscribe client.
- [x] Incoming messages are JSON-parsed and dispatched to every handler; a malformed payload is dropped silently.
- [x] The last `unsubscribe` removes its handler, then (when no handlers remain) unsubscribes and quits the subscribe client.
- [x] The export is added to `src/server/pubsub/index.ts`; it is **not** added to `src/server/index.ts` here (the main-barrel export is Task 3.5).
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/pubsub/redis-realtime-pubsub.ts` (create)
- `src/server/pubsub/index.ts` (modify — add the export)

#### Agent prompt

````
You are a senior NestJS backend engineer (Redis/distributed-systems focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. Auth inverted via
`IConnectionAuthenticator`; the lib never imports a concrete auth library and never imports `ioredis`
at runtime. pnpm@11.0.0, TypeScript strict, tsup.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.3 of 11

PRECONDITIONS
- Task 3.2 done: the subscriber + `*Local` path exist; `RealtimePubSubMessage` is defined in
  `src/server/interfaces/realtime-pubsub.interface.ts`.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.3 "RedisRealtimePubSub — reference implementation".
- `docs/technical_specification.md` § 5.4 (the Redis-backed reference impl), § 11.3 ("For SSE —
  custom `IRealtimePubSub`; the lib does NOT depend on ioredis directly").

TASK
Implement a Redis-backed `IRealtimePubSub` using a type-only `ioredis` import.

DELIVERABLES

`src/server/pubsub/redis-realtime-pubsub.ts`:

```typescript
import type Redis from 'ioredis' // type-only — ioredis is an optional peer dependency
import { Injectable } from '@nestjs/common'
import type { IRealtimePubSub, RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'

export interface RedisRealtimePubSubOptions {
  /** ioredis client used to publish; the lib calls `.duplicate()` to create the subscribe client. */
  pubClient: Redis
  /** Channel name. Default 'bymax:realtime'. */
  channel?: string
}

@Injectable()
export class RedisRealtimePubSub implements IRealtimePubSub {
  private readonly pub: Redis
  private subClient?: Redis
  private readonly channel: string
  private handlers = new Set<(msg: RealtimePubSubMessage) => void>()

  constructor(opts: RedisRealtimePubSubOptions) {
    this.pub = opts.pubClient
    this.channel = opts.channel ?? 'bymax:realtime'
  }

  async publish(message: RealtimePubSubMessage): Promise<void> {
    await this.pub.publish(this.channel, JSON.stringify(message))
  }

  async subscribe(handler: (msg: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    if (!this.subClient) {
      this.subClient = this.pub.duplicate()
      await this.subClient.subscribe(this.channel)
      this.subClient.on('message', (_chan, raw) => {
        try {
          const msg = JSON.parse(raw) as RealtimePubSubMessage
          for (const h of this.handlers) { try { h(msg) } catch { /* one handler must not block others */ } }
        } catch {
          // Malformed payload — drop silently.
        }
      })
    }
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0 && this.subClient) {
        await this.subClient.unsubscribe(this.channel)
        await this.subClient.quit()
        this.subClient = undefined
      }
    }
  }
}
```

Then add to `src/server/pubsub/index.ts`:
```typescript
export { RedisRealtimePubSub } from './redis-realtime-pubsub'
export type { RedisRealtimePubSubOptions } from './redis-realtime-pubsub'
```
Do NOT add it to `src/server/index.ts` — the main-barrel export is wired in Task 3.5.

Constraints:
- `import type Redis from 'ioredis'` only — no runtime `ioredis` import; `pnpm build` must succeed
  with `ioredis` uninstalled.
- TypeScript strict, no `any`. `@fileoverview`/`@layer` header + JSDoc on exports.
- English-only, timeless comments. No auth-library references. No `.gitkeep` files.

Verification:
- `pnpm typecheck` — expected: clean (even without ioredis installed).
- `pnpm build` — expected: succeeds.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.4 — `IOfflineQueueStorage` wiring + `RedisOfflineQueue` + delivery service

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 1.9

#### Description

Deliver the durable per-user offline queue. The `IOfflineQueueStorage` interface already exists from the interfaces task (1.9); this task adds the Redis-backed reference implementation (a sorted set per user keyed by a parsed score, with size trim and TTL), its barrel, and an `OfflineQueueDeliveryService` that — after the in-memory ring-buffer replay in `SseSubscriptionHandler` — fetches queued events for a reconnecting user via `retrieveSince`, emits them, then `acknowledge`s up to the last delivered id. When no offline queue is configured, behaviour is unchanged (ring-buffer replay only). The `ioredis` import is type-only.

#### Acceptance criteria

- [x] `src/server/offline-queue/redis-offline-queue.ts` is created with a type-only `import type Redis from 'ioredis'`.
- [x] Constructor options: `{ client, keyPrefix?, maxPerUser?, ttlSeconds? }` defaulting to `'bymax:offline'`, `100`, `86400`.
- [x] `append` adds the JSON event to a per-user sorted set scored by the event id, trims to `maxPerUser` (keeping the most recent), and sets the TTL on each append.
- [x] `retrieveSince` returns events with id strictly greater than `sinceId` (exclusive lower bound) up to `limit`, comparing ids consistently with `EventReplayBuffer` (spec § 10.3 ordering invariant).
- [x] `acknowledge` removes events with id ≤ `upToId`.
- [x] `parseScore` handles both `{ms}-{counter}` and legacy numeric-only ids.
- [x] `OfflineQueueDeliveryService` is created and wired into `SseSubscriptionHandler.handle` after the ring-buffer replay: on `Last-Event-ID` + a configured queue it `retrieveSince`s, emits, and `acknowledge`s; ring-buffer events are not re-delivered (dedupe by id).
- [x] A barrel `src/server/offline-queue/index.ts` exports the implementation; the main-barrel export is wired in Task 3.5.
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/server/offline-queue/redis-offline-queue.ts` (create)
- `src/server/offline-queue/offline-queue-delivery.service.ts` (create)
- `src/server/offline-queue/index.ts` (create — barrel)
- `src/server/transports/sse/sse-subscription.handler.ts` (modify — wire delivery after replay)

#### Agent prompt

````
You are a senior NestJS backend engineer (Redis/durable-storage focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. Auth inverted; the lib
never imports a concrete auth library and never imports `ioredis` at runtime. pnpm@11.0.0, TS strict, tsup.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.4 of 11

PRECONDITIONS
- The `IOfflineQueueStorage` / `OfflineQueuedEvent` interface exists (interfaces task 1.9).
- `SseSubscriptionHandler` exists (Phase 2) and already performs in-memory ring-buffer replay.
- `EventIdGenerator` emits lexicographically-orderable, fixed-width ids.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.4 "IOfflineQueueStorage — RedisOfflineQueue reference".
- `docs/technical_specification.md` § 5.5 (`IOfflineQueueStorage` contract), § 10.2 (offline-queue
  semantics — persist when the user has 0 connections), § 10.3 (Redis reference + the event-id
  string-ordering invariant).

TASK
Add the Redis offline-queue reference, its barrel, and the delivery service wired after ring-buffer replay.

DELIVERABLES

1. `src/server/offline-queue/redis-offline-queue.ts`:

```typescript
import type Redis from 'ioredis' // type-only — optional peer dependency
import { Injectable } from '@nestjs/common'
import type { IOfflineQueueStorage, OfflineQueuedEvent } from '../interfaces/offline-queue-storage.interface'

export interface RedisOfflineQueueOptions {
  client: Redis
  keyPrefix?: string   // default 'bymax:offline'
  maxPerUser?: number  // default 100
  ttlSeconds?: number  // default 86_400 (24h)
}

@Injectable()
export class RedisOfflineQueue implements IOfflineQueueStorage {
  private readonly client: Redis
  private readonly keyPrefix: string
  private readonly maxPerUser: number
  private readonly ttlSeconds: number

  constructor(opts: RedisOfflineQueueOptions) {
    this.client = opts.client
    this.keyPrefix = opts.keyPrefix ?? 'bymax:offline'
    this.maxPerUser = opts.maxPerUser ?? 100
    this.ttlSeconds = opts.ttlSeconds ?? 86_400
  }

  async append(userId: string, event: OfflineQueuedEvent): Promise<void> {
    const key = this.userKey(userId)
    await this.client.zadd(key, this.parseScore(event.id), JSON.stringify(event))
    await this.client.zremrangebyrank(key, 0, -this.maxPerUser - 1) // trim oldest, keep most recent
    await this.client.expire(key, this.ttlSeconds)
  }

  async retrieveSince(userId: string, sinceId: string, limit: number): Promise<OfflineQueuedEvent[]> {
    const since = this.parseScore(sinceId)
    const raws = await this.client.zrangebyscore(this.userKey(userId), `(${since}`, '+inf', 'LIMIT', 0, limit)
    return raws.map((r) => JSON.parse(r) as OfflineQueuedEvent)
  }

  async acknowledge(userId: string, upToId: string): Promise<void> {
    await this.client.zremrangebyscore(this.userKey(userId), '-inf', this.parseScore(upToId))
  }

  private userKey(userId: string): string { return `${this.keyPrefix}:${userId}` }

  private parseScore(id: string): number {
    // id format `{ms}-{counter}` — use the ms prefix as score; legacy numeric-only ids parse directly.
    const dash = id.indexOf('-')
    return dash === -1 ? Number(id) : Number(id.slice(0, dash))
  }
}
```

2. `src/server/offline-queue/offline-queue-delivery.service.ts` — an `@Injectable()` that, given a
   reconnecting user with a `Last-Event-ID` and a configured `IOfflineQueueStorage`, fetches
   `retrieveSince(userId, lastEventId, 100)`, emits the events, and calls `acknowledge(userId, lastEmittedId)`.
   It receives the queue via `@Optional() @Inject(REALTIME_OFFLINE_QUEUE_TOKEN)` (may be `undefined`).

3. `src/server/offline-queue/index.ts` — barrel:
   ```typescript
   export { RedisOfflineQueue } from './redis-offline-queue'
   export type { RedisOfflineQueueOptions } from './redis-offline-queue'
   export { OfflineQueueDeliveryService } from './offline-queue-delivery.service'
   ```

4. `src/server/transports/sse/sse-subscription.handler.ts` — after the in-memory ring-buffer replay,
   if a `Last-Event-ID` is present and the offline queue is configured, run delivery via
   `OfflineQueueDeliveryService`. Do not re-deliver events already produced by the ring buffer
   (dedupe by id). When no queue is configured, behaviour is unchanged.

Constraints:
- `import type Redis from 'ioredis'` only — no runtime ioredis import.
- `retrieveSince` uses an EXCLUSIVE lower bound (`(${since}`) and id-string comparison consistent with
  `EventReplayBuffer.since()`.
- TypeScript strict, no `any`; functions ≤ 50 lines. `@fileoverview`/`@layer` header + JSDoc on exports.
- English-only, timeless comments. No auth-library references. No `.gitkeep` files — let the first real
  file create `src/server/offline-queue/`.

Verification:
- `pnpm typecheck` — expected: clean.
- `pnpm build` — expected: succeeds (ioredis uninstalled).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.5 — Module wiring — pub/sub + offline-queue providers + graceful degradation

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.2, 3.3, 3.4, 2.8

#### Description

Wire `BymaxRealtimeModule.forRoot` and `forRootAsync` to provide the pub/sub and offline-queue dependencies correctly: the pub/sub provider defaults to `InMemoryPubSub` (with an internal warning when `NODE_ENV === 'production'` and no backend was supplied) or honours a supplied custom backend; the offline-queue provider resolves to the supplied instance or `undefined` (silent — single-instance ring-buffer replay still works); a `REALTIME_INSTANCE_ID_TOKEN` provider yields a fresh `randomUUID()` per process. `RealtimeService` wraps each `pubsub.publish` in try/catch so a backend outage degrades to single-instance without breaking the local emit (`REALTIME_PUBSUB_UNAVAILABLE`, spec § 14). `OfflineQueueDeliveryService` is registered. The two Redis reference classes are exported from the main server barrel.

#### Acceptance criteria

- [x] The pub/sub provider (token `REALTIME_PUBSUB_TOKEN`) defaults to a new `InMemoryPubSub` and emits an internal warn when `NODE_ENV === 'production'` and no `pubsub` was provided; a supplied `pubsub` is honoured.
- [x] The offline-queue provider (token `REALTIME_OFFLINE_QUEUE_TOKEN`) resolves to `opts.offlineQueue` or `undefined` (silent).
- [x] A `REALTIME_INSTANCE_ID_TOKEN` provider yields a per-process `randomUUID()`.
- [x] `RealtimePubSubSubscriber` and `OfflineQueueDeliveryService` are registered in both `forRoot` and `forRootAsync`.
- [x] Each `RealtimeService` publish is wrapped in try/catch — a publish failure is logged internally and the local emit still succeeds (graceful degradation; no upstream throw).
- [x] `src/server/index.ts` exports `RedisRealtimePubSub` + `RedisRealtimePubSubOptions` and `RedisOfflineQueue` + `RedisOfflineQueueOptions`.
- [x] `pnpm typecheck && pnpm build` pass.

#### Files to create / modify

- `src/server/realtime.module.ts` (modify — providers for `forRoot` and `forRootAsync`)
- `src/server/services/realtime.service.ts` (modify — try/catch around publish)
- `src/server/index.ts` (modify — main barrel exports)

#### Agent prompt

````
You are a senior NestJS module/DI engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. Auth inverted; the lib
never imports a concrete auth library and never imports `ioredis` at runtime. pnpm@11.0.0, TS strict, tsup.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.5 of 11

PRECONDITIONS
- Tasks 3.2–3.4 done: subscriber + `*Local` path, `RedisRealtimePubSub`, `RedisOfflineQueue` +
  `OfflineQueueDeliveryService` all exist. `BymaxRealtimeModule.forRoot`/`forRootAsync` exist (task 2.8).
- The injection tokens (incl. `REALTIME_INSTANCE_ID_TOKEN` from Task 3.2) exist.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.2 (RealtimeService publish) and § 4.4 (offlineQueue injection note).
- `docs/technical_specification.md` § 4.1–§ 4.2 (module options + defaults), § 4.6 (injection tokens),
  § 14 (`REALTIME_PUBSUB_UNAVAILABLE` — warn + degrade to single-instance).

TASK
Wire the pub/sub + offline-queue providers, the instance-id provider, graceful-degradation try/catch,
and the main-barrel exports.

DELIVERABLES

1. In `forRoot` and `forRootAsync` providers:

```typescript
{
  provide: REALTIME_PUBSUB_TOKEN,
  useFactory: (opts: BymaxRealtimeModuleOptions) => {
    if (!opts.pubsub) {
      // Internal warn when NODE_ENV === 'production' and no backend was supplied (single-instance only).
      return new InMemoryPubSub()
    }
    return opts.pubsub
  },
  inject: [REALTIME_OPTIONS_TOKEN],
},
{
  provide: REALTIME_OFFLINE_QUEUE_TOKEN,
  useFactory: (opts: BymaxRealtimeModuleOptions) => opts.offlineQueue, // undefined is fine
  inject: [REALTIME_OPTIONS_TOKEN],
},
{
  provide: REALTIME_INSTANCE_ID_TOKEN,
  useFactory: () => randomUUID(), // from node:crypto — one id per process
},
RealtimePubSubSubscriber,
OfflineQueueDeliveryService,
```

2. `RealtimeService` — wrap each single publish in try/catch (local emit already ran first):

```typescript
async emitToUser(userId: string, event: string, data: unknown): Promise<void> {
  const id = this.transport.emitToUser(userId, event, data) // local delivery first
  try {
    await this.pubsub.publish({ op: 'emitToUser', args: { userId, event, data, id }, origin: this.instanceId })
  } catch (err) {
    // Pub/sub unavailable — graceful degradation (REALTIME_PUBSUB_UNAVAILABLE). Log internally; do not throw.
    this.logger.warn(`pub/sub publish failed: ${(err as Error).message}. Degrading to single-instance.`)
  }
}
```
Apply the same try/catch to `emitToTenant`, `emitToRoom`, `broadcast`, and `disconnect`.

3. `src/server/index.ts` — add to the main barrel:
```typescript
export { RedisRealtimePubSub } from './pubsub/redis-realtime-pubsub'
export type { RedisRealtimePubSubOptions } from './pubsub/redis-realtime-pubsub'
export { RedisOfflineQueue } from './offline-queue/redis-offline-queue'
export type { RedisOfflineQueueOptions } from './offline-queue/redis-offline-queue'
```

Constraints:
- A publish failure must NEVER break the local emit — local first, publish wrapped.
- TypeScript strict, no `any`. `@fileoverview`/`@layer` header + JSDoc on exports.
- English-only, timeless comments. No auth-library references. No `.gitkeep` files.

Verification:
- `pnpm typecheck && pnpm build` — expected: both succeed.
- `node -e "Object.keys(require('./dist/server/index.cjs'))"` (or an equivalent import check) —
  expected: includes `RedisRealtimePubSub` and `RedisOfflineQueue`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.6 — Tests — `InMemoryPubSub` (async + handler errors)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 3.1

#### Description

Refresh the `InMemoryPubSub` spec for the async fan-out refactor: prove async delivery, handler isolation on throw, unsubscribe correctness, independent subscriptions, and a light stress pass.

#### Acceptance criteria

- [x] At least 7 cases covering: `publish` calls all handlers; `publish` is asynchronous (deferred via `await Promise.resolve()`); `subscribe` adds a handler and returns an unsubscribe; unsubscribe removes the handler so a later `publish` does not call it; a throwing handler does not block others; multiple independent subscriptions work; and a light stress pass (1000 messages × 10 handlers — all received).
- [x] **100% line/branch coverage** on `in-memory-pubsub.ts`.

#### Files to create / modify

- `src/server/pubsub/in-memory-pubsub.spec.ts` (create / update)

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, Jest +
ts-jest, TS strict. Bymax library standard: 100% per-file coverage, every `it()` carries a comment.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.6 of 11

PRECONDITIONS
- Task 3.1 done: `InMemoryPubSub` is async fan-out.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.1 (the refactored `InMemoryPubSub` behaviour + acceptance criteria).
- `docs/technical_specification.md` § 5.4 (`IRealtimePubSub` contract).

TASK
Write/refresh `src/server/pubsub/in-memory-pubsub.spec.ts` with at least 7 cases:
1. `publish` calls all subscribed handlers.
2. `publish` resolves asynchronously (delivery deferred a microtask, not synchronous).
3. `subscribe` adds the handler and returns an unsubscribe.
4. Unsubscribe removes the handler — the next `publish` does not call it.
5. A handler that throws does not block the other handlers.
6. Multiple independent subscriptions each receive their messages.
7. Stress: 1000 messages × 10 handlers — every handler receives every message.

Constraints:
- Every `it()` has a one-line comment explaining the branch it covers; real branches, no fake assertions.
- TypeScript strict, no `any`. English-only, timeless comments.
- Run with a bounded worker pool: `--maxWorkers=2`.

Verification:
- `pnpm test src/server/pubsub/in-memory-pubsub` — expected: all green.
- `pnpm test:cov -- src/server/pubsub/in-memory-pubsub` — expected: 100% line/branch on the file.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.7 — Tests — `RealtimePubSubSubscriber` (echo prevention + dispatch)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.2

#### Description

Cover the subscriber: lifecycle (subscribe on init, unsubscribe on shutdown), echo prevention, the five `op` → `*Local` dispatches, silent handling of an unknown op, and a non-propagating `handle` error. Mock `IRealtimePubSub` and the transport's local-ops surface.

#### Acceptance criteria

- [x] At least 10 cases covering: `onModuleInit` calls `pubsub.subscribe`; `onApplicationShutdown` calls unsubscribe; a message with `origin === instanceId` is ignored; a message with `origin !== instanceId` is processed; each of `emitToUser` / `emitToTenant` / `emitToRoom` / `broadcast` / `disconnect` calls the matching `*Local` method with the right args; an error inside `handle` does not propagate; and an unknown `op` is skipped without throwing.
- [x] A `subscribe` rejection at bootstrap is asserted to be caught (no throw, warn logged).
- [x] `IRealtimePubSub` and the transport local-ops are mocked; **100% line/branch coverage** on `realtime-pubsub-subscriber.ts`.

#### Files to create / modify

- `src/server/pubsub/realtime-pubsub-subscriber.spec.ts` (create)

#### Agent prompt

````
You are a senior NestJS test engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, Jest +
ts-jest, TS strict. Bymax standard: 100% per-file coverage, every `it()` carries a comment.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.7 of 11

PRECONDITIONS
- Task 3.2 done: `RealtimePubSubSubscriber` + `SseTransport.*Local` methods exist.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.2 (subscriber behaviour, echo prevention, `*Local` dispatch).
- `docs/technical_specification.md` § 5.4 (`RealtimePubSubMessage` ops/origin), § 11.2 (cross-instance flow).

TASK
Write `src/server/pubsub/realtime-pubsub-subscriber.spec.ts` with at least 10 cases:
1. `onModuleInit` calls `pubsub.subscribe`.
2. `onApplicationShutdown` calls the returned unsubscribe.
3. Echo prevention — a message with `origin === instanceId` is ignored (no `*Local` call).
4. A message with `origin !== instanceId` is processed.
5. op `emitToUser` calls `transport.emitToUserLocal` with the right args.
6. op `emitToTenant` calls `transport.emitToTenantLocal`.
7. op `emitToRoom` calls `transport.emitToRoomLocal`.
8. op `broadcast` calls `transport.broadcastLocal`.
9. op `disconnect` calls `transport.disconnectLocal`.
10. An error thrown inside `handle` does not propagate (silent warn).
11. An unknown `op` is skipped without throwing.
12. A `subscribe` rejection at bootstrap is caught (no throw, warn logged).

Mock `IRealtimePubSub` and the transport's local-ops surface (jest mock functions). Assert the
non-publishing invariant: no publishing method is ever called from the subscriber.

Constraints:
- Every `it()` has a one-line comment. Real branches; no fake assertions. TS strict, no `any`.
- English-only, timeless comments. Run with `--maxWorkers=2`.

Verification:
- `pnpm test src/server/pubsub/realtime-pubsub-subscriber` — expected: all green.
- `pnpm test:cov -- src/server/pubsub/realtime-pubsub-subscriber` — expected: 100% line/branch.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.8 — Tests — `RedisRealtimePubSub` (`ioredis-mock`)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.3

#### Description

Cover `RedisRealtimePubSub` against `ioredis-mock` (a devDependency): JSON publish, lazy single subscribe client, message parse-and-dispatch, shared subscriber across handlers, quit on last unsubscribe, silent drop of malformed payloads, the throw-after-quit Redis behaviour, and a customizable channel.

#### Acceptance criteria

- [x] `ioredis-mock` is added as a devDependency.
- [x] At least 7 cases covering: `publish` sends JSON to the channel; the first `subscribe` creates the subscribe client via `.duplicate()`; an incoming message is parsed and dispatched; multiple handlers share one subscribe client; the last `unsubscribe` quits the subscribe client; a malformed JSON message is dropped silently; `publish` after `pub.quit()` rejects (Redis behaviour — not the lib's responsibility); and the channel is customizable via options.
- [x] **100% line/branch coverage** on `redis-realtime-pubsub.ts`.

#### Files to create / modify

- `src/server/pubsub/redis-realtime-pubsub.spec.ts` (create)
- `package.json` (modify — add `ioredis-mock` devDependency)

#### Agent prompt

````
You are a senior NestJS test engineer (Redis focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, Jest +
ts-jest, TS strict. The lib never imports `ioredis` at runtime; tests use `ioredis-mock` (devDep).

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.8 of 11

PRECONDITIONS
- Task 3.3 done: `RedisRealtimePubSub` exists with a type-only ioredis import.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.3 (the `ioredis-mock` test strategy and cases).
- `docs/technical_specification.md` § 5.4 (Redis reference impl behaviour).

TASK
Write `src/server/pubsub/redis-realtime-pubsub.spec.ts` against `ioredis-mock`:

```typescript
import RedisMock from 'ioredis-mock'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'
```

At least 7 cases:
1. `publish` sends JSON to the channel.
2. First `subscribe` creates the subscribe client via `.duplicate()`.
3. An incoming message is JSON-parsed and dispatched to the handler.
4. Multiple handlers share the one subscribe client.
5. Last `unsubscribe` quits the subscribe client.
6. A malformed JSON message is dropped silently (handler not called).
7. `publish` after `pub.quit()` rejects (Redis behaviour, not the lib's responsibility).
8. The channel is customizable via options.

Add `ioredis-mock` to devDependencies. Cast the mock to the ioredis type at the construction boundary
only (a single localized `as` cast), never with project-wide `any`.

Constraints:
- Every `it()` has a one-line comment. Real branches. TS strict, no `any`.
- English-only, timeless comments. Run with `--maxWorkers=2`.

Verification:
- `pnpm test src/server/pubsub/redis-realtime-pubsub` — expected: all green.
- `pnpm test:cov -- src/server/pubsub/redis-realtime-pubsub` — expected: 100% line/branch.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.9 — Tests — `RedisOfflineQueue` + delivery integration

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.4

#### Description

Cover the offline queue against `ioredis-mock` and the delivery wiring as an integration spec. Unit-test `append` (sorted-set add + trim + TTL), `retrieveSince` (exclusive lower bound + limit), `acknowledge`, `parseScore`, and the empty-user case. Integration-test the delivery path: reconnect without a queue (ring buffer only), reconnect with a queue + `sinceId` (fetch → emit → acknowledge), a throwing queue (internal log, connection proceeds), and ring-buffer + queue dedupe by id.

#### Acceptance criteria

- [x] `src/server/offline-queue/redis-offline-queue.spec.ts` has at least 8 cases: `append` adds to the sorted set; `append` trims when above `maxPerUser` (keeping most recent); `append` sets the TTL; `retrieveSince` returns events with score strictly above `sinceScore` (exclusive); `retrieveSince` respects `limit`; `acknowledge` removes events with score ≤ `upToScore`; `parseScore` handles `{ms}-{counter}` and legacy numeric ids; an empty user yields `[]`.
- [x] `test/e2e/offline-queue-delivery.e2e-spec.ts` has at least 4 cases: reconnect without a queue → ring-buffer-only behaviour; reconnect with a queue + `sinceId` → fetch, emit, acknowledge; a queue that throws → internal log and the connection still proceeds; ring buffer + queue → dedupe by id (queue delivers only events not already in the ring buffer).
- [x] **100% line/branch coverage** on `redis-offline-queue.ts` and `offline-queue-delivery.service.ts`.

#### Files to create / modify

- `src/server/offline-queue/redis-offline-queue.spec.ts` (create)
- `test/e2e/offline-queue-delivery.e2e-spec.ts` (create)

#### Agent prompt

````
You are a senior NestJS test engineer (Redis focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, Jest +
ts-jest, TS strict. The lib never imports `ioredis` at runtime; tests use `ioredis-mock`.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.9 of 11

PRECONDITIONS
- Task 3.4 done: `RedisOfflineQueue`, `OfflineQueueDeliveryService`, and the `SseSubscriptionHandler`
  wiring exist. `ioredis-mock` is available as a devDependency (added in Task 3.8).

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.4 (queue behaviour + delivery wiring + acceptance criteria).
- `docs/technical_specification.md` § 5.5 (`IOfflineQueueStorage`), § 10.2 (offline-queue semantics),
  § 10.3 (Redis reference + the event-id string-ordering invariant).

TASK
Write two specs.

1. `src/server/offline-queue/redis-offline-queue.spec.ts` (≥ 8 cases, against `ioredis-mock`):
   - `append` adds to the sorted set.
   - `append` trims when above `maxPerUser` (keeps most recent).
   - `append` sets the TTL.
   - `retrieveSince` returns events with score strictly above `sinceScore` (exclusive lower bound).
   - `retrieveSince` respects `limit`.
   - `acknowledge` removes events with score ≤ `upToScore`.
   - `parseScore` handles `{ms}-{counter}` and legacy numeric-only ids.
   - An empty user yields `[]`.

2. `test/e2e/offline-queue-delivery.e2e-spec.ts` (≥ 4 cases, NestJS Test module):
   - Reconnect without a queue → ring-buffer-only behaviour (unchanged from earlier phases).
   - Reconnect with a queue + `sinceId` → fetch queued events, emit them, then `acknowledge`.
   - A queue whose method throws → internal log, and the connection still proceeds.
   - Ring buffer + queue → dedupe by id (the queue delivers only events not already in the ring buffer).

Constraints:
- Every `it()` has a one-line comment. Real branches. TS strict, no `any` (localized casts only at the
  mock boundary). English-only, timeless comments. Run with `--maxWorkers=2`.
- `test/e2e/` is created by this spec landing — do NOT add a `.gitkeep`.

Verification:
- `pnpm test src/server/offline-queue/redis-offline-queue` — expected: green.
- `pnpm test:e2e -- offline-queue-delivery` — expected: green.
- `pnpm test:cov -- src/server/offline-queue` — expected: 100% line/branch on both files.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.10 — Cross-instance fan-out test (2 simulated instances)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 3.2, 3.3, 3.8

#### Description

The decisive test for the phase: prove that an emit on one instance reaches a connection held by another. `InMemoryPubSub` cannot do this (each module has its own handler set), so two isolated NestJS test instances share a single `ioredis-mock` pub/sub (the in-process equivalent of a real Redis for test purposes; a `worker_threads` variant is an acceptable alternative). A `createTestInstance(redisOpts)` helper builds one isolated module per call. Scenarios: A→B fan-out, echo prevention (A does not double-emit to itself), graceful degradation (a throwing publish still delivers locally), and a 5-instance light stress.

#### Acceptance criteria

- [x] `test/e2e/cross-instance.e2e-spec.ts` is created with at least 4 scenarios: instance A emits → a connection on instance B receives; echo prevention (A does not double-emit to itself); graceful degradation (`pubsub.publish` throws → local emit still works); and a 5-instance light-stress fan-out (one emits, the other four receive).
- [x] A `createTestInstance(redisOpts)` helper builds an isolated module per call (sharing the `ioredis-mock` instance / its `.duplicate()`).
- [x] Echo prevention is verified (no double-emit on the origin instance); graceful degradation is verified.
- [x] The test isolates cleanly — no leaked instances/handles after `afterAll`.
- [x] Critical-path coverage holds (pub/sub + subscriber paths).

#### Files to create / modify

- `test/e2e/cross-instance.e2e-spec.ts` (create)
- `test/e2e/helpers/create-test-instance.ts` (create)

#### Agent prompt

````
You are a senior NestJS test engineer (distributed-systems focus) working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, Jest +
ts-jest, TS strict. The lib never imports `ioredis` at runtime; tests use `ioredis-mock`.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.10 of 11

PRECONDITIONS
- Tasks 3.2, 3.3, 3.8 done: subscriber + `*Local` path, `RedisRealtimePubSub`, and its specs all exist.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.5 (cross-instance test strategy + acceptance criteria).
- `docs/technical_specification.md` § 11.1–§ 11.2 (why fan-out is needed + the emit-flow diagram),
  § 11.3 (custom `IRealtimePubSub` for SSE).

TASK
Write `test/e2e/cross-instance.e2e-spec.ts` proving cross-instance fan-out via `RedisRealtimePubSub`.

Strategy: a single shared `ioredis-mock` provides an in-process pub/sub equivalent to a real Redis for
test purposes (a `worker_threads` + shared-mock variant is acceptable if preferred). Two isolated NestJS
test modules share that backend; emits cross the bus.

```typescript
import RedisMock from 'ioredis-mock'

describe('cross-instance fan-out via RedisRealtimePubSub', () => {
  const sharedRedis = new RedisMock() // one shared Redis backend

  it('instance A emits -> a connection on instance B receives it', async () => {
    const instanceA = await createTestInstance({ pubClient: sharedRedis })
    const instanceB = await createTestInstance({ pubClient: sharedRedis.duplicate() })
    // Register a fake SSE connection (Subject) on instance B; collect its events.
    // Emit on A: await instanceA.realtime.emitToUser('u1', 'test.event', { value: 42 })
    // After a couple of setImmediate ticks, B's connection has received exactly one event of type 'test.event'.
  })

  it('echo prevention: instance A does NOT double-emit to itself', async () => { /* ... */ })
  it('graceful degradation: pubsub.publish throws -> local emit still works', async () => { /* ... */ })
  it('5-instance fan-out (light stress): one emits, the other four receive', async () => { /* ... */ })
})
```

Add a `createTestInstance(redisOpts)` helper in `test/e2e/helpers/create-test-instance.ts` that builds a
fresh isolated module per call (`BymaxRealtimeModule.forRoot` with `transport: 'sse'`, a fixture
authenticator, and `pubsub: new RedisRealtimePubSub(redisOpts)`), and returns the `RealtimeService`,
the connection registry, and a teardown.

Constraints:
- Every `it()` has a one-line comment. Real assertions. TS strict, no `any` (mock-boundary casts only).
- Close every instance in `afterAll`/`afterEach`; no leaked handles. Bound the run: `--maxWorkers=2`,
  per-test timeout ~30s. If the stack is flaky, isolate the spec rather than weakening assertions.
- English-only, timeless comments. `test/e2e/` emerges from this spec — no `.gitkeep`.

Verification:
- `pnpm test:e2e -- cross-instance` — expected: green across 3 consecutive runs (no flake).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / 11) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 3.11 — Phase 3 validation + barrel verification

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.1…3.10

#### Description

Consolidated phase gate: run the full static + test + build + size pipeline, confirm coverage on the phase's files, confirm the server bundle stays within budget, run a smoke import of the public barrel (real Redis if available, otherwise `ioredis-mock`), and run `/bymax-quality:code-review` over the new pub/sub and offline-queue code.

#### Acceptance criteria

- [x] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size` all pass.
- [x] **100% line/branch coverage** on every file implemented in this phase; mutation focus (Stryker break 95) noted for the critical paths at the pre-release gate.
- [x] The server bundle stays **≤ 18 KB brotli** (the Redis reference adds only a small compressed delta; `ioredis` is never bundled).
- [x] Smoke import of `{ BymaxRealtimeModule, RealtimeService, RedisRealtimePubSub, RedisOfflineQueue }` from the built package works (mock backend acceptable).
- [x] `/bymax-quality:code-review` was run over `src/server/pubsub/` and `src/server/offline-queue/` and findings were applied.

#### Files to create / modify

- (validation only — update the dashboards per the Completion Protocol; no new source files)

#### Agent prompt

````
You are a senior NestJS release engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime library for NestJS. pnpm@11.0.0, TS strict,
tsup build, Jest. Library standard: 100% per-file coverage; server bundle ≤ 18 KB brotli.

CURRENT PHASE: 3 (Horizontal Scaling — SSE) — Task 3.11 of 11 (LAST of the phase)

PRECONDITIONS
- Tasks 3.1–3.10 done: pub/sub core, Redis references, offline queue + delivery, and all specs exist.

REQUIRED READING (only these — do not load more):
- `docs/development_plan.md` § 4.6 (Phase 3 validation + Done criteria), § 1.7 (global Done criteria).
- `docs/technical_specification.md` § 14 (error catalog — `REALTIME_PUBSUB_UNAVAILABLE` degradation),
  § 11 (horizontal scalability overview).

TASK
Run the consolidated phase gate and the code review.

DELIVERABLES

1. Run:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size
   ```
   Confirm: 100% line/branch coverage on the phase's files; server bundle ≤ 18 KB brotli (the Redis
   reference adds ~a small compressed delta; `ioredis` is never bundled into `dist/`).

2. Smoke import of the built public barrel (real Redis via REDIS_URL if available, else `ioredis-mock`):
   ```typescript
   import { BymaxRealtimeModule, RealtimeService, RedisRealtimePubSub, RedisOfflineQueue } from '@bymax-one/nest-realtime'
   // wire BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator: <fixture>,
   //   pubsub: new RedisRealtimePubSub({ pubClient: redis }), offlineQueue: new RedisOfflineQueue({ client: redis }) })
   ```

3. Run `/bymax-quality:code-review` over `src/server/pubsub/` and `src/server/offline-queue/` and apply findings.

Constraints:
- Do not weaken any gate to make it pass; fix the code. English-only, timeless comments.
- Mutation (Stryker break 95, high 99 / low 95) on the critical paths is the pre-release gate (Phase 6),
  not run here — but the critical paths (`in-memory-pubsub.ts`, `realtime-pubsub-subscriber.ts`,
  `redis-realtime-pubsub.ts`, `redis-offline-queue.ts`) must already be at 100% coverage.

Verification:
- The full command line above exits 0; the smoke import resolves all four named exports.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (11 / 11) in the file header and mark the phase ✅.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 3.11 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 3.1 ✅ 2026-06-29 — Refactored `InMemoryPubSub` into async microtask-deferred fan-out with per-handler error isolation.
- 3.2 ✅ 2026-06-29 — Added `RealtimePubSubSubscriber` (echo prevention + `*Local` dispatch) and five non-publishing `*Local` methods on `SseTransport`.
- 3.3 ✅ 2026-06-29 — Implemented `RedisRealtimePubSub` with type-only `ioredis` import, lazy duplicate subscribe client, and silent malformed-payload drop.
- 3.4 ✅ 2026-06-29 — Added `RedisOfflineQueue` (sorted-set, FIFO trim, TTL) and `OfflineQueueDeliveryService` wired into `SseSubscriptionHandler` with ring-buffer dedupe.
- 3.5 ✅ 2026-06-29 — Wired pub/sub + offline-queue + instance-id providers in `BymaxRealtimeModule`, added graceful-degradation try/catch in `RealtimeService`, and exported Redis classes from the main barrel.
- 3.6 ✅ 2026-06-29 — Wrote `InMemoryPubSub` spec (7+ cases) covering async delivery, handler isolation, unsubscribe, and a 1000-message stress pass.
- 3.7 ✅ 2026-06-29 — Wrote `RealtimePubSubSubscriber` spec (12 cases) covering lifecycle, echo prevention, all five op dispatches, error isolation, and bootstrap-failure degradation.
- 3.8 ✅ 2026-06-29 — Wrote `RedisRealtimePubSub` spec against `ioredis-mock` (8 cases) covering JSON publish, lazy subscribe client, multi-handler sharing, quit-on-last-unsubscribe, and malformed-payload drop.
- 3.9 ✅ 2026-06-29 — Wrote `RedisOfflineQueue` spec (8 cases) and offline-queue delivery e2e spec (4 cases) covering append/trim/TTL, exclusive retrieve, acknowledge, and ring-buffer dedupe.
- 3.10 ✅ 2026-06-29 — Wrote cross-instance e2e spec proving A→B fan-out, echo prevention, graceful degradation, and 5-instance light-stress fan-out using shared `ioredis-mock`.
- 3.11 ✅ 2026-06-29 — Passed all quality gates (typecheck, lint, 100% coverage, e2e, build, size ≤ 18 KB brotli); applied code-review and security-review findings.
