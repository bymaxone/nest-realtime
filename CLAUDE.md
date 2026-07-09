# @bymax-one/nest-realtime — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-realtime` — dual-transport realtime for NestJS 11 + React 19
> **Runtime:** Node.js 24+ | Zero direct dependencies (peer deps for transports)

---

## Critical Rules

**1. npm Library — Not an App**

- Zero direct dependencies. Everything is a `peerDependency` (required or optional via `peerDependenciesMeta`).
- Three subpaths: `.` (server), `./shared`, `./react`.
- `"dependencies": {}` in `package.json` — verify before any release.

**2. Auth Inversion — Mandatory**

- The library **NEVER** imports `@bymax-one/nest-auth`, `@nestjs/jwt`, `passport-*`, or any auth library.
- `src/` must have zero references to auth concretes. Gate: `grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/` must return zero.
- The consumer plugs `IConnectionAuthenticator`. Bridge examples live in `docs/examples/auth/`.

**3. SSE First, WS Opt-in**

- Default transport is SSE. WebSocket requires explicit `transport: 'websocket' | 'both'`.
- The frontend `socket.io-client` is **dynamically imported** via `await import()` — SSE-only bundle ≤ 4 KiB brotli.
- Gate: `grep -E "^import.*socket.io-client" dist/react/index.mjs` must return zero (no static import).

**4. Multi-Tenant via Rooms**

- Auto-joined: `user:{userId}` always; `tenant:{tenantId}` when `tenantId` is present.
- Consumer-joined: `resource:{type}:{id}` and any application-defined room.
- Lib auto-joins `user:` and `tenant:` rooms on connect; `joinRoom` / `leaveRoom` for the rest.

**5. Cross-Instance**

- `IRealtimePubSub` for SSE scaling (default: `InMemoryPubSub`; recommended: `RedisRealtimePubSub`).
- `@socket.io/redis-adapter` for WebSocket horizontal scaling (via `websocket.redisAdapter.pubClient`).
- Cross-instance emit shape: local delivery + single publish; subscriber re-emits via `*Local` paths; `op: 'disconnect'` for revocation. See AGENTS.md for details.

**6. Reserved Events**

- Named events (from `RESERVED_EVENT_NAMES`): `connection:established`, `connection:reauthentication-failed`, `connection:credential-expiring`, `room:joined`, `room:left`, `error`.
- The SSE heartbeat is a `: keepalive` **comment line** written directly to the response stream — it is **not** a named event, not in the `Last-Event-ID` id-space, and not in the reserved-event catalog.
- Consumer apps should not reuse reserved event names for application-level events.

**7. TypeScript — Zero `any`**

- Use `unknown` where appropriate (e.g. `IRealtimePubSub` message args, `IConnectionLifecycleHooks` payloads).
- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` in `tsconfig.json`.
- Punctual exception: `socket.io-client` types in `useRealtime` (dynamic import without upstream types) — documented inline.

**8. Build**

- `tsup` with three entries: `server/index`, `shared/index`, `react/index`.
- `sideEffects: false`. All peer deps in `external`.
- Output: `.mjs` + `.cjs` + `.d.ts` for each subpath under `dist/`.

---

## Subpaths

| Subpath | Entry | Purpose | Peer Deps |
|---|---|---|---|
| `.` (server) | `src/server/index.ts` | NestJS module — transports, services, pub/sub | `@nestjs/common`, `rxjs` (+ optional WS/Redis deps) |
| `./shared` | `src/shared/index.ts` | Types + constants (no Node/NestJS dep) | _(none)_ |
| `./react` | `src/react/index.ts` | Hooks + `RealtimeProvider` | `react ^19` (+ optional `socket.io-client ^4`) |

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

Full coverage gate:

```bash
pnpm test:cov   # 100% line/branch per implemented file
```

Auth-inversion audit:

```bash
grep -rE "@nestjs/jwt|@bymax-one/nest-auth|passport" src/   # must return zero
```

Socket.io-client static-bundle audit:

```bash
grep -E "^import.*socket.io-client" dist/react/index.mjs    # must return zero
```

### Mutation testing

```bash
pnpm mutation
```

Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs; plus an optional manual `pnpm mutation`. Target: ≥ 95% global; ≥ 95% on critical paths. Stryker thresholds: `high: 99, low: 95, break: 95`. Running time: ~15–25 min. Run alone (do not fan out).

---

## Guidelines — Load Only What You Need

| Domain | File / Command | Load when... |
|---|---|---|
| NestJS | `docs/guidelines/NESTJS-GUIDELINES.md` | Modifying `src/server/` |
| RxJS | `docs/guidelines/RXJS-GUIDELINES.md` | Working on SSE Observable streams |
| Socket.IO | `docs/guidelines/SOCKET-IO-GUIDELINES.md` | Working on WebSocket transport |
| React | `docs/guidelines/REACT-GUIDELINES.md` | Working on `src/react/` |
| Testing | `docs/guidelines/JEST-TESTING-GUIDELINES.md` | Writing or fixing tests |
| Infra | `docs/architecture/infra-considerations.md` | Deployment configs (proxies, CDN) |

For full architecture, cross-instance emit shape, and testing patterns, see **[AGENTS.md](./AGENTS.md)**.
