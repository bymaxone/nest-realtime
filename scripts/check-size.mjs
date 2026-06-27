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

const BUDGETS = [
  { name: 'server (NestJS module + transports)', path: 'dist/server/index.mjs', brotli: 18_000 },
  { name: 'shared (types + constants)', path: 'dist/shared/index.mjs', brotli: 3_000 },
  { name: 'react (hooks + provider, SSE-only base)', path: 'dist/react/index.mjs', brotli: 4_000 },
]

const FORBIDDEN_STATIC = [{ path: 'dist/react/index.mjs', token: 'socket.io-client' }]

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

for (const rule of FORBIDDEN_STATIC) {
  const absolute = join(rootDir, rule.path)
  if (!existsSync(absolute)) continue
  const contents = readFileSync(absolute, 'utf8')
  if (contents.includes(rule.token)) {
    console.error(
      `✗ STATIC IMPORT  ${rule.path} statically references "${rule.token}" — it must be a dynamic import only`,
    )
    failed = true
  } else {
    console.log(`✓ OK     ${rule.path} contains no static "${rule.token}" reference`)
  }
}

if (failed) {
  console.error('\nBundle-size gate FAILED.')
  process.exit(1)
}
console.log('\nBundle-size gate passed.')
