#!/usr/bin/env node
/**
 * Release notes of one version, taken from the changelog (zero external dependencies).
 *
 * The GitHub Release body is the tag's own changelog section, so the notes a reader sees are the
 * ones reviewed in the release pull request. The release workflow runs this before the gates and the
 * publish: a version with no section stops the release before anything reaches the registry, and
 * there is no fallback text.
 *
 * The section is the lines under the heading that opens with `## [<version>]`, up to the next line
 * that opens with `## [`. The version is matched as a literal, so the dots in `1.2.5` match only
 * dots and `1.2.1` does not open the `1.2.14` section, and only the heading's own first bracket
 * counts, so a second bracketed token on another heading cannot open it. The notes go to standard
 * output and the workflow writes them to a file: nothing inside the changelog is evaluated by a
 * shell. An error names what is wrong and never the version, which comes from a tag name.
 *
 * Usage: `node scripts/extract-release-notes.mjs <version> [changelog]`; the changelog defaults to
 * `CHANGELOG.md` in the current directory.
 */
import { readFileSync } from 'node:fs'

const [version, changelog = 'CHANGELOG.md'] = process.argv.slice(2)

if (version === undefined || version === '') {
  console.error('Usage: node scripts/extract-release-notes.mjs <version> [changelog]')
  process.exit(2)
}

const lines = readFileSync(changelog, 'utf8').split('\n')
// The text ends with a line feed, which leaves one empty element after the last line.
if (lines.at(-1) === '') lines.pop()

const opening = `## [${version}]`
const notes = []
let inSection = false
for (const line of lines) {
  if (line.startsWith('## [')) {
    if (inSection) break
    if (line.startsWith(opening)) inSection = true
    continue
  }
  if (inSection) notes.push(line)
}

const text = notes.map((line) => `${line}\n`).join('')
if (!/\S/.test(text)) {
  console.error('The changelog has no non-empty section for this version.')
  process.exit(1)
}
process.stdout.write(text)
