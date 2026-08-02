# Contributing to @bymax-one/nest-realtime

Thank you for your interest in contributing! This document describes the workflow
and quality gates for this library. By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open public issues for security vulnerabilities.** Follow the private
reporting process described in [SECURITY.md](./SECURITY.md). An event delivered
to the wrong tenant, a connection that survives a failed re-authentication, or a
way past `maxConnectionsPerUser` is a security report, not a bug report.

## Prerequisites

- Node.js >= 24
- pnpm (`corepack enable`)
- Docker, for the cross-instance E2E suite

## Getting started

```bash
pnpm install
pnpm build
```

## Development workflow

This is a published npm library, not an application. Keep `dependencies` empty —
everything ships as a `peerDependency` or a `node:` builtin, and the library never
imports a concrete auth library: authentication lives behind
`IConnectionAuthenticator`, cross-instance fan-out behind `IRealtimePubSub`, and
offline delivery behind `IOfflineQueueStorage`. Conventions live in
[CLAUDE.md](./CLAUDE.md) and [AGENTS.md](./AGENTS.md); the architecture is in
[docs/technical_specification.md](./docs/technical_specification.md).

1. Create a branch from `main`.
2. Make your change; add or update co-located `*.spec.ts` tests (TDD — 100%
   coverage is a hard gate, not a target). Mock every external dependency —
   never a real Redis connection or a real socket in a unit test.
3. Run the full verification suite before opening a PR.

### Invariants a change must preserve

- **Auth inversion** — the library never imports `@bymax-one/nest-auth`,
  `@nestjs/jwt`, or any auth concrete. A consumer owns the implementation.
- **Tenant isolation is enforced server-side** via the room registry. An emit
  scopes to the caller-specified room; a client cannot widen its own scope.
- **Every injectable constructor parameter carries an explicit `@Inject`.** The
  package ships as an esbuild bundle, which does not emit `design:paramtypes`,
  so reflection-based resolution works in this repository's tests and fails in a
  consumer's build.
- **`socket.io-client` stays behind a dynamic import**, so the SSE-only bundle
  keeps its size budget for consumers who never enable WebSocket.
- **Public types import `ioredis` by name** (`import type { Redis }`). A default
  import of a CommonJS module resolves to the module namespace under
  `node16`/`nodenext`, which a consumer cannot use as a type.

## Verification — run before every PR

```bash
pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build && \
  pnpm size && pnpm check:exports && pnpm check:published
```

All of the following must pass:

- **Typecheck** — `tsc --noEmit` (strict, zero errors)
- **Lint** — ESLint (zero `any`, import order, security rules)
- **Coverage** — 100% statements / branches / functions / lines
- **Build** — tsup produces ESM + CJS + `.d.ts` + `.d.cts` for every subpath
- **Size** — every subpath stays within the budget in `scripts/check-size.mjs`
- **Exports** — `attw --profile strict` resolves every entrypoint correctly in
  ESM and CJS, and for resolvers that do not read the `exports` map at all
- **Published surface** — the README's links resolve and its TypeScript snippets
  compile against the **built** package, and every release tag has a CHANGELOG
  section. `typecheck` compiles `src`, so it cannot see a divergence between the
  source and the shipped `.d.ts`; this gate can.

`pnpm test:e2e` runs the in-process suites. The cross-instance Redis suite runs
on a schedule via `e2e-cross-instance.yml` and needs Docker locally.

Mutation testing (`pnpm mutation`) is a **release gate**, run before tagging a
version — never on every PR.

## Commits — Conventional Commits

Commit messages are validated by commitlint via the `commit-msg` hook:

```
<type>(<scope>): <subject>
```

Types: `feat | fix | docs | refactor | perf | test | build | ci | chore | revert`.
The `pre-commit` hook runs lint-staged (ESLint + Prettier on staged files).

## Pull requests

- Keep PRs focused and small.
- Record user-facing changes under the `Unreleased` section of `CHANGELOG.md`.
- All CI checks must be green.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
