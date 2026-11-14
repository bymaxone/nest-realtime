/**
 * Pins `scripts/check-spec-headers.mjs`, the gate that makes every spec open with a block comment
 * stating a purpose and a layer. It is plain Node, so each case runs it the way CI does, as a child
 * process against a throwaway git repository whose tracked files are the specs under test, and asserts
 * the exit code and the printed problems.
 *
 * Layer: repository tooling, tests.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-spec-headers.mjs')
const SHIPPED_BASELINE = resolve(__dirname, '..', 'scripts', 'spec-header-baseline.json')

interface Result {
  readonly status: number | null
  readonly output: string
}

const roots: string[] = []

/** A valid header followed by code. */
const GOOD =
  '/**\n * @fileoverview Specs of the widget: what it accepts and what it refuses.\n * @layer transport\n */\n\nimport x from "x"\n'

/** A spec that opens with code and so has no header. */
const HEADERLESS = 'import x from "x"\n'

/** A scratch git repository with `files` tracked. */
function scratch(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'spec-headers-spec-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

/** Runs the gate in `root` against a baseline file holding `baselineText`. */
function run(root: string, baselineText: string, ...args: string[]): Result {
  writeFileSync(join(root, 'baseline.json'), baselineText)
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, '--baseline', join(root, 'baseline.json'), ...args],
    { encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/** The problem the gate prints for one spec whose text is `text`, or `null` when it passes. */
function problemOf(text: string): string | null {
  const result = run(scratch({ 'src/x.spec.ts': text }), '{"files":[]}')
  return result.status === 0 ? null : result.output
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('check-spec-headers', () => {
  describe('what a header is', () => {
    // Scenario: a header with a purpose and a layer, a header in the `Layer:` sentence form behind a
    // byte-order mark, and layers the repository names in its own words. Expected: all pass. Why:
    // the specs name the layer they test in their own terms, so the gate asks that one is named and not
    // which, and failing a spec over a word would be the wrong signal.
    it('accepts a purpose with any layer word, in either form, behind a byte-order mark', () => {
      expect(problemOf(GOOD)).toBeNull()
      expect(
        problemOf('﻿/**\n * What the widget spec covers in detail. Layer: application.\n */\n'),
      ).toBeNull()
      for (const layer of [
        'transport',
        'infrastructure',
        'utils',
        'e2e',
        'test-fixture',
        'react',
      ]) {
        expect(
          problemOf(`/**\n * Specs of the widget and what it accepts.\n * @layer ${layer}\n */\n`),
        ).toBeNull()
      }
    })

    // Scenario: a spec that opens with code, with a line comment, and with a plain block comment.
    // Expected: each fails, saying it does not open with a JSDoc block. Why: the header is the first
    // thing a reader sees, and only a JSDoc block is read as one.
    it('refuses a spec that does not open with a /** */ block comment', () => {
      expect(problemOf(HEADERLESS)).toContain('does not open with a /** */ block comment')
      expect(problemOf('// Specs of the widget\nimport x from "x"\n')).toContain(
        'does not open with a /** */ block comment',
      )
      expect(problemOf('/* Specs of the widget @layer transport */\n')).toContain(
        'does not open with a /** */ block comment',
      )
    })

    // Scenario: a header that states a purpose and no layer. Expected: it fails, naming the marker.
    it('refuses a header without a layer marker', () => {
      expect(problemOf('/**\n * Specs of the widget and what it accepts.\n */\n')).toContain(
        'header has no layer marker',
      )
    })

    // Scenario: a header that states a layer and says nothing else. Expected: it fails, saying it
    // does not state what the file tests. Why: a layer alone tells a reader where the file sits and not
    // what it covers.
    it('refuses a header that states a layer but not what the file tests', () => {
      expect(problemOf('/**\n * @fileoverview Widget.\n * @layer transport\n */\n')).toContain(
        'header states a layer but not what the file tests',
      )
    })
  })

  describe('which files are specs', () => {
    // Scenario: one headerless file of each name: the unit `.spec.ts`, the React `.spec.tsx`, the
    // end-to-end `-spec.ts`, and a helper that is not a spec. Expected: the three specs are named and
    // the helper is not. Why: only a spec is held to the header, and a `.tsx` spec is one.
    it('checks .spec.ts, .spec.tsx and -spec.ts files, and nothing else', () => {
      const root = scratch({
        'src/a.spec.ts': HEADERLESS,
        'src/react/b.spec.tsx': HEADERLESS,
        'test/e2e/c-spec.ts': HEADERLESS,
        'src/helper.ts': HEADERLESS,
      })

      const result = run(root, '{"files":[]}')

      expect(result.status).toBe(1)
      expect(result.output).toContain('src/a.spec.ts')
      expect(result.output).toContain('src/react/b.spec.tsx')
      expect(result.output).toContain('test/e2e/c-spec.ts')
      expect(result.output).not.toContain('src/helper.ts')
      expect(result.output).toContain('3 spec header problem(s).')
    })
  })

  describe('the baseline', () => {
    // Scenario: the baseline the repository ships. Expected: it lists no file. Why: every tracked spec
    // must have a valid header, so a spec without one is a new offender and fails.
    it('ships empty, so a spec without a header fails', () => {
      const shipped = JSON.parse(readFileSync(SHIPPED_BASELINE, 'utf8')) as { files: string[] }
      const root = scratch({ 'src/new.spec.ts': HEADERLESS })

      const result = run(root, readFileSync(SHIPPED_BASELINE, 'utf8'))

      expect(shipped.files).toEqual([])
      expect(result.status).toBe(1)
      expect(result.output).toContain('src/new.spec.ts: does not open with a /** */ block comment.')
    })

    // Scenario: a headerless spec that the baseline lists, beside one with a header. Expected: pass.
    // Why: the baseline lets the gate be red for what a change introduces and not for what it inherits.
    it('passes a headerless spec that is on it', () => {
      const root = scratch({ 'src/ok.spec.ts': GOOD, 'src/old.spec.ts': HEADERLESS })

      expect(run(root, '{"files":["src/old.spec.ts"]}').status).toBe(0)
    })

    // Scenario: a listed spec that now has a header, and one that is no longer tracked. Expected: both
    // fail until the entry is removed. Why: a fixed file must not stay listed and quietly regress.
    it('fails a listed spec that was fixed or is gone, until its entry is removed', () => {
      const fixed = run(scratch({ 'src/fixed.spec.ts': GOOD }), '{"files":["src/fixed.spec.ts"]}')
      const gone = run(scratch({ 'src/other.spec.ts': GOOD }), '{"files":["src/gone.spec.ts"]}')

      expect(fixed.status).toBe(1)
      expect(fixed.output).toContain(
        'src/fixed.spec.ts is on the baseline but now has a valid header',
      )
      expect(fixed.output).toContain('Remove its entry.')
      expect(gone.status).toBe(1)
      expect(gone.output).toContain('src/gone.spec.ts is on the baseline')
    })

    // Scenario: a baseline that is not a list of strings. Expected: a non-zero exit saying what was
    // expected. Why: a baseline that cannot be read is not one the check can trust.
    it('refuses a baseline that is not a list of file names', () => {
      const root = scratch({ 'src/ok.spec.ts': GOOD })

      for (const text of ['{"files":{"a":1}}', '{"files":[1]}', '{}']) {
        const result = run(root, text)

        expect(result.status).not.toBe(0)
        expect(result.output).toContain('expected { "files": [ "<path>", ... ] }')
      }
    })

    // Scenario: with `--base`, an entry the base revision's baseline did not have, and then one it had.
    // Expected: the first fails, naming it, and the second passes. Why: the baseline in a change is the
    // change's own file, and without the comparison it could admit the offender it adds.
    it('compares with the base revision: an entry the base lacks fails', () => {
      const root = scratch({ 'src/old.spec.ts': HEADERLESS })
      writeFileSync(join(root, 'baseline.json'), '{"files":[]}')
      execFileSync('git', ['add', '-A'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], {
        cwd: root,
      })

      const widened = run(root, '{"files":["src/old.spec.ts"]}', '--base', 'HEAD')

      expect(widened.status).toBe(1)
      expect(widened.output).toContain(
        'src/old.spec.ts is on the baseline but the base revision does not have it',
      )
      writeFileSync(join(root, 'baseline.json'), '{"files":["src/old.spec.ts"]}')
      execFileSync('git', ['add', '-A'], { cwd: root })
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'listed'],
        {
          cwd: root,
        },
      )
      expect(run(root, '{"files":["src/old.spec.ts"]}', '--base', 'HEAD').status).toBe(0)
    })

    // Scenario: a base that is not a revision. Expected: a non-zero exit that says so. Why: a
    // comparison that cannot be made must not pass as if it had been.
    it('fails for a base that is not a revision', () => {
      const root = scratch({ 'src/ok.spec.ts': GOOD })

      const result = run(root, '{"files":[]}', '--base', 'no-such-ref')

      expect(result.status).not.toBe(0)
      expect(result.output).toContain('no-such-ref: not a revision in this repository')
    })
  })
})
