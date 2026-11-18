/**
 * @fileoverview The README names every export of every public subpath, so a name consumers can import is never undocumented.
 * @layer docs
 *
 * The names come from the checked-in public-surface snapshot, which `pnpm check:surface` keeps equal to the built
 * declarations; `./internal` is not public API and is left out. A name added to a subpath without a line in the
 * README fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const surface = JSON.parse(
  readFileSync(join(ROOT, 'test/types/public-surface.json'), 'utf8'),
) as Record<string, string[]>

/** The contract members the README must name, because an implementor of the contract writes them. */
const CONTRACT_MEMBERS = [
  'extraProviders',
  'onModuleInit',
  'onApplicationShutdown',
  'append',
  'acknowledge',
  'setOnline',
  'setOffline',
  'listOnlineByTenant',
  'countOnline',
  'isSubscribed',
]

const mentions = (name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(readme)

describe('the README documents what the package exports', () => {
  const subpaths = Object.entries(surface).filter(([subpath]) => subpath !== './internal')

  it.each(subpaths.flatMap(([subpath, names]) => names.map((name) => [subpath, name] as const)))(
    '%s exports %s, which the README names',
    (_subpath, name) => {
      expect(mentions(name)).toBe(true)
    },
  )

  it.each(CONTRACT_MEMBERS)('the README names the contract member %s', (member) => {
    expect(mentions(member)).toBe(true)
  })
})
