# @bymax-one/nest-realtime — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-realtime` — dual-transport realtime for NestJS 11 + React 19
> **Runtime:** Node.js 24+ | Zero direct dependencies (peer deps for transports)

---

## Critical Rules

**1. npm Library — Not an App**

- Zero direct dependencies. Everything is a `peerDependency` (required or optional via `peerDependenciesMeta`).
- Four public subpaths: `.` (SSE server), `./websocket`, `./shared`, `./react`,
  plus `./internal` — resolvable but not public API (see below).
- **The root bundle must not reach `@nestjs/websockets`, `@nestjs/platform-socket.io`
  or `socket.io`.** They are optional peers, so an SSE application does not install
  them; a static import in the root entry fails while the module file is still
  loading, before any guard can run, and the package is unimportable for every SSE
  consumer. Everything that touches the Socket.IO stack lives under
  `src/websocket/`, which is the only graph the `./websocket` entry reaches.
  Gate, on the built artifact rather than the source tree: `pnpm size` fails when
  any of the three tokens appears in `dist/server/*` or `dist/internal/*`.
- **The entry points share one runtime through `./internal`, never a relative path.**
  Each entry is a separate bundle, so a module two of them reach relatively is
  copied into each — and a copied class or `Symbol` is a different injection
  token, so registering a module from one entry and injecting its services from
  another fails with `UnknownElementException` while the source suite, the type
  tests and `attw` all stay green. Anything under `src/websocket/` that needs
  shared code imports `@bymax-one/nest-realtime/internal`. Splitting cannot
  substitute: esbuild splits ESM only, and the package ships CommonJS too.
  Gates: `pnpm size` (the bundles must import the specifier, not inline it) and
  `pnpm check:runtime` (a real consumer boots NestJS against the tarball).
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

- `tsup` with five entries: `internal/index`, `server/index`, `websocket/index`,
  `shared/index`, `react/index`. The package's own subpaths are `external`, which
  is what keeps the shared runtime a single bundle.
- `sideEffects: false`. All peer deps in `external`.
- Output: `.mjs` + `.cjs` + `.d.ts` for each subpath under `dist/`.

---

## Subpaths

| Subpath       | Entry                    | Purpose                                       | Peer Deps                                                                        |
| ------------- | ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `.` (server)  | `src/server/index.ts`    | SSE module, services, pub/sub                 | `@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`                     |
| `./websocket` | `src/websocket/index.ts` | Socket.IO module, gateway, transports         | the root's, plus `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` |
| `./shared`    | `src/shared/index.ts`    | Types + constants (no Node/NestJS dep)        | _(none)_                                                                         |
| `./react`     | `src/react/index.ts`     | Hooks + `RealtimeProvider`                    | `react ^19` (+ optional `socket.io-client ^4`)                                   |
| `./internal`  | `src/internal/index.ts`  | The shared runtime both server entries import | the root's                                                                       |

`./internal` is **not public API** and carries no compatibility promise. It is in
the `exports` map because it has to resolve at runtime: it is what gives the
services and `Symbol` tokens a single identity across the two server entries.

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size && \
  pnpm check:surface && pnpm check:runtime
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

Public-surface audit — every exported name per subpath against a checked-in
snapshot, failing on additions as well as removals, plus every module the
declarations import, which must be a declared peer. A type exported for consumers
and referenced nowhere internally is invisible to `tsc`, to `attw` and to the
README snippets, so it can vanish from a barrel with every other gate green; and a
declaration that imports an undeclared package breaks every consumer compiling
with `skipLibCheck: false`, which is how `@types/express` became a hidden
requirement:

```bash
pnpm check:surface            # verify
pnpm check:surface --update   # accept a deliberate change, then commit the diff
```

Consumer runtime audit — the only gate that boots NestJS against the packed
tarball, in ESM and CommonJS, and the only one that can see a defect in how the
entry points are bundled:

```bash
pnpm check:runtime
```

### Mutation testing

```bash
pnpm mutation
```

Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs; plus an optional manual `pnpm mutation`. Target: ≥ 95% global; ≥ 95% on critical paths. Stryker thresholds: `high: 99, low: 95, break: 95`. Running time: ~15–25 min. Run alone (do not fan out).

---

## Guidelines — Load Only What You Need

| Domain    | File / Command                               | Load when...                      |
| --------- | -------------------------------------------- | --------------------------------- |
| NestJS    | `docs/guidelines/NESTJS-GUIDELINES.md`       | Modifying `src/server/`           |
| RxJS      | `docs/guidelines/RXJS-GUIDELINES.md`         | Working on SSE Observable streams |
| Socket.IO | `docs/guidelines/SOCKET-IO-GUIDELINES.md`    | Working on WebSocket transport    |
| React     | `docs/guidelines/REACT-GUIDELINES.md`        | Working on `src/react/`           |
| Testing   | `docs/guidelines/JEST-TESTING-GUIDELINES.md` | Writing or fixing tests           |
| Infra     | `docs/architecture/infra-considerations.md`  | Deployment configs (proxies, CDN) |

For full architecture, cross-instance emit shape, and testing patterns, see **[AGENTS.md](./AGENTS.md)**.
