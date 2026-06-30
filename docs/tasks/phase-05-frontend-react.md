# Phase 5 — Frontend (`./react`)

> **Status**: ✅ Done · **Progress**: 12 / 12 tasks · **Last updated**: 2026-06-30
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 6 (Phase 5)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md) § 12 (Frontend Integration)

---

## Context

Phase 5 delivers the optional `@bymax-one/nest-realtime/react` subpath: a small, tree-shakeable set of React 19 hooks and a provider that consume the realtime backend over either transport.

- `useRealtime` — universal hook that auto-detects SSE vs WebSocket from the URL scheme and exposes connection state, an accumulated `events` array, `lastEvent`, `error`, and `reconnect()`.
- `useRealtimeConnection` — a "lite" variant that returns only `{ connected, error, reconnect }` (no event accumulation).
- `RealtimeProvider` + `useRealtimeContext` — a React context so several hooks share **one** underlying connection instead of opening one `EventSource`/socket each.
- `usePresence` — optional online-user tracking that listens to backend-emitted `presence:online` / `presence:offline` events (requires the backend to be wired with an `IPresenceStorage`).

The load-bearing constraint of the whole phase: **`socket.io-client` must be loaded only through a dynamic `await import()`**, never a static `import`. SSE relies on the browser-native `EventSource` (zero dependencies); the WebSocket path pulls `socket.io-client` lazily so an SSE-only consumer keeps the React bundle **≤ 4 KiB brotli**. A build-output grep enforces this empirically.

Tests run under a `jsdom` Jest project with a reusable `EventSource` mock and a `socket.io-client` mock; the critical hook paths must reach 100% line/branch coverage per file.

---

## Rules-of-phase

1. **English-only and timeless comments.** No Portuguese; no `Phase N`/`Task`/roadmap references inside any committed file (code, JSDoc, config). A reference to a **doc section** (`spec §12.2`, `plan §6.1`) is allowed; a reference to a **plan stage** is not.
2. **No `.gitkeep` / placeholder directories.** Directories emerge from real files only: the `src/react/index.ts` barrel materializes `src/react/`; `test/setup/*` lands when the first fixture is written; `test/e2e/` only appears when the first e2e spec is added. Never pre-create empty scaffolding.
3. **Auth-inversion structural rule.** There must be **NO** reference to `JwtService`, `JwtPayload`, `@bymax-one/nest-auth`, or `passport-*` in any file under `src/` (the React subpath included). The hook never imports an auth SDK; the consumer supplies auth context (HttpOnly cookie via `withCredentials`, or a ticket/token passed through `auth`).
4. **`socket.io-client` is dynamic-import-only.** It must appear **only** inside an `await import('socket.io-client')` call — never as a static `import` anywhere in `src/react/`. This is the invariant that keeps the SSE-only bundle small; the bundle-integrity check greps `dist/react/index.mjs` for static `import … 'socket.io'` lines and fails the build on a match.
5. **Bundle budgets.** SSE-only React bundle **≤ 4 KiB brotli** (never measured gzipped). The server bundle budget is 18 KB brotli (out of this phase's scope, but `pnpm size` covers both subpaths).
6. **`'use client'` directive** at the top of every file that touches React hooks or `EventSource`, so the subpath stays React-Server-Components compatible.
7. **Heartbeat is a raw SSE comment, not an event.** The `: keepalive` keepalive (spec §6.1) is written directly to the response stream by the backend `HeartbeatService`; `EventSource` never surfaces a comment to `onmessage` or `addEventListener`, and `heartbeat` is **not** a reserved named event (spec §13). Hooks must never special-case a `heartbeat` event.
8. **100% line/branch coverage per implemented file** (Bymax library standard). Mutation focus via Stryker (`break 95`, high 99 / low 95) on the critical paths at the pre-release gate. Critical paths: `use-realtime-sse.ts`, `use-realtime-ws.ts`, `use-realtime.ts`, `realtime-provider.tsx`.
9. **TS strict, no `any`.** The dynamically imported socket handle is typed as `unknown` and narrowed via inline casts — never `any`. Functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header per file; JSDoc with `@example` on every public export.
10. **Public barrel hygiene.** Do **not** export internals (`useRealtimeSse`, `useRealtimeWs`) from `src/react/index.ts`; only the public hooks, provider, and convenience type re-exports.
11. **Toolchain.** `pnpm@11.0.0`; gates are `pnpm typecheck`, `pnpm lint`, `pnpm test:cov`, `pnpm build`, `pnpm size`. The `react` Jest project runs under `jsdom`; the `server`/`shared` project stays on `node`.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 3.3 (react subpath exports), § 12 Frontend Integration (§ 12.1 universal hook, § 12.2 SSE/`EventSource`, § 12.3 WebSocket dynamic import, § 12.4 transport detection, § 12.5 usage example, § 12.6 `RealtimeProvider`), § 1.3 (why SSE default / bundle rationale), § 5.6 (`IPresenceStorage`), § 6.1 (heartbeat comment), § 13 (reserved event catalog), § 16 (peer deps `react`/`react-dom`/`socket.io-client`).
- [`docs/development_plan.md`](../development_plan.md) — § 6 Phase 5 detail (§ 6.1–§ 6.7), § 1.5 Phase dashboard, § 1.7 Global per-phase Done criteria.
- `/bymax-workflow:standards` skill — universal coding rules (TypeScript track: strict types, English-only/timeless comments, layered architecture, JSDoc on exports, Conventional Commits).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 5.1 | `useRealtime` — SSE path (`EventSource`) | ✅ Done | P0 | M | 1.6 |
| 5.2 | `useRealtime` — WS path with dynamic `socket.io-client` import | ✅ Done | P0 | M | 5.1 |
| 5.3 | Universal `useRealtime` + `useRealtimeConnection` + `RealtimeProvider` | ✅ Done | P0 | M | 5.1, 5.2 |
| 5.4 | `usePresence` (optional, requires backend `IPresenceStorage`) | ✅ Done | P1 | S | 5.3 |
| 5.5 | `src/react/index.ts` barrel | ✅ Done | P1 | S | 5.3, 5.4 |
| 5.6 | Bundle validation — `socket.io-client` excluded from the static graph | ✅ Done | P0 | S | 5.5 |
| 5.7 | `jsdom` Jest project + `EventSource` / `socket.io-client` mocks | ✅ Done | P0 | M | 1.4 |
| 5.8 | Tests — `useRealtimeSse` (`EventSource` mock) | ✅ Done | P0 | M | 5.1, 5.7 |
| 5.9 | Tests — `useRealtimeWs` (dynamic-import mock) | ✅ Done | P0 | M | 5.2, 5.7 |
| 5.10 | Tests — universal `useRealtime` + `RealtimeProvider` + `useRealtimeConnection` | ✅ Done | P1 | M | 5.3, 5.8, 5.9 |
| 5.11 | Tests — `usePresence` | ✅ Done | P1 | S | 5.4 |
| 5.12 | Phase 5 consolidated validation | ✅ Done | P0 | S | 5.1…5.11 |

---

## Tasks

### Task 5.1 — `useRealtime` — SSE path (`EventSource`)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.6

#### Description

React 19 hook that opens an `EventSource` for an SSE URL, tracks connection state, and exposes `events`, `lastEvent`, `connected`, `error`, and `reconnect()`. Auto-reconnects with exponential backoff capped at a maximum delay.

#### Acceptance criteria

- [x] `src/react/internal/use-realtime-sse.ts` created, type-safe via a `TEvents` generic.
- [x] `'use client'` directive at the top.
- [x] Cleanup in `useEffect` (close the source + null the ref) on unmount.
- [x] Exponential backoff implemented (initial → doubling → capped at `reconnectMaxMs`).
- [x] `events` array keeps only the last 100 entries (`slice(-100)`); `lastEvent` reflects the newest.
- [x] No `heartbeat` special-casing — the `: keepalive` SSE comment never reaches `onmessage`.
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/react/internal/use-realtime-sse.ts` (creates `src/react/internal/`)

#### Agent prompt

````
You are a senior TypeScript / React engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — a dual-transport (SSE default, WebSocket opt-in) realtime
library for NestJS with a unified server-side emit API and an optional React 19 frontend subpath
(`./react`). Subpaths: `.` (server), `./shared` (types/constants, zero deps), `./react`
(hooks + provider). Auth is inverted: the consumer supplies the auth context; the lib imports no
auth SDK.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.1 of 12 (FIRST)

PRECONDITIONS
- The `./shared` subpath exists and exports `RealtimeEvent` (from `src/shared/types/realtime-event.type`).
- No React files exist yet under `src/react/`.

REQUIRED READING (only these — do not load the whole spec):
- `docs/development_plan.md` § 6.1 ("`useRealtime` — SSE-only path" skeleton).
- `docs/technical_specification.md` § 12.1 (the universal hook surface) and § 12.2 (SSE via
  `EventSource`, the reconnect/backoff logic, the `Last-Event-ID` note).
- `docs/technical_specification.md` § 6.1 + § 13 — confirm the `: keepalive` heartbeat is a raw
  SSE comment that `EventSource` never surfaces to `onmessage`, and is NOT a named event.

TASK
Create `src/react/internal/use-realtime-sse.ts`, the SSE branch of the universal hook.

DELIVERABLES

`src/react/internal/use-realtime-sse.ts`:

```typescript
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeEvent } from '../../shared/types/realtime-event.type'

