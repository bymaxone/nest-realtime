/**
 * Pins `scripts/extract-release-notes.mjs`, which writes the notes of a GitHub Release from the
 * changelog. It is plain Node, so each case runs it the way the release workflow does, as a child
 * process against a throwaway changelog, and asserts the exit code and what it prints.
 *
 * Layer: repository tooling, tests.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'extract-release-notes.mjs')

interface Result {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const roots: string[] = []

/** Writes `text` as a changelog in a throwaway directory and runs the script for `version` on it. */
function notesOf(version: string | undefined, text: string): Result {
  const root = mkdtempSync(join(tmpdir(), 'release-notes-spec-'))
  roots.push(root)
  const changelog = join(root, 'CHANGELOG.md')
  writeFileSync(changelog, text)
  const args = version === undefined ? [] : [version, changelog]
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  'Not yet.',
  '',
  '## [1.2.14] - 2026-11-14',
  '',
  '### Fixed',
  '',
  '- The fourteenth.',
  '',
  '## [1.2.1] - 2026-01-01',
  '',
  '- The first.',
  '',
].join('\n')

describe('extract-release-notes', () => {
  // Scenario: a version in the middle of the changelog. Expected: the lines under its heading, up to
  // the next `## [` heading, each ending in a line feed. Why: the Release body is that section and
  // nothing of its neighbours.
  it('prints the lines between the version heading and the next heading', () => {
    const result = notesOf('1.2.14', CHANGELOG)

    expect(result).toEqual({
      status: 0,
      stdout: '\n### Fixed\n\n- The fourteenth.\n\n',
      stderr: '',
    })
  })

  // Scenario: the oldest version, whose section runs to the end of the file. Expected: all of it.
  // Why: there is no later heading to stop at, and the last line must not be lost.
  it('prints a last section to the end of the file', () => {
    expect(notesOf('1.2.1', CHANGELOG).stdout).toBe('\n- The first.\n')
  })

  // Scenario: a changelog whose last line has no line feed. Expected: the section still ends in
  // one. Why: the notes go to a file and a reader should not see a half line.
  it('ends the notes in a line feed when the changelog does not', () => {
    expect(notesOf('1.0.0', '## [1.0.0]\n\n- Only.').stdout).toBe('\n- Only.\n')
  })

  // Scenario: asking for 1.2.1 when 1.2.14 also exists, and the other way round. Expected: each
  // gets its own section. Why: the version is matched with its closing bracket, so a prefix of
  // another version does not open that version's section.
  it('does not open the section of a version that has this one as a prefix', () => {
    const changelog = '## [1.2.14]\n\n- long\n\n## [1.2.1]\n\n- short\n'

    expect(notesOf('1.2.1', changelog).stdout).toBe('\n- short\n')
    expect(notesOf('1.2.14', changelog).stdout).toBe('\n- long\n\n')
  })

  // Scenario: a second-level heading inside the section that does not open with a bracket.
  // Expected: it stays in the notes. Why: only a `## [` line is a version heading, so prose under a
  // heading of its own, such as an upgrade note, belongs to the section it sits in.
  it('keeps a second-level heading that is not a version heading inside the section', () => {
    const changelog = '## [1.0.0]\n\n## Upgrading\n\n- do this\n\n## [0.9.0]\n\n- old\n'

    expect(notesOf('1.0.0', changelog).stdout).toBe('\n## Upgrading\n\n- do this\n\n')
  })

  // Scenario: a version written with another character where the dots are. Expected: no section.
  // Why: the version is a literal, so a dot matches only a dot.
  it('matches the dots of the version literally', () => {
    const result = notesOf('1x2x14', CHANGELOG)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })

  // Scenario: a heading that carries a second bracketed token after the first. Expected: the
  // section of the version in the second bracket is not found. Why: only a heading's own first
  // bracket names its version, so a second token cannot open a section.
  it('does not let a second bracketed token on a heading open its section', () => {
    const changelog = '## [Unreleased] [2.0.0]\n\n- not a release\n\n## [1.0.0]\n\n- real\n'

    expect(notesOf('2.0.0', changelog).status).toBe(1)
    expect(notesOf('1.0.0', changelog).stdout).toBe('\n- real\n')
  })

  // Scenario: a version with no heading, and a heading with an empty section. Expected: exit 1 and
  // a message that names the problem without the version. Why: the release must stop before the
  // registry, and the version came from a tag name that can hold anything, so it is never printed.
  it('fails when the version has no section or an empty one, without printing the version', () => {
    const missing = notesOf('9.9.9', CHANGELOG)
    const empty = notesOf('3.0.0', '## [3.0.0]\n\n   \n\n## [2.0.0]\n\n- x\n')

    for (const result of [missing, empty]) {
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('The changelog has no non-empty section for this version.\n')
    }
    expect(missing.stderr).not.toContain('9.9.9')
  })

  // Scenario: no version argument. Expected: exit 2 and a usage line. Why: a workflow that passes
  // an empty tag-derived value must fail loudly, not print the whole changelog.
  it('refuses to run without a version', () => {
    const result = notesOf(undefined, CHANGELOG)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage:')
    expect(result.stdout).toBe('')
  })
})
