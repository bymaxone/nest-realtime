/**
 * Pins `scripts/check-suppressions-baseline.mjs`, the gate that lets `eslint-suppressions.json` shrink
 * and never grow. It is plain Node, so each case runs it the way CI does, as a child process against a
 * throwaway git repository whose first commit is the base revision, and asserts the exit code and the
 * printed problems.
 *
 * Layer: repository tooling, tests.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-suppressions-baseline.mjs')

interface Result {
  readonly status: number | null
  readonly output: string
}

const roots: string[] = []

/** A baseline text with the given `max-lines-per-function` counts, keyed by file. */
function baseline(counts: Record<string, number>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(counts).map(([file, count]) => [
        file,
        { 'max-lines-per-function': { count } },
      ]),
    ),
  )
}

/**
 * A git repository whose first commit holds `committed` as its baseline (or none, for `null`) and whose
 * working tree holds `working`.
 */
function repository(committed: string | null, working: string): string {
  const root = mkdtempSync(join(tmpdir(), 'suppressions-spec-'))
  roots.push(root)
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  if (committed !== null) writeFileSync(join(root, 'eslint-suppressions.json'), committed)
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', 'base')
  writeFileSync(join(root, 'eslint-suppressions.json'), working)
  return root
}

/** Runs the gate in `root` and returns its exit status and combined output. */
function run(root: string, ...args: string[]): Result {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('check-suppressions-baseline', () => {
  // Scenario: the baseline in the change is the base's, has a lower count, or has dropped an entry.
  // Expected: exit 0. Why: a baseline may shrink, and a fixed function is exactly that.
  it('passes a baseline that is unchanged, lower, or has lost an entry', () => {
    const committed = baseline({ 'a.ts': 2 })

    expect(run(repository(committed, baseline({ 'a.ts': 2 })), '--base', 'HEAD').status).toBe(0)
    expect(run(repository(committed, baseline({ 'a.ts': 1 })), '--base', 'HEAD').status).toBe(0)
    expect(run(repository(committed, baseline({})), '--base', 'HEAD').status).toBe(0)
  })

  // Scenario: a count that rose. Expected: exit 1, naming the file, the rule and both counts. Why:
  // regenerating the file after a new violation would otherwise turn that violation into inherited debt.
  it('fails a count that rose, naming the file, the rule and both counts', () => {
    const root = repository(baseline({ 'a.ts': 2 }), baseline({ 'a.ts': 3 }))

    const result = run(root, '--base', 'HEAD')

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'a.ts: 3 `max-lines-per-function` suppression(s), the base revision has 2',
    )
    expect(result.output).toContain('1 suppression(s) added to eslint-suppressions.json.')
  })

  // Scenario: an entry for a file the base does not list. Expected: exit 1. Why: a new file's long
  // function is a new offender, and listing it would admit it.
  it('fails an entry the base revision does not have', () => {
    const root = repository(baseline({ 'a.ts': 2 }), baseline({ 'a.ts': 2, 'new.ts': 1 }))

    const result = run(root, '--base', 'HEAD')

    expect(result.status).toBe(1)
    expect(result.output).toContain('new.ts: 1 `max-lines-per-function` suppression(s)')
    expect(result.output).toContain('the base revision has 0')
  })

  // Scenario: a base revision with no baseline, and no base at all. Expected: exit 0 for both. Why:
  // the change that introduces the baseline has nothing to be compared with, and a run with no base
  // (a manual run, a first push) checks only that the file parses.
  it('imposes nothing when the base has no baseline, and when no base is given', () => {
    const root = repository(null, baseline({ 'a.ts': 9 }))

    expect(run(root, '--base', 'HEAD').status).toBe(0)
    expect(run(root).status).toBe(0)
  })

  // Scenario: a base that is not a revision of the repository. Expected: a non-zero exit that says so.
  // Why: a comparison that cannot be made must not pass as if it had been.
  it('fails for a base that is not a revision', () => {
    const root = repository(baseline({ 'a.ts': 1 }), baseline({ 'a.ts': 1 }))

    const result = run(root, '--base', 'no-such-ref')

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('no-such-ref: not a revision in this repository')
  })

  // Scenario: files that are not baselines: a list, a fractional count, an entry with no count, a
  // negative count.
  // Expected: a non-zero exit naming the problem. Why: a baseline that cannot be read is not one the
  // comparison can trust.
  it('refuses a file that is not an object keyed by file, and a count that is not whole', () => {
    const list = run(repository(null, '[]'))
    const fractional = run(repository(null, '{"a.ts":{"r":{"count":1.5}}}'))
    const missing = run(repository(null, '{"a.ts":{"r":{}}}'))
    const negative = run(repository(null, '{"a.ts":{"r":{"count":-1}}}'))

    expect(list.status).not.toBe(0)
    expect(list.output).toContain('expected an object keyed by file')
    expect(fractional.status).not.toBe(0)
    expect(fractional.output).toContain('a.ts r has no whole count')
    expect(missing.status).not.toBe(0)
    expect(missing.output).toContain('a.ts r has no whole count')
    expect(negative.status).not.toBe(0)
    expect(negative.output).toContain('a.ts r has no whole count')
  })
})
