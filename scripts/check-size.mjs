#!/usr/bin/env node
/**
 * Bundle-size gate (zero external dependencies).
 *
 * Validates the brotli-compressed size of each subpath bundle against its budget
 * and fails the build when a budget is exceeded. Budgets are BROTLI bytes (never
 * gzip): the brotli ratio is what CDNs serve, so it is the honest wire cost.
 *
 * It also enforces a structural invariant for the React subpath: `socket.io-client`
 * must NEVER appear statically in `dist/react/index.mjs`. The browser bundle is the
 * SSE-only base; `socket.io-client` is loaded through a dynamic `import()` only, so
 * an SSE-only consumer never pays for it.
 *
 * Usage: `node scripts/check-size.mjs` (run after `pnpm build`).
 */
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// Budgets calibrated against measured brotli sizes, with per-bundle headroom:
//   server    0.24 KB →  0.5 KB (a re-export facade over the shared runtime)
//   internal 13.55 KB → 14.5 KB (7% headroom — the bulk of an SSE install)
//   websocket 5.99 KB →  6.5 KB (8% headroom — the Socket.IO stack alone)
//   shared    0.44 KB →  0.6 KB (37% headroom, kept slightly generous for future constants)
//   react     2.26 KB →  2.4 KB (6% headroom)
//
// What an SSE application pays on the server is `server` + `internal`, since the
// root imports the shared runtime rather than inlining it: two bundles, one
// identity for the classes and `Symbol`s used as injection tokens. `websocket`
// is what the Socket.IO transport adds on top, and only for those who import it.
//
// These are ratchets, deliberately far below the architectural ceiling for the
// SSE-only React bundle (4 KiB brotli — see CLAUDE.md). Raise a ratchet only for
// code that has to exist; the ceiling is what must never move.
const BUDGETS = [
  { name: 'server (root facade)', path: 'dist/server/index.mjs', brotli: 500 },
  { name: 'internal (shared runtime, SSE)', path: 'dist/internal/index.mjs', brotli: 14_500 },
  { name: 'websocket (Socket.IO transport)', path: 'dist/websocket/index.mjs', brotli: 6_500 },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 600 },
  { name: 'react (hooks + provider, SSE-only base)', path: 'dist/react/index.mjs', brotli: 2_400 },
]

// The Socket.IO stack must not be reachable from anything an SSE application
// loads. It is the whole reason the transports are split across entry points,
// and a stray import puts it back into every install without failing anything.
const SSE_ONLY_BUNDLES = [
  'dist/server/index.mjs',
  'dist/server/index.cjs',
  'dist/internal/index.mjs',
  'dist/internal/index.cjs',
]
const SOCKET_IO_TOKENS = ['@nestjs/websockets', '@nestjs/platform-socket.io', 'socket.io']

const FORBIDDEN_STATIC = [
  { path: 'dist/react/index.mjs', token: 'socket.io-client' },
  ...SSE_ONLY_BUNDLES.flatMap((path) => SOCKET_IO_TOKENS.map((token) => ({ path, token }))),
]

// The mirror image: the entry points must *reach* the shared runtime rather than
// inline it. A copied class or `Symbol` is a different injection token, so a
// bundle that stopped importing this specifier is one that silently gave the
// consumer two containers' worth of identities. `check:runtime` proves the
// consequence; this catches the cause at build time, in a second.
const REQUIRED_STATIC = [
  'dist/server/index.mjs',
  'dist/server/index.cjs',
  'dist/websocket/index.mjs',
  'dist/websocket/index.cjs',
].map((path) => ({ path, token: '@bymax-one/nest-realtime/internal' }))

function brotliSize(buffer) {
  return brotliCompressSync(buffer, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
  }).length
}

function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(2)} KB`
}

let failed = false

for (const budget of BUDGETS) {
  const absolute = join(rootDir, budget.path)
  if (!existsSync(absolute)) {
    console.error(`✗ MISSING  ${budget.name} — expected ${budget.path} (run \`pnpm build\` first)`)
    failed = true
    continue
  }
  const size = brotliSize(readFileSync(absolute))
  const within = size <= budget.brotli
  const status = within ? '✓ OK    ' : '✗ OVER  '
  console.log(
    `${status} ${budget.name}: ${formatBytes(size)} brotli (budget ${formatBytes(budget.brotli)})`,
  )
  if (!within) failed = true
}

// Match a STATIC import/require of the token — `import "x"`, `... from "x"`,
// `require("x")` — but NOT the allowed dynamic `import("x")` (it has a parenthesis,
// not a quote, after `import`). Otherwise the gate would false-flag the dynamic form.
function staticImportRegex(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*)['"]${escaped}['"]`)
}

for (const rule of FORBIDDEN_STATIC) {
  const absolute = join(rootDir, rule.path)
  if (!existsSync(absolute)) continue
  const contents = readFileSync(absolute, 'utf8')
  if (staticImportRegex(rule.token).test(contents)) {
    console.error(
      `✗ STATIC IMPORT  ${rule.path} statically references "${rule.token}" — it must be a dynamic import only`,
    )
    failed = true
  } else {
    console.log(`✓ OK     ${rule.path} contains no static "${rule.token}" reference`)
  }
}

for (const rule of REQUIRED_STATIC) {
  const absolute = join(rootDir, rule.path)
  if (!existsSync(absolute)) continue
  const contents = readFileSync(absolute, 'utf8')
  if (staticImportRegex(rule.token).test(contents)) {
    console.log(`✓ OK     ${rule.path} imports "${rule.token}" instead of inlining it`)
  } else {
    console.error(
      `✗ INLINED  ${rule.path} does not import "${rule.token}" — the shared runtime was copied into this bundle, giving its classes and \`Symbol\`s a second identity`,
    )
    failed = true
  }
}

if (failed) {
  console.error('\nBundle-size gate FAILED.')
  process.exit(1)
}
console.log('\nBundle-size gate passed.')
