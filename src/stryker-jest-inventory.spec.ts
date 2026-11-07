/**
 * @fileoverview Pins which spec files the Stryker Jest configuration runs.
 * @layer tooling
 */
import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import stryker from '../jest.stryker.config'

const SRC = resolve(__dirname)

/** Every spec file under `src`, as a path relative to it. */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return specFiles(path)
    return /\.spec\.tsx?$/.test(entry.name) ? [relative(SRC, path).split(sep).join('/')] : []
  })
}

// Scenario: a spec file the Stryker configuration's testRegex does not match, such as a `.spec.tsx`
// when only `.spec.ts` is listed. Expected: this comparison fails. Why: an unmatched spec is dropped
// from the mutation run with every other gate green, so the mutants only it kills survive.
describe('the Stryker Jest configuration', () => {
  it('runs every spec file under src, the React ones included', () => {
    const pattern = new RegExp(String(stryker.testRegex))
    const files = specFiles(SRC)

    expect(files.filter((file) => !pattern.test(join(SRC, file)))).toStrictEqual([])
    expect(
      files.filter((file) => file.startsWith('react/') && file.endsWith('.tsx')).length,
    ).toBeGreaterThan(0)
  })
})
