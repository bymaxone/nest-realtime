/**
 * @fileoverview Holds what the release workflow packs: the build of the verify step, with no
 * lifecycle script at pack time.
 * @layer tests
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workflow = readFileSync(join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8')
const { scripts } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('release workflow pack', () => {
  // Scenario: the release packs. Expected: no lifecycle script runs between the gates and the tarball.
  it('packs without lifecycle scripts', () => {
    const packs = workflow.split('\n').filter((line) => /^\s*npm pack\b/.test(line))

    expect(packs).toHaveLength(1)
    expect(packs[0]).toContain('npm pack --ignore-scripts --pack-destination')
  })

  // Scenario: what is packed has to have been built. Expected: `verify` builds, from clean, and runs
  // ahead of the pack step.
  it('packs what the verify step built', () => {
    const verify = workflow.indexOf('run: pnpm verify\n')

    expect(verify).toBeGreaterThan(-1)
    expect(workflow.indexOf('- name: Pack once')).toBeGreaterThan(verify)
    expect(scripts['verify']).toContain('pnpm build')
    expect(scripts['build']).toMatch(/^pnpm clean && tsup\b/)
  })
})
