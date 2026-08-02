#!/usr/bin/env node
/**
 * Public-surface gate.
 *
 * Compares every name each subpath exports, read from the built `.d.ts`, against
 * a checked-in snapshot. Any difference fails, in both directions: a removal is a
 * breaking change that a patch must not make, and an addition is a promise the
 * package will have to keep.
 *
 * It exists because nothing else could see a dropped export. `tsc` only checks
 * what the repository itself references, `attw` checks that declarations
 * *resolve* rather than what they contain, and the README snippets exercise a
 * handful of names. A type exported for consumers and used nowhere internally can
 * disappear from the barrel with every gate still green — which is exactly what
 * happened to `TransportMode`, `RealtimeEvent`, `RoomPrefix`, `ReservedEventName`,
 * `RealtimeErrorCode` and `ConnectionEventMeta` while the entry points were being
 * restructured.
 *
 * Updating the snapshot is the point: it turns a silent surface change into a
 * reviewable diff. Run with `--update` to rewrite it deliberately.
 *
 * Usage: `node scripts/check-public-surface.mjs [--update]` (run after `pnpm build`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotPath = join(rootDir, 'test/types/public-surface.json')

/** Subpath → the declaration file a consumer resolves through the exports map. */
const SUBPATHS = {
  '.': 'dist/server/index.d.ts',
  './websocket': 'dist/websocket/index.d.ts',
  './shared': 'dist/shared/index.d.ts',
  './react': 'dist/react/index.d.ts',
}

/**
 * Every name a declaration file exports.
 *
 * The AST rather than a regex: `export { a as b }`, `export declare const`, and a
 * modifier-carrying declaration all reach the surface differently, and a regex
 * that misses one under-reports — which for this gate reads as "nothing changed".
 */
function exportedNames(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const names = new Set()

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      // A bundled declaration file resolves its own re-exports, so a surviving
      // `export *` would hide names from this gate. Refuse rather than under-report.
      if (!statement.exportClause) {
        throw new Error(`${file} contains an unresolved \`export *\` — the surface cannot be read`)
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text)
      } else {
        names.add(statement.exportClause.name.text)
      }
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text)
    }
  }

  return [...names].sort()
}

const update = process.argv.includes('--update')

console.log('Public-surface gate')

const current = {}
for (const [subpath, relative] of Object.entries(SUBPATHS)) {
  const absolute = join(rootDir, relative)
  if (!existsSync(absolute)) {
    console.error(`✗ ${relative} is missing — run \`pnpm build\` first`)
    process.exit(1)
  }
  current[subpath] = exportedNames(absolute)
}

if (update) {
  writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`)
  const total = Object.values(current).reduce((sum, names) => sum + names.length, 0)
  console.log(`  wrote ${total} export(s) across ${Object.keys(current).length} subpaths`)
  console.log('✓ Snapshot updated. Review the diff before committing.')
  process.exit(0)
}

if (!existsSync(snapshotPath)) {
  console.error(`✗ ${snapshotPath} is missing — create it with \`pnpm check:surface --update\``)
  process.exit(1)
}

const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const problems = []

for (const subpath of new Set([...Object.keys(expected), ...Object.keys(current)])) {
  const before = expected[subpath] ?? []
  const after = current[subpath] ?? []
  const removed = before.filter((name) => !after.includes(name))
  const added = after.filter((name) => !before.includes(name))
  if (removed.length) {
    problems.push(`${subpath}: no longer exports ${removed.join(', ')} — a breaking change`)
  }
  if (added.length) {
    problems.push(`${subpath}: now exports ${added.join(', ')} — not in the snapshot`)
  }
  if (!removed.length && !added.length) {
    console.log(`  ✓ ${subpath.padEnd(12)} ${after.length} export(s) unchanged`)
  }
}

if (problems.length) {
  console.error(`\n✖ ${problems.length} problem(s):\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\nIf the change is intended, run `pnpm check:surface --update` and commit the diff.',
  )
  process.exit(1)
}

console.log('✓ The public surface matches the snapshot.')
