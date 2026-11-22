/**
 * @fileoverview The size script refuses a build older than its sources whatever PACKAGE_TARBALL holds.
 * @layer scripts
 *
 * `scripts/check-dist-fresh.mjs` passes without comparing when `PACKAGE_TARBALL` is set, because a script that
 * measures a tarball has no `dist/` to compare. `scripts/check-size.mjs` measures `dist/` and never reads that
 * variable, so the size script has to run the freshness check without it. The test runs the first command of the
 * `size` script in a throwaway directory whose `dist/` is older than its `src/`, with the variable set.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const freshness = packageJson.scripts.size
  .split(' && ')[0]
  .replace(
    'scripts/check-dist-fresh.mjs',
    fileURLToPath(new URL('./check-dist-fresh.mjs', import.meta.url)),
  )

test('the size script refuses a stale dist even when PACKAGE_TARBALL is set', () => {
  const root = mkdtempSync(join(tmpdir(), 'size-script-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'src', 'a.ts'), 'export {}\n')
    writeFileSync(join(root, 'dist', 'a.js'), 'export {}\n')
    utimesSync(join(root, 'dist', 'a.js'), new Date('2000-01-01'), new Date('2000-01-01'))

    const result = spawnSync('sh', ['-c', freshness], {
      cwd: root,
      env: { ...process.env, PACKAGE_TARBALL: join(root, 'missing.tgz') },
      encoding: 'utf8',
    })

    assert.equal(result.status, 1, result.stdout + result.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