export interface UseRealtimeSseOptions {
  url: string // e.g. '/realtime/sse'
  withCredentials?: boolean
  reconnectInitialMs?: number // default 1000
  reconnectMaxMs?: number // default 30000
}

export interface UseRealtimeSseReturn<TEvents extends Record<string, unknown>> {
  connected: boolean
  events: Array<{ type: keyof TEvents; data: TEvents[keyof TEvents]; id: string }>
  lastEvent: { type: keyof TEvents; data: TEvents[keyof TEvents]; id: string } | undefined
  error: Error | undefined
  reconnect: () => void
}

export function useRealtimeSse<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeSseOptions,
): UseRealtimeSseReturn<TEvents> {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<UseRealtimeSseReturn<TEvents>['events']>([])
  const [lastEvent, setLastEvent] = useState<UseRealtimeSseReturn<TEvents>['lastEvent']>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectMsRef = useRef<number>(opts.reconnectInitialMs ?? 1000)

  const connect = useCallback(() => {
    sourceRef.current?.close()

    // EventSource auto-sends Last-Event-ID based on the previous events it received.
    const source = new EventSource(opts.url, { withCredentials: opts.withCredentials })
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      setError(undefined)
      reconnectMsRef.current = opts.reconnectInitialMs ?? 1000 // reset backoff
    }

    source.onerror = () => {
      setConnected(false)
      setError(new Error('SSE connection error'))
      const delay = Math.min(reconnectMsRef.current * 2, opts.reconnectMaxMs ?? 30_000)
      reconnectMsRef.current = delay
      setTimeout(connect, delay)
    }

    // The default 'message' event. The `: keepalive` heartbeat is a raw SSE comment and never
    // reaches this handler (per spec §6.1 / §13), so no heartbeat special-casing is needed.
    source.onmessage = (e: MessageEvent) => {
      const parsed = {
        type: 'message' as keyof TEvents,
        data: JSON.parse(e.data) as TEvents[keyof TEvents],
        id: e.lastEventId,
      }
      setEvents((prev) => [...prev, parsed].slice(-100)) // keep the last 100
      setLastEvent(parsed)
    }

    // v0.1 delivers via the default 'message' event; named-event subscription (explicit
    // source.addEventListener per event name) is a later enhancement.
  }, [opts.url, opts.withCredentials, opts.reconnectInitialMs, opts.reconnectMaxMs])

  useEffect(() => {
    connect()
    return () => {
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [connect])

  const reconnect = useCallback(() => {
    reconnectMsRef.current = opts.reconnectInitialMs ?? 1000
    connect()
  }, [connect, opts.reconnectInitialMs])

  return { connected, events, lastEvent, error, reconnect }
}
```

Add a `@fileoverview` + `@layer` header and full JSDoc with an `@example` showing typical usage,
plus a note that `'use client'` is required for React Server Components compatibility.

Constraints:
- TS strict, no `any`. English-only, timeless comments (doc-section refs are fine; no phase/task refs).
- Do NOT import `socket.io-client` here (SSE branch only).

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.1 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.2 — `useRealtime` — WS path with dynamic `socket.io-client` import

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.1

#### Description

The WebSocket analogue of the SSE hook. **Critical:** `socket.io-client` is loaded via `await import()` so it never enters the SSE-only static bundle graph. Exposes the same state surface plus `emit()` (full-duplex, WebSocket-exclusive).

#### Acceptance criteria

- [x] `src/react/internal/use-realtime-ws.ts` created.
- [x] No static `import { io } from 'socket.io-client'` at the top — only a dynamic `await import()` inside `connect`.
- [x] `emit(event, data)` exposed (WebSocket-exclusive — absent on the SSE branch).
- [x] Socket handle typed as `unknown` with inline narrowing casts (no `any`).
- [x] SSR-safe: the dynamic import resolves on the client only.
- [x] `pnpm typecheck` passes; `grep` finds zero static `socket.io-client` imports under `src/react/`.

#### Files to create / modify

- `src/react/internal/use-realtime-ws.ts`

#### Agent prompt

````
You are a senior TypeScript / React engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with an optional React 19
`./react` subpath. SSE uses native `EventSource` (zero deps); WebSocket uses `socket.io-client`
loaded ONLY via dynamic import, to keep the SSE-only bundle ≤ 4 KiB brotli.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.2 of 12

PRECONDITIONS
- Task 5.1 is done: `src/react/internal/use-realtime-sse.ts` exists.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.2 ("`useRealtime` WS path with dynamic import" skeleton).
- `docs/technical_specification.md` § 12.3 (the WebSocket dynamic-import strategy and why
  `socket.io-client` must stay out of the static graph).

TASK
Create `src/react/internal/use-realtime-ws.ts`, the WebSocket branch of the universal hook.

DELIVERABLES

`src/react/internal/use-realtime-ws.ts`:

```typescript
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
// CRITICAL: NO static import of 'socket.io-client' — use the dynamic import inside connect().
// This keeps the SSE-only bundle ≤ 4 KiB brotli. The bundle-integrity check
// validates this empirically via grep on dist/react/index.mjs.

export interface UseRealtimeWsOptions {
  url: string // e.g. 'wss://api.example.com' or '/' for same-origin
  auth?: { ticket?: string; token?: string }
  path?: string // socket.io path, default '/socket.io'
}

export interface UseRealtimeWsReturn<TEvents extends Record<string, unknown>> {
  connected: boolean
  events: Array<{ type: keyof TEvents; data: TEvents[keyof TEvents] }>
  lastEvent: { type: keyof TEvents; data: TEvents[keyof TEvents] } | undefined
  error: Error | undefined
  emit: (event: string, data: unknown) => void
  reconnect: () => void
}

export function useRealtimeWs<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeWsOptions,
): UseRealtimeWsReturn<TEvents> {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<UseRealtimeWsReturn<TEvents>['events']>([])
  const [lastEvent, setLastEvent] = useState<UseRealtimeWsReturn<TEvents>['lastEvent']>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  // Typed as `unknown` (narrowed via inline casts) so socket.io-client's types are not statically imported.
  const socketRef = useRef<unknown>(null)

  const connect = useCallback(async () => {
    try {
      // DYNAMIC IMPORT — the bundler keeps socket.io-client out of the static graph.
      const { io } = await import('socket.io-client')
      const socket = io(opts.url, {
        path: opts.path ?? '/socket.io',
        auth: opts.auth,
        withCredentials: true,
      })
      socketRef.current = socket

      socket.on('connect', () => {
        setConnected(true)
        setError(undefined)
      })
      socket.on('disconnect', () => setConnected(false))
      socket.on('error', (e: Error) => setError(e))
      socket.onAny((eventName: string, payload: unknown) => {
        const parsed = { type: eventName as keyof TEvents, data: payload as TEvents[keyof TEvents] }
        setEvents((prev) => [...prev, parsed].slice(-100))
        setLastEvent(parsed)
      })
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [opts.url, opts.auth, opts.path])

  useEffect(() => {
    void connect()
    return () => {
      const sock = socketRef.current as { disconnect?: () => void } | null
      sock?.disconnect?.()
      socketRef.current = null
    }
  }, [connect])

  const emit = useCallback((event: string, data: unknown): void => {
    const sock = socketRef.current as { emit?: (e: string, d: unknown) => void } | null
    sock?.emit?.(event, data)
  }, [])

  const reconnect = useCallback(() => {
    void connect()
  }, [connect])

  return { connected, events, lastEvent, error, emit, reconnect }
}
```

Notes to encode in JSDoc:
- `socketRef.current` is `unknown` (narrowed via inline casts) — avoids a static type import of socket.io-client.
- `emit` supports full-duplex (WebSocket-exclusive; the SSE branch has no `emit`).
- The dynamic import inside `connect` resolves on the client only (SSR-safe).

Constraints:
- NO static `import … 'socket.io-client'` anywhere in the file. TS strict, no `any`.
- English-only, timeless comments (doc-section refs fine; no phase/task refs in code).
- Add `@fileoverview` + `@layer` header and an `@example`.

Verification:
- `pnpm typecheck` — expected: passes.
- `grep -RE "^import.*socket\.io-client" src/react/` — expected: zero matches (only dynamic import()).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.2 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.3 — Universal `useRealtime` + `useRealtimeConnection` + `RealtimeProvider`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.1, 5.2

#### Description

The public universal hook that detects SSE vs WebSocket from the URL scheme, a connection-only "lite" hook (no events array), and a context provider so multiple hooks share a single connection.

#### Acceptance criteria

- [x] Three files created (`use-realtime.ts`, `use-realtime-connection.ts`, `realtime-provider.tsx`).
- [x] `useRealtime` auto-detects correctly (`ws://`/`wss://` → WebSocket, otherwise SSE).
- [x] Explicit `transport` override works (forces the chosen branch regardless of URL).
- [x] `RealtimeProvider` shares a single connection across consumers.
- [x] `useRealtimeContext()` throws an explanatory error when used outside `<RealtimeProvider>`.
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/react/hooks/use-realtime.ts`
- `src/react/hooks/use-realtime-connection.ts`
- `src/react/providers/realtime-provider.tsx`

#### Agent prompt

````
You are a senior TypeScript / React engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with a React 19 `./react`
subpath. SSE via native EventSource; WebSocket via dynamically imported socket.io-client.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.3 of 12

PRECONDITIONS
- Tasks 5.1 and 5.2 are done: `internal/use-realtime-sse.ts` and `internal/use-realtime-ws.ts` exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.1 and § 6.3 (universal hook + connection hook + provider skeletons).
- `docs/technical_specification.md` § 12.4 (automatic transport detection) and § 12.6
  (`RealtimeProvider` for sharing one connection across hooks).

TASK
Create the three public composition files.

DELIVERABLES

1. `src/react/hooks/use-realtime.ts`:

```typescript
'use client'
import { useRealtimeSse } from '../internal/use-realtime-sse'
import { useRealtimeWs } from '../internal/use-realtime-ws'

export interface UseRealtimeOptions {
  url: string
  transport?: 'auto' | 'sse' | 'websocket' // default 'auto' — detect from the URL
  withCredentials?: boolean
  auth?: { ticket?: string; token?: string }
  path?: string // WebSocket path
}

/**
 * Universal realtime hook — auto-detects SSE vs WebSocket from the URL scheme.
 *
 *   - http(s):// or a path starting with /  → SSE via EventSource
 *   - ws(s)://                              → WebSocket via socket.io-client (dynamic import)
 *
 * Override with `transport` when needed.
 */
export function useRealtime<TEvents extends Record<string, unknown> = Record<string, unknown>>(
  opts: UseRealtimeOptions,
) {
  const detected = opts.transport && opts.transport !== 'auto' ? opts.transport : detectTransport(opts.url)
  if (detected === 'websocket') {
    return {
      transport: 'websocket' as const,
      ...useRealtimeWs<TEvents>({ url: opts.url, auth: opts.auth, path: opts.path }),
    }
  }
  return {
    transport: 'sse' as const,
    ...useRealtimeSse<TEvents>({ url: opts.url, withCredentials: opts.withCredentials }),
    emit: undefined as never,
  }
}

function detectTransport(url: string): 'sse' | 'websocket' {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'websocket'
  return 'sse'
}
```

2. `src/react/hooks/use-realtime-connection.ts` — the "lite" variant (no events array):

```typescript
'use client'
import { useRealtime, type UseRealtimeOptions } from './use-realtime'

export function useRealtimeConnection(opts: UseRealtimeOptions) {
  const { connected, error, reconnect } = useRealtime<Record<string, never>>(opts)
  return { connected, error, reconnect }
}
```

3. `src/react/providers/realtime-provider.tsx`:

```typescript
'use client'
import { createContext, useContext, type PropsWithChildren } from 'react'
import { useRealtime, type UseRealtimeOptions } from '../hooks/use-realtime'

const RealtimeContext = createContext<ReturnType<typeof useRealtime> | null>(null)

export function RealtimeProvider({
  options,
  children,
}: PropsWithChildren<{ options: UseRealtimeOptions }>) {
  const value = useRealtime(options)
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext() {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtimeContext must be used within <RealtimeProvider>')
  return ctx
}
```

Add `@fileoverview` + `@layer` headers and JSDoc with an `@example` in all three files.

Constraints:
- The two React-rule caveats: respect the rules-of-hooks (call both branch hooks only via the
  single chosen path — keep the conditional at the top so hook order is stable for a given URL).
- TS strict, no `any`. English-only, timeless comments. Do not import socket.io-client statically.

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.3 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.4 — `usePresence` (optional, requires backend `IPresenceStorage`)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 5.3

#### Description

Hook that listens to the backend-emitted `presence:online` / `presence:offline` events and keeps the set of online `userId`s locally. The backend must be configured with an `IPresenceStorage` (supplied by the consumer) for these events to be emitted; the hook must be used inside `<RealtimeProvider>`.

#### Acceptance criteria

- [x] `src/react/hooks/use-presence.ts` created.
- [x] Requires the provider (consumes `useRealtimeContext`) and re-throws its error when used outside.
- [x] State updates on `presence:online` (adds the userId) and `presence:offline` (removes it).
- [x] Returns `{ onlineUserIds, isOnline, count }`.
- [x] `pnpm typecheck` passes.

#### Files to create / modify

- `src/react/hooks/use-presence.ts`

#### Agent prompt

````
You are a senior TypeScript / React engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with a React 19 `./react`
subpath. Presence is an optional feature gated on a backend `IPresenceStorage`.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.4 of 12

PRECONDITIONS
- Task 5.3 is done: `RealtimeProvider` + `useRealtimeContext` and the universal hook exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.4 (`usePresence` skeleton).
- `docs/technical_specification.md` § 12.5 (usage example) and § 5.6 (`IPresenceStorage` — what the
  backend must be wired with for `presence:online`/`presence:offline` to be emitted). Note these
  presence events are application-level, NOT part of the reserved §13 event catalog.

TASK
Create `src/react/hooks/use-presence.ts`.

DELIVERABLES

`src/react/hooks/use-presence.ts`:

```typescript
'use client'
import { useEffect, useState } from 'react'
import { useRealtimeContext } from '../providers/realtime-provider'

export interface UsePresenceReturn {
  onlineUserIds: string[]
  isOnline: (userId: string) => boolean
  count: number
}

/**
 * Live online-users tracking.
 *
 * Requires:
 *   1. A backend configured with `IPresenceStorage`, emitting `presence:online` /
 *      `presence:offline` events.
 *   2. The hook used inside `<RealtimeProvider>`.
 */
export function usePresence(): UsePresenceReturn {
  const { events } = useRealtimeContext()
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    const lastEv = events[events.length - 1]
    if (!lastEv) return
    if (lastEv.type === 'presence:online') {
      const { userId } = lastEv.data as { userId: string }
      setOnline((prev) => new Set(prev).add(userId))
    } else if (lastEv.type === 'presence:offline') {
      const { userId } = lastEv.data as { userId: string }
      setOnline((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }, [events])

  return {
    onlineUserIds: Array.from(online),
    isOnline: (userId: string) => online.has(userId),
    count: online.size,
  }
}
```

Add a `@fileoverview` + `@layer` header and JSDoc documenting both preconditions.

Constraints:
- TS strict, no `any`. English-only, timeless comments.

Verification:
- `pnpm typecheck` — expected: passes.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.4 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.5 — `src/react/index.ts` barrel

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 5.3, 5.4

#### Description

The complete public barrel for the `./react` subpath. Exports only the public hooks, the provider, and a couple of convenience type re-exports from `./shared`. Writing this file materializes `src/react/index.ts`.

#### Acceptance criteria

- [x] `src/react/index.ts` exports `useRealtime`, `UseRealtimeOptions`, `useRealtimeConnection`, `usePresence`, `UsePresenceReturn`, `RealtimeProvider`, `useRealtimeContext`, and the convenience `RealtimeEvent` / `TransportMode` type re-exports.
- [x] Internals (`useRealtimeSse`, `useRealtimeWs`) are NOT exported.
- [x] `pnpm build` produces `dist/react/index.{mjs,cjs,d.ts}`.

#### Files to create / modify

- `src/react/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with a React 19 `./react`
subpath. The `./react` barrel is the public API surface for frontend consumers.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.5 of 12

PRECONDITIONS
- Tasks 5.1–5.4 are done: the hooks and provider exist; `./shared` exports `RealtimeEvent` and
  `TransportMode`.

REQUIRED READING (only these):
- `docs/technical_specification.md` § 3.3 (the `@bymax-one/nest-realtime/react` export list).

TASK
Write `src/react/index.ts` (this file write creates the barrel; no empty placeholder dirs).

DELIVERABLES

`src/react/index.ts`:

```typescript
'use client'

// Hooks
export { useRealtime } from './hooks/use-realtime'
export type { UseRealtimeOptions } from './hooks/use-realtime'
export { useRealtimeConnection } from './hooks/use-realtime-connection'
export { usePresence } from './hooks/use-presence'
export type { UsePresenceReturn } from './hooks/use-presence'

// Provider
export { RealtimeProvider, useRealtimeContext } from './providers/realtime-provider'

// Shared re-exports (client-side convenience)
export type { RealtimeEvent, TransportMode } from '../shared'
```

Constraints:
- Do NOT export internals (`useRealtimeSse`, `useRealtimeWs`).
- English-only, timeless comments.

Verification:
- `pnpm build` — expected: emits `dist/react/index.mjs`, `dist/react/index.cjs`, `dist/react/index.d.ts`.
- `node -e "import('./dist/react/index.mjs').then(m => console.log(Object.keys(m).sort()))"`
  — expected: ['RealtimeProvider', 'useRealtime', 'useRealtimeConnection', 'useRealtimeContext', 'usePresence'].

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.5 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.6 — Bundle validation — `socket.io-client` excluded from the static graph

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.5

#### Description

Empirical bundle-integrity check: `dist/react/index.mjs` must NOT contain a static `import` of `socket.io-client` — only the dynamic-import string. The SSE-only React bundle must stay ≤ 4 KiB brotli. Wire the static-import grep into `scripts/check-size.mjs` so it fails the build automatically.

#### Acceptance criteria

- [x] `dist/react/index.mjs` ≤ 4 KiB brotli.
- [x] `socket.io-client` appears only as a dynamic-import string, never in a static `import` line.
- [x] `pnpm size` passes.
- [x] `scripts/check-size.mjs` runs the static-import check automatically (`process.exit(1)` on a match).

#### Files to create / modify

- `scripts/check-size.mjs` (modify)

#### Agent prompt

````
You are a senior build / release engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS. The SSE-only React bundle
must stay ≤ 4 KiB brotli, which depends on socket.io-client being absent from the static graph
(loaded only via dynamic import in the WS hook).

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.6 of 12

PRECONDITIONS
- Task 5.5 is done: `pnpm build` emits `dist/react/index.mjs`. `scripts/check-size.mjs` already
  exists (introduced earlier with the size budgets) and is run by `pnpm size`.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.5 (bundle validation).
- `docs/technical_specification.md` § 12.3 (dynamic-import strategy) and § 1.3 (why SSE default /
  the bundle rationale).

TASK
Validate the React bundle empirically and bake the static-import check into `scripts/check-size.mjs`.

DELIVERABLES

1. Run `pnpm build`, then inspect `dist/react/index.mjs`:

```bash
# socket.io-client should appear only inside a dynamic import() string
grep -c "socket\.io-client" dist/react/index.mjs

# there must be ZERO static imports of socket.io
grep -E "^import.*['\"]socket\.io" dist/react/index.mjs && echo "FAIL: static import" || echo "OK"
```

   Expected: `socket.io-client` may appear as the dynamic-import argument, but never on a static
   `import` line; zero static-import matches.

2. Confirm `pnpm size` reports the react bundle ≤ 4 KiB brotli. If it fails (socket.io-client got
   bundled), review the tsup externals and confirm `use-realtime-ws.ts` really uses `await import()`
   (not `require()` or a static import).

3. Update `scripts/check-size.mjs` to perform the static-import check automatically: read
   `dist/react/index.mjs`, fail with `process.exit(1)` if a line matches a static
   `import … 'socket.io…'`, and assert the brotli size budget (≤ 4096 bytes) for the react bundle.

Constraints:
- The size threshold is brotli, not gzip. English-only, timeless comments in the script.

Verification:
- `pnpm build && pnpm size` — expected: passes, react bundle ≤ 4 KiB brotli.
- `grep -E "^import.*['\"]socket\.io" dist/react/index.mjs && echo FAIL || echo OK` — expected: OK.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.6 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.7 — `jsdom` Jest project + `EventSource` / `socket.io-client` mocks

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.4

#### Description

Configure a `jsdom` Jest project for `src/react/**` (the server/shared project stays on `node`) and create reusable mocks: a global `EventSource` mock with manual `emitMessage`/`emitError` helpers, and a `socket.io-client` mock helper for the WebSocket hook tests.

#### Acceptance criteria

- [x] `jest.config.ts` declares two projects: `server` (node) and `react` (jsdom).
- [x] `test/setup/react-setup.ts` installs a functional global `EventSource` mock + `emitMessage` / `emitError` helpers.
- [x] `test/setup/socket-io-client-mock.ts` provides a `mockSocketIoClient()` helper (handlers + `trigger`).
- [x] `pnpm test --selectProjects=react` runs (passing with no specs yet is acceptable).

#### Files to create / modify

- `jest.config.ts` (modify)
- `test/setup/react-setup.ts`
- `test/setup/socket-io-client-mock.ts`

#### Agent prompt

````
You are a senior test infrastructure engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with a React 19 `./react`
subpath. Server/shared tests run under `node`; React tests need a `jsdom` environment plus an
`EventSource` mock (jsdom has none) and a `socket.io-client` mock.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.7 of 12

PRECONDITIONS
- `jest.config.ts` exists with bounded workers (`maxWorkers: '50%'`). React Testing Library
  (`@testing-library/react`) is available as a devDependency.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.6 (React testing setup — jsdom + EventSource mock).

TASK
Add a `jsdom` Jest project for React and the reusable test fixtures.

DELIVERABLES

1. `jest.config.ts` — split into projects (keep `maxWorkers: '50%'` at the top level):

```typescript
projects: [
  {
    displayName: 'server',
    testMatch: ['<rootDir>/src/server/**/*.spec.ts', '<rootDir>/src/shared/**/*.spec.ts'],
    testEnvironment: 'node',
  },
  {
    displayName: 'react',
    testMatch: ['<rootDir>/src/react/**/*.spec.tsx', '<rootDir>/src/react/**/*.spec.ts'],
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/test/setup/react-setup.ts'],
  },
]
```

2. `test/setup/react-setup.ts`:

```typescript
import '@testing-library/jest-dom' // if needed for DOM matchers

// EventSource mock — assigned globally so useRealtimeSse finds it under jsdom.
class EventSourceMock {
  url: string
  withCredentials: boolean
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string, opts?: EventSourceInit) {
    this.url = url
    this.withCredentials = opts?.withCredentials ?? false
    // Defer onopen to the next tick (mimics real behavior).
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.(new Event('open'))
    }, 0)
  }
  close(): void {
    this.readyState = 2
  }
  addEventListener(): void {
    /* stub */
  }
  removeEventListener(): void {
    /* stub */
  }
  dispatchEvent(): boolean {
    return true
  }
}
;(global as unknown as { EventSource: unknown }).EventSource = EventSourceMock

// Helper for tests to emit messages manually.
export function emitMessage(source: EventSourceMock, data: unknown, lastEventId = ''): void {
  const ev = new MessageEvent('message', { data: JSON.stringify(data), lastEventId })
  source.onmessage?.(ev)
}

export function emitError(source: EventSourceMock): void {
  source.onerror?.(new Event('error'))
}
```

3. `test/setup/socket-io-client-mock.ts`:

```typescript
type Handler = (...args: unknown[]) => void

export function mockSocketIoClient() {
  const handlers = new Map<string, Set<Handler>>()
  let anyHandler: ((event: string, payload: unknown) => void) | undefined
  const socket = {
    on: (event: string, h: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(h)
    },
    onAny: (h: (event: string, payload: unknown) => void) => {
      anyHandler = h
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  }
  const io = jest.fn(() => socket)
  jest.doMock('socket.io-client', () => ({ io }))
  return {
    socket,
    io,
    trigger: (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((h) => h(...args)),
    triggerAny: (event: string, payload: unknown) => anyHandler?.(event, payload),
  }
}
```

Constraints:
- TS strict, no `any` (use `unknown` + casts in the global assignment). English-only comments.
- Do not create empty placeholder dirs — `test/setup/` is created by writing these files.

Verification:
- `pnpm test --selectProjects=react` — expected: runs (passing with no specs is fine).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.7 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.8 — Tests — `useRealtimeSse` (`EventSource` mock)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.1, 5.7

#### Description

React Testing Library specs for `useRealtimeSse` against the `EventSource` mock, covering open, message accumulation, last-event tracking, the 100-entry cap, error/backoff, reconnect, cleanup, and `withCredentials` forwarding.

#### Acceptance criteria

- [x] `src/react/internal/use-realtime-sse.spec.tsx` created with 8+ cases.
- [x] After the mock fires `open`, `connected === true`.
- [x] A message adds to `events` with its `lastEventId`; `lastEvent` reflects the newest.
- [x] `events.length` is capped at 100.
- [x] An error sets `connected = false` + `error`; consecutive errors increase the backoff delay (fake timers).
- [x] `reconnect()` forces a new `EventSource`; unmount closes it (cleanup).
- [x] `withCredentials: true` is forwarded to the `EventSource` constructor.
- [x] 100% line/branch coverage on `use-realtime-sse.ts`.

#### Files to create / modify

- `src/react/internal/use-realtime-sse.spec.tsx`

#### Agent prompt

````
You are a senior test engineer working on @bymax-one/nest-realtime. Use the project's `tester`
discipline: every `it()` carries a comment, real branches, no fake assertions.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime; React 19 `./react` subpath.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.8 of 12

PRECONDITIONS
- Task 5.1 (`useRealtimeSse`) and Task 5.7 (jsdom project + `EventSource` mock helpers) are done.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.6 (sample React specs).
- `docs/technical_specification.md` § 12.2 (the SSE reconnect/backoff behavior under test).

TASK
Create `src/react/internal/use-realtime-sse.spec.tsx` using `@testing-library/react`'s
`renderHook` and the `EventSource` mock + `emitMessage`/`emitError` helpers from
`test/setup/react-setup.ts`.

DELIVERABLES — at least these cases:
1. `renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))` mounts without crashing.
2. After the deferred `open`, `result.current.connected === true`.
3. `emitMessage(source, { foo: 1 }, 'id-1')` appends to `events` with `id === 'id-1'`.
4. `lastEvent` reflects the most recent message.
5. The `events` array is capped at 100 (push >100 and assert `slice(-100)`).
6. `emitError(source)` sets `connected === false` and a non-undefined `error`.
7. `reconnect()` forces a new `EventSource` instance.
8. Unmount closes the `EventSource` (cleanup) and nulls the ref.
9. Exponential backoff: consecutive errors increase the scheduled delay (use `jest.useFakeTimers()`).
10. `withCredentials: true` is passed to the `EventSource` constructor.

Constraints:
- 100% line/branch coverage on `use-realtime-sse.ts`. TS strict, no `any` in tests.
- English-only; one explanatory comment per `it()`.

Verification:
- `pnpm test --selectProjects=react src/react/internal/use-realtime-sse` — expected: green.
- Coverage report shows 100% for `use-realtime-sse.ts`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.8 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.9 — Tests — `useRealtimeWs` (dynamic-import mock)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.2, 5.7

#### Description

Specs for `useRealtimeWs` with `socket.io-client` mocked via `jest.doMock` (the `mockSocketIoClient` helper), covering connect, event accumulation via `onAny`, `emit`, disconnect, error, cleanup, and auth pass-through.

#### Acceptance criteria

- [x] `src/react/internal/use-realtime-ws.spec.tsx` created with 7+ cases.
- [x] The hook calls `io(url, { … })` after mount.
- [x] `trigger('connect')` sets `connected = true`; `trigger('disconnect')` sets it false.
- [x] An `onAny` event is appended to `events`.
- [x] `emit(event, data)` calls `socket.emit`.
- [x] `trigger('error', new Error('x'))` sets the `error` state.
- [x] Unmount calls `socket.disconnect()`.
- [x] Auth passes through: `{ auth: { ticket: 'xyz' } }` reaches `io`.
- [x] 100% line/branch coverage on `use-realtime-ws.ts`.

#### Files to create / modify

- `src/react/internal/use-realtime-ws.spec.tsx`

#### Agent prompt

````
You are a senior test engineer working on @bymax-one/nest-realtime. Use the `tester` discipline.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime; React 19 `./react` subpath. The WS
hook loads socket.io-client via dynamic import, so tests mock it with `jest.doMock`.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.9 of 12

PRECONDITIONS
- Task 5.2 (`useRealtimeWs`) and Task 5.7 (`mockSocketIoClient` helper) are done.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.6 (sample React specs).
- `docs/technical_specification.md` § 12.3 (the WebSocket hook behavior under test).

TASK
Create `src/react/internal/use-realtime-ws.spec.tsx`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { mockSocketIoClient } from '../../../test/setup/socket-io-client-mock'
import { useRealtimeWs } from './use-realtime-ws'
```

DELIVERABLES — at least these cases:
1. The hook calls `io(url, { … })` after mount (await via `waitFor`, since the import is async).
2. `trigger('connect')` → `connected === true`.
3. `triggerAny('msg', payload)` → the event is appended to `events`.
4. `emit('evt', data)` calls `socket.emit` with those args.
5. `trigger('disconnect')` → `connected === false`.
6. `trigger('error', new Error('x'))` → `error` state is set.
7. Unmount → `socket.disconnect()` is called.
8. Auth pass-through: `useRealtimeWs({ url, auth: { ticket: 'xyz' } })` → `io` receives
   `{ auth: { ticket: 'xyz' } }`.

Constraints:
- 100% line/branch coverage on `use-realtime-ws.ts`. Reset modules between specs as needed
  (`jest.resetModules()`) so `jest.doMock` takes effect before the dynamic import resolves.
- TS strict, no `any`. English-only; one comment per `it()`.

Verification:
- `pnpm test --selectProjects=react src/react/internal/use-realtime-ws` — expected: green.
- Coverage report shows 100% for `use-realtime-ws.ts`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.9 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.10 — Tests — universal `useRealtime` + `RealtimeProvider` + `useRealtimeConnection`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 5.3, 5.8, 5.9

#### Description

Specs for the composition layer: transport auto-detection and override in the universal hook, the provider sharing one connection, the context-guard error, and the "lite" connection hook.

#### Acceptance criteria

- [x] `src/react/hooks/use-realtime.spec.tsx` (5+ cases): `/realtime/sse` and `http://…` → SSE; `ws://…` and `wss://…` → WebSocket; `transport: 'sse'` override despite a `ws://` URL; `transport: 'websocket'` override despite an `http://` URL.
- [x] `src/react/providers/realtime-provider.spec.tsx` (4+ cases): provider renders children; `useRealtimeContext()` inside returns the value; outside throws the explanatory error; one shared connection for multiple consumers (spy on the `EventSource` constructor → called once).
- [x] `src/react/hooks/use-realtime-connection.spec.tsx` (3+ cases): returns only `{ connected, error, reconnect }` (no `events`); `connected` reflects state; `reconnect` works.
- [x] 100% line/branch coverage on `use-realtime.ts`, `use-realtime-connection.ts`, `realtime-provider.tsx`.

#### Files to create / modify

- `src/react/hooks/use-realtime.spec.tsx`
- `src/react/providers/realtime-provider.spec.tsx`
- `src/react/hooks/use-realtime-connection.spec.tsx`

#### Agent prompt

````
You are a senior test engineer working on @bymax-one/nest-realtime. Use the `tester` discipline.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime; React 19 `./react` subpath.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.10 of 12

PRECONDITIONS
- Task 5.3 (universal hook + provider + connection hook) is done; the EventSource and
  socket.io-client mocks (Task 5.7) exist; the branch-hook specs (5.8, 5.9) are green.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.6 (sample React specs).
- `docs/technical_specification.md` § 12.4 (transport detection) and § 12.6 (provider sharing).

TASK
Create three spec files.

DELIVERABLES

1. `src/react/hooks/use-realtime.spec.tsx` — at least:
   - URL `/realtime/sse` → `transport === 'sse'`.
   - URL `http://localhost/sse` → SSE.
   - URL `ws://localhost` → `transport === 'websocket'`.
   - URL `wss://api/socket.io` → WebSocket.
   - `transport: 'sse'` override despite a `ws://` URL (rare but supported).
   - `transport: 'websocket'` override despite an `http://` URL.

2. `src/react/providers/realtime-provider.spec.tsx` — at least:
   - `<RealtimeProvider options={...}>{children}</RealtimeProvider>` renders.
   - `useRealtimeContext()` inside the provider returns the value.
   - `useRealtimeContext()` outside throws the explanatory Error.
   - The provider shares ONE connection across multiple consumers (spy on the `EventSource`
     constructor → asserted called exactly once).

3. `src/react/hooks/use-realtime-connection.spec.tsx` — at least:
   - Returns only `{ connected, error, reconnect }` (no `events`).
   - `connected` reflects state.
   - `reconnect` works.

Constraints:
- 100% line/branch coverage on the three files under test. TS strict, no `any`.
- English-only; one comment per `it()`.

Verification:
- `pnpm test --selectProjects=react src/react/hooks src/react/providers` — expected: green.
- Coverage report shows 100% for `use-realtime.ts`, `use-realtime-connection.ts`, `realtime-provider.tsx`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.10 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.11 — Tests — `usePresence`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 5.4

#### Description

Specs for `usePresence`: the provider guard, the empty initial state, and online/offline transitions driven by `presence:online` / `presence:offline` events.

#### Acceptance criteria

- [x] `src/react/hooks/use-presence.spec.tsx` created with 5+ cases.
- [x] Throws when used outside the provider (same message as `useRealtimeContext`).
- [x] Inside the provider with no presence events → `onlineUserIds: []`, `count: 0`.
- [x] After `presence:online` with `{ userId: 'u1' }` → `onlineUserIds` includes `'u1'`.
- [x] After `presence:offline` with `{ userId: 'u1' }` → `onlineUserIds` no longer includes `'u1'`.
- [x] `isOnline('u1')` returns the correct boolean.
- [x] 100% line/branch coverage on `use-presence.ts`.

#### Files to create / modify

- `src/react/hooks/use-presence.spec.tsx`

#### Agent prompt

````
You are a senior test engineer working on @bymax-one/nest-realtime. Use the `tester` discipline.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime; React 19 `./react` subpath.
Presence depends on backend-emitted `presence:online`/`presence:offline` events flowing through
the shared connection.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.11 of 12

PRECONDITIONS
- Task 5.4 (`usePresence`) is done; the provider and EventSource mock exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.6 (sample React specs).
- `docs/technical_specification.md` § 12.5 (presence usage example).

TASK
Create `src/react/hooks/use-presence.spec.tsx`.

DELIVERABLES — at least these cases:
1. Throws when used outside `<RealtimeProvider>` (same message as `useRealtimeContext`).
2. Inside the provider with no presence events → `onlineUserIds: []`, `count: 0`.
3. After a `presence:online` event with `{ userId: 'u1' }` → `onlineUserIds` includes `'u1'`.
4. After a `presence:offline` event with `{ userId: 'u1' }` → `onlineUserIds` no longer includes `'u1'`.
5. `isOnline('u1')` returns true/false correctly across the transitions.

(Drive the events through the shared connection by emitting `presence:online`/`presence:offline`
messages via the EventSource mock so they land in the provider's `events` array.)

Constraints:
- 100% line/branch coverage on `use-presence.ts`. TS strict, no `any`.
- English-only; one comment per `it()`.

Verification:
- `pnpm test --selectProjects=react src/react/hooks/use-presence` — expected: green.
- Coverage report shows 100% for `use-presence.ts`.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.11 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

### Task 5.12 — Phase 5 consolidated validation

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.1…5.11

#### Description

Run the full gate set for the phase, confirm the critical paths reach 100% coverage, the React bundle stays ≤ 4 KiB brotli with `socket.io-client` out of the static graph, run an SSE-only consumer smoke test (ephemeral, not committed), and apply a code review of `src/react/`.

#### Acceptance criteria

- [x] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` all pass.
- [x] 100% line/branch coverage on every implemented `src/react/` file (critical paths included).
- [x] React SSE-only bundle ≤ 4 KiB brotli.
- [x] `socket.io-client` is absent from the static import graph (the bundle-integrity check passes).
- [x] `/bymax-quality:code-review` of `src/react/` executed and findings applied.

#### Files to create / modify

- (none — validation only; any smoke-test consumer app is ephemeral and not committed)

#### Agent prompt

````
You are a senior release engineer working on @bymax-one/nest-realtime.

PROJECT: @bymax-one/nest-realtime — dual-transport realtime for NestJS with a React 19 `./react`
subpath. This task gates the whole frontend phase.

CURRENT PHASE: 5 (Frontend — `./react`) — Task 5.12 of 12 (LAST)

PRECONDITIONS
- Tasks 5.1–5.11 are done: all hooks, the provider, the barrel, the bundle check, and all specs exist.

REQUIRED READING (only these):
- `docs/development_plan.md` § 6.7 (Phase 5 validation + done criteria).
- `docs/technical_specification.md` § 1.3 (the SSE bundle rationale and budget).

TASK
Run the consolidated gates and validate the frontend deliverables.

DELIVERABLES

1. Run:

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

2. Confirm:
   - 100% line/branch coverage on every implemented `src/react/` file (critical paths:
     `use-realtime.ts`, `use-realtime-sse.ts`, `use-realtime-ws.ts`, `realtime-provider.tsx`).
   - React SSE-only bundle ≤ 4 KiB brotli.
   - `socket.io-client` is NOT in the static import graph (the Task 5.6 check passes).

3. SSE-only smoke test (ephemeral — build in a temp dir OUTSIDE the repo; do not commit any
   scaffold): a minimal consumer app that
   - imports `{ useRealtime, RealtimeProvider }` from `@bymax-one/nest-realtime/react`,
   - uses the hook in a component over an SSE URL,
   - builds, and you confirm the resulting consumer bundle does not pull in socket.io-client when
     the hook uses SSE.

4. Run `/bymax-quality:code-review` over `src/react/` and apply the findings.

Constraints:
- Do NOT create committed example/scaffold directories or `.gitkeep` files. English-only.

Verification:
- All five gate commands exit 0; coverage and size budgets are met; the smoke build confirms
  socket.io-client is loaded only on the WS path.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in its block and in the Task index table.
2. Tick the acceptance-criteria checkboxes now satisfied.
3. Update the task's row in the Task index table.
4. Increment the phase Progress counter (X / Y) in the file header.
5. Update this phase's row in docs/development_plan.md §1.5 Phase dashboard (Status + Progress + Last updated) AND the docs/tasks/README.md folder index.
6. Recompute Overall progress (phases + M/73 tasks, %) in docs/development_plan.md §1.4.
7. Append a completion-log entry: - 5.12 ✅ <YYYY-MM-DD> — <one-line summary>.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 5.1 ✅ 2026-06-30 — Created `src/react/internal/use-realtime-sse.ts` with EventSource, exponential backoff, and 100-entry cap.
- 5.2 ✅ 2026-06-30 — Created `src/react/internal/use-realtime-ws.ts` with dynamic socket.io-client import and full-duplex emit.
- 5.3 ✅ 2026-06-30 — Created `useRealtime`, `useRealtimeConnection`, and `RealtimeProvider` with shared-connection context.
- 5.4 ✅ 2026-06-30 — Created `usePresence` tracking presence:online/offline events via context.
- 5.5 ✅ 2026-06-30 — Written `src/react/index.ts` barrel exporting all public hooks and provider.
- 5.6 ✅ 2026-06-30 — Verified bundle: react ≤ 1.55 KB brotli; no static socket.io-client import in dist/react/index.mjs.
- 5.7 ✅ 2026-06-30 — Split Jest into server (node) and react (jsdom) projects; added EventSource mock and socket.io-client mock helpers.
- 5.8 ✅ 2026-06-30 — 14-case spec for useRealtimeSse covering open/message/error/backoff/reconnect/cleanup; 100% coverage.
- 5.9 ✅ 2026-06-30 — 15-case spec for useRealtimeWs covering io/connect/events/emit/disconnect/auth/reconnect/catch; 100% coverage.
- 5.10 ✅ 2026-06-30 — Specs for useRealtime (transport detection), RealtimeProvider (shared connection), and useRealtimeConnection; 100% coverage.
- 5.11 ✅ 2026-06-30 — 8-case spec for usePresence covering guard, online/offline transitions, isOnline, and integration mount; 100% coverage.
- 5.12 ✅ 2026-06-30 — All 5 gates pass: typecheck 0 errors, lint 0 issues, test:cov 100%/100%, build clean, size within budgets.
