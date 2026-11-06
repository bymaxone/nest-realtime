/**
 * Pins `scripts/check-file-size.mjs`, the gate that keeps a source, test or script file from
 * passing the line limit unless it is on a baseline that can only shrink.
 *
 * Layer: repository tooling, tests. The script is plain Node and is run here the way CI runs
 * it, as a child process against a small tree, so the exit code and the printed reasons are what
 * the cases assert.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'check-file-size.mjs')
const LIMIT = 5

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Lays out `files` (path to line count) and a baseline, and returns the root. */
function tree(files: Record<string, number>, baseline?: Record<string, number>): string {
  const root = mkdtempSync(join(tmpdir(), 'file-size-spec-'))
  roots.push(root)
  for (const directory of ['src', 'test', 'scripts']) mkdirSync(join(root, directory))
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), 'x\n'.repeat(lines))
  }
  if (baseline) {
    writeFileSync(join(root, 'scripts', 'file-size-baseline.json'), JSON.stringify(baseline))
  }
  return root
}

/** Runs the gate over `root` with the small limit. */
function check(root: string, extra: string[] = []): { status: number | null; output: string } {
  const run = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, '--limit', String(LIMIT), ...extra],
    {
      encoding: 'utf8',
    },
  )
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe('scripts/check-file-size.mjs', () => {
  // Scenario: every file is at or under the limit. Expected: the gate passes and says how many it saw.
  it('passes a tree with no file over the limit', () => {
    const result = check(tree({ 'src/a.ts': 5, 'test/b.ts': 1, 'scripts/c.mjs': 0 }))

    expect(result.status).toBe(0)
    expect(result.output).toContain('3 files')
  })

  // Scenario: a file passes the limit and nothing excuses it. Expected: it fails and names the file
  // and its size. Why: this is the case a change introduces.
  it('fails a file over the limit that is not on the baseline', () => {
    const result = check(tree({ 'src/a.ts': 6, 'src/ok.ts': 2 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'src/a.ts: 6 lines, over the 5-line limit and not on the baseline',
    )
    expect(result.output).not.toContain('src/ok.ts')
  })

  // Scenario: a file that was already over is on the baseline at its size. Expected: it passes.
  it('passes a baseline file that stays at its ceiling', () => {
    const result = check(tree({ 'src/big.ts': 9 }, { 'src/big.ts': 9 }))

    expect(result.status).toBe(0)
  })

  // Scenario: a baseline file grows. Expected: it fails: the baseline excuses what was there, not growth.
  it('fails a baseline file that grew past its ceiling', () => {
    const result = check(tree({ 'src/big.ts': 10 }, { 'src/big.ts': 9 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/big.ts: 10 lines, past its baseline ceiling of 9')
  })

  // Scenario: a baseline file shrinks but stays over. Expected: it fails until the ceiling follows.
  // Why: a ceiling that stays high leaves room to grow back.
  it('fails a baseline file that shrank until its ceiling is lowered', () => {
    const result = check(tree({ 'src/big.ts': 7 }, { 'src/big.ts': 9 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/big.ts: 7 lines; lower its baseline ceiling from 9 to 7')
  })

  // Scenario: a baseline file is now within the limit. Expected: it fails until the entry is removed.
  it('fails a baseline file that is within the limit until it is removed', () => {
    const result = check(tree({ 'src/big.ts': 5 }, { 'src/big.ts': 9 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'src/big.ts: 5 lines, within the limit; remove it from the baseline',
    )
  })

  // Scenario: the baseline names a file that is gone. Expected: it fails: the list may only shrink.
  it('fails a baseline entry whose file no longer exists', () => {
    const result = check(tree({ 'src/a.ts': 1 }, { 'src/gone.ts': 9 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/gone.ts: on the baseline but no longer exists; remove it')
  })

  // Scenario: big files outside the scanned directories, vendored or generated. Expected: ignored.
  it('ignores directories that are not the repository’s own code', () => {
    const result = check(
      tree({
        'node_modules/pkg/index.js': 50,
        'dist/index.js': 50,
        'docs/example.ts': 50,
        'src/notes.md': 50,
        'src/a.ts': 1,
      }),
    )

    expect(result.status).toBe(0)
    expect(result.output).toContain('1 files')
  })

  // Scenario: a file in a nested source directory. Expected: found, with a forward-slash path.
  it('reports nested files by their relative path', () => {
    const result = check(tree({ 'src/server/deep/a.ts': 8 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/server/deep/a.ts: 8 lines')
  })

  // Scenario: an option the script does not know. Expected: it refuses with a usage message.
  it('refuses an unknown option', () => {
    const result = check(tree({ 'src/a.ts': 1 }), ['--nope', '1'])

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('usage: check-file-size.mjs')
  })

  // Scenario: a baseline the script cannot trust. Expected: each fails loudly and names the problem,
  // and none lets an over-limit file pass: an unusable ceiling must never make a comparison false.
  it.each([
    ['is not valid JSON', '{ nope', 'is not valid JSON'],
    ['is not an object', '[1, 2]', 'must be an object'],
    ['has a ceiling that is not a number', '{"src/big.ts":"abc"}', 'ceiling for src/big.ts'],
    ['has a ceiling that is not an integer', '{"src/big.ts":9.5}', 'ceiling for src/big.ts'],
    ['has a ceiling below one', '{"src/big.ts":0}', 'ceiling for src/big.ts'],
  ])('fails a baseline that %s', (_label, content, message) => {
    const root = tree({ 'src/big.ts': 20 })
    writeFileSync(join(root, 'scripts', 'file-size-baseline.json'), content)

    const result = check(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain(message)
  })

  // Scenario: nothing was scanned, because the root is wrong or the directories were renamed. Expected:
  // it fails: a gate that finds no files has not checked any.
  it('fails when it finds no file to check', () => {
    const result = check(tree({}))

    expect(result.status).toBe(1)
    expect(result.output).toContain('no file found under src, test or scripts')
  })

  // Scenario: one scanned directory is gone, as when src is renamed, while the others still hold
  // files. Expected: it fails and names the directory: a gate that skips a directory checks less.
  it.each(['src', 'test', 'scripts'])('fails when the %s directory is missing', (missing) => {
    const root = tree({ 'src/a.ts': 1, 'test/b.ts': 1, 'scripts/c.mjs': 1 })
    rmSync(join(root, missing), { recursive: true, force: true })

    const result = check(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain(`the ${missing} directory is missing`)
  })

  // Scenario: a root that does not exist. Expected: it fails, naming a missing directory.
  it('fails for a root that does not exist', () => {
    const result = check(join(tmpdir(), 'file-size-spec-no-such-directory'))

    expect(result.status).toBe(1)
    expect(result.output).toContain('directory is missing')
  })

  // Scenario: a last line with no terminating newline. Expected: it counts, since the rule talks
  // about lines and not about newline characters.
  it('counts a last line that has no terminating newline', () => {
    const root = tree({})
    writeFileSync(join(root, 'src', 'a.ts'), 'x\n'.repeat(5) + 'last')

    const result = check(root)

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/a.ts: 6 lines')
  })

  // Scenario: an option given twice. Expected: it is refused, not resolved to the last one.
  it.each([['--root'], ['--limit']])('refuses a repeated %s', (option) => {
    const root = tree({ 'src/a.ts': 1 })
    const run = spawnSync(
      process.execPath,
      [SCRIPT, '--root', root, '--limit', '5', option, option === '--root' ? root : '9'],
      { encoding: 'utf8' },
    )

    expect(run.status).toBe(1)
    expect(run.stderr).toContain(`repeated option ${option}`)
  })

  // Scenario: a bad limit. Expected: it refuses it.
  it.each(['0', 'many', '-3'])('refuses the limit %s', (limit) => {
    const root = tree({ 'src/a.ts': 1 })
    const run = spawnSync(process.execPath, [SCRIPT, '--root', root, '--limit', limit], {
      encoding: 'utf8',
    })

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('invalid --limit')
  })

  // Scenario: a directory named like a build output inside the scanned code. Expected: still scanned,
  // since only vendored packages are skipped.
  it('scans a directory named dist or coverage inside src', () => {
    const result = check(tree({ 'src/dist/a.ts': 8, 'src/coverage/b.ts': 8 }))

    expect(result.status).toBe(1)
    expect(result.output).toContain('src/dist/a.ts: 8 lines')
    expect(result.output).toContain('src/coverage/b.ts: 8 lines')
  })

  // Scenario: this repository. Expected: the gate passes on the real tree with the real baseline, so
  // a file pushed past 800 lines fails the unit suite and not only the CI step.
  it('passes on this repository', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })

    expect(`${run.stdout}${run.stderr}`).toContain('File-size gate')
    expect(run.status).toBe(0)
  })
})
