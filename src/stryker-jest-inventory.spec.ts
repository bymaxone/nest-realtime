/**
 * @fileoverview Pins which spec files the Stryker Jest configuration runs.
 * @layer tooling
 */
import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Config } from 'jest'
import stryker from '../jest.stryker.config'

const SRC = resolve(__dirname)

/** Every spec file under `src`, as an absolute path. */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return specFiles(path)
    return /\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// Scenario: a spec file that no Stryker project's testRegex matches, or that two match. Expected:
// this comparison fails. Why: an unmatched spec is dropped from the mutation run with every other
// gate green, so mutants only it kills survive, and a spec matched twice runs in both environments.
describe('the Stryker Jest configuration', () => {
  const projects = (stryker.projects ?? []) as Config[]
  const owners = (file: string): string[] =>
    projects
      .filter((project) => new RegExp(String(project.testRegex)).test(file))
      .map((project) => String(project.displayName))

  it('runs every spec file under src in exactly one project, and react specs in jsdom', () => {
    const owned = Object.fromEntries(
      specFiles(SRC).map((file) => [relative(SRC, file).split(sep).join('/'), owners(file)]),
    )

    const unowned = Object.entries(owned).filter(([, names]) => names.length !== 1)
    expect(unowned).toStrictEqual([])
    const react = Object.entries(owned).filter(([file]) => file.startsWith('react/'))
    expect(react.length).toBeGreaterThan(0)
    expect(react.filter(([, names]) => names[0] !== 'react')).toStrictEqual([])
    const server = Object.entries(owned).filter(([file]) => !file.startsWith('react/'))
    expect(server.filter(([, names]) => names[0] !== 'server')).toStrictEqual([])
  })
})
