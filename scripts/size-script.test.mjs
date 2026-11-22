/**
 * @fileoverview The size script refuses a build older than its sources, its manifest or a tsconfig the build reads.
 * @layer scripts
 *
 * `scripts/check-dist-fresh.mjs` compares `dist/` with the sources and, with `--also`, with the files named. The `size`
 * script does not pass `--tarball-ok`, so the check also refuses with `PACKAGE_TARBALL` set, which is right because
 * `scripts/check-size.mjs` always measures `dist/`. The tests run the first command of the `size` script in a
 * throwaway directory whose `dist/` is older than one input at a time.
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

/** Runs the freshness command in a directory whose dist is older than `stale`, a file created there; `env` is added. */
function run(stale, env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'size-script-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'a.js'), 'export {}\n')
    utimesSync(join(root, 'dist', 'a.js'), new Date('2000-01-01'), new Date('2000-01-01'))
    writeFileSync(join(root, stale), 'export {}\n')
    return spawnSync('sh', ['-c', freshness], {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the size script refuses a stale dist even when PACKAGE_TARBALL is set', () => {
  const result = run('src/a.ts', { PACKAGE_TARBALL: '/does-not-exist.tgz' })

  assert.equal(result.status, 1, result.stdout + result.stderr)
})

for (const file of ['tsup.config.ts', 'package.json', 'tsconfig.build.json', 'tsconfig.json']) {
  test(`the size script refuses a dist older than ${file}`, () => {
    const result = run(file)

    assert.equal(result.status, 1, result.stdout + result.stderr)
  })
}
