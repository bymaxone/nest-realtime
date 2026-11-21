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
  'createRealtimeOptions',
  'userAgent',
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

const mentionsIn = (text: string, name: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text)

const mentions = (name: string): boolean => mentionsIn(readme, name)

/** The README line that starts with `prefix`, or an empty string when none does. */
const lineStartingWith = (prefix: string): string =>
  readme.split('\n').find((line) => line.startsWith(prefix)) ?? ''

/** The paragraph that lists the `./internal` names and says they are not API. */
const internalParagraph = lineStartingWith('These names from `./internal`, none of them API')

const publicNames = new Set(
  Object.entries(surface)
    .filter(([subpath]) => subpath !== './internal')
    .flatMap(([, names]) => names),
)

/** The names `src/internal/index.ts` exports explicitly that no public subpath exports: not API, but named so a reader of the declarations finds them. */
const internalNames = [
  ...readFileSync(join(ROOT, 'src/internal/index.ts'), 'utf8').matchAll(
    /export (?:type )?\{([^}]*)\}/g,
  ),
].flatMap((match) =>
  match[1]!
    .split(',')
    .map((name) => name.trim().split(' as ').pop()!.trim())
    .filter(Boolean)
    .filter((name) => !publicNames.has(name)),
)

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

  it.each(internalNames)(
    './internal exports %s, which the paragraph that says none of them is API lists',
    (name) => {
      expect(internalParagraph).not.toBe('')
      expect(mentionsIn(internalParagraph, name)).toBe(true)
    },
  )

  it('describes `kind` on the ITransport line', () => {
    expect(mentionsIn(lineStartingWith('- `ITransport`:'), 'kind')).toBe(true)
  })

  // The resolver is given a plain copy of the authentication result, with no tenantId key when the tenant is absent or
  // null, so the three places that describe `tenantResolver` have to say so.
  it.each([
    ['the options table row', '| **tenantResolver**'],
    ['the paragraph that says it cannot clear a tenant', '`tenantResolver` cannot clear a tenant.'],
  ])('says in %s that the resolver receives a plain copy', (_name, prefix) => {
    const line = lineStartingWith(prefix)
    expect(line).not.toBe('')
    expect(line).toContain('plain copy')
  })

  // The tenant is read with a plain property read, so one an accessor on the prototype supplies counts; the paragraph
  // says so rather than claiming own enumerable properties only for the whole copy.
  it('says that a tenantId from an accessor on the prototype counts', () => {
    expect(lineStartingWith('`tenantResolver` cannot clear a tenant.')).toContain('prototype')
  })
})
