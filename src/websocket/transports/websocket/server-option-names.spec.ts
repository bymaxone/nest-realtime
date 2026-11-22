/**
 * @fileoverview The names the adapter gives an own key are the names the pinned `cors`, engine.io and Socket.IO read.
 * @layer transport
 *
 * The lists are the library's account of what those packages read off the objects they copy. A version that reads a
 * name the lists do not hold would answer it from `Object.prototype`, so the sources of the installed versions are
 * scanned and the test fails on a name that is in none of the lists.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CORS_OWN_NAMES,
  SERVER_OWN_NAMES,
  corsWithOwnNames,
  serverOptionsWithOwnNames,
} from './server-option-names'

/** The names `cors` reads that its defaults name: the copy has them as its own, so nothing planted can answer. */
const CORS_DEFAULTED_NAMES = [
  'methods',
  'optionsSuccessStatus',
  'origin',
  'preflightContinue',
] as const

/** The names engine.io reads off the server options that its defaults name. */
const SERVER_DEFAULTED_NAMES = [
  'allowEIO3',
  'allowUpgrades',
  'cors',
  'httpCompression',
  'maxHttpBufferSize',
  'pingInterval',
  'pingTimeout',
  'transports',
  'upgradeTimeout',
  'wsEngine',
] as const

/**
 * The names that look like options in the sources of those packages and are not: what a broadcast or a write takes per
 * call, and what only the uWebSockets server reads, which this library never creates.
 */
const NOT_SERVER_OPTION_NAMES: Readonly<Record<string, string>> = {
  compress: 'a per-write flag of a socket, not a server option',
  compression: 'read only by the uWebSockets server',
  except: 'a broadcast operator flag',
  flags: 'a broadcast operator field',
  idleTimeout: 'read only by the uWebSockets server',
  maxBackpressure: 'read only by the uWebSockets server',
  preEncoded: 'a per-packet flag of a client',
  rooms: 'a broadcast operator field',
  volatile: 'a per-packet flag of a client',
}

/** The directory of a package installed next to `neighbour`, as both a flat `node_modules` and pnpm's links lay it out. */
const siblingDir = (name: string, neighbour: string): string =>
  realpathSync(join(dirname(neighbour), name))

const socketIoDir = dirname(require.resolve('socket.io/package.json'))
const engineIoDir = siblingDir('engine.io', socketIoDir)
const corsDir = siblingDir('cors', engineIoDir)

/** The names a package's JavaScript reads off an object called `opts`, `options` or `corsOptions`, comments left out. */
function namesRead(directory: string): Set<string> {
  const names = new Set<string>()
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.js')) continue
    for (const line of readFileSync(join(directory, entry), 'utf8').split('\n')) {
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue
      for (const match of line.matchAll(
        /\b(?:this\.)?(?:_?opts|options|corsOptions)\.([A-Za-z0-9_]+)/g,
      )) {
        names.add(match[1] as string)
      }
    }
  }
  return names
}

describe('the option names the adapter gives an own key', () => {
  // Scenario: every name the installed cors package reads. Expected: it is in the list of names given an own key or in
  // the list of names its defaults hold, so no name is left for a planted key to answer.
  it('hold every name the installed cors package reads', () => {
    const known = new Set<string>([...CORS_OWN_NAMES, ...CORS_DEFAULTED_NAMES])

    expect([...namesRead(join(corsDir, 'lib'))].filter((name) => !known.has(name))).toStrictEqual(
      [],
    )
  })

  // Scenario: every name the installed engine.io and Socket.IO read. Expected: each is in a list, or is one that is not a
  // server option, with the reason.
  it.each([
    ['engine.io', join(engineIoDir, 'build')],
    ['socket.io', join(socketIoDir, 'dist')],
  ])('hold every name the installed %s reads', (_name, directory) => {
    const known = new Set<string>([
      ...SERVER_OWN_NAMES,
      ...SERVER_DEFAULTED_NAMES,
      ...Object.keys(NOT_SERVER_OPTION_NAMES),
    ])

    expect([...namesRead(directory)].filter((name) => !known.has(name))).toStrictEqual([])
  })

  // Scenario: the lists themselves. Expected: no name is both given an own key and named by a default, because an own
  // `undefined` would overwrite the default.
  it('give no own key to a name a default holds', () => {
    expect(
      CORS_OWN_NAMES.filter((name) => (CORS_DEFAULTED_NAMES as readonly string[]).includes(name)),
    ).toStrictEqual([])
    expect(
      SERVER_OWN_NAMES.filter((name) =>
        (SERVER_DEFAULTED_NAMES as readonly string[]).includes(name),
      ),
    ).toStrictEqual([])
  })
})

describe('corsWithOwnNames and serverOptionsWithOwnNames', () => {
  // Scenario: a cors block with some names set. Expected: every name with no default is an own key, holding the block's
  // value or `undefined`, in an object with no prototype.
  it('give each name an own key and keep what the block holds', () => {
    const cors = corsWithOwnNames({ origin: ['https://a.example'], credentials: true }) as Record<
      string,
      unknown
    >

    expect(Object.getPrototypeOf(cors)).toBeNull()
    expect(Object.keys(cors).sort()).toStrictEqual([...CORS_OWN_NAMES, 'origin'].sort())
    expect(cors.credentials).toBe(true)
    expect(cors.origin).toStrictEqual(['https://a.example'])
    expect(cors.maxAge).toBeUndefined()
  })

  // Scenario: a value that is not a block. Expected: returned as it is.
  it.each([[undefined], [null], [false], ['*']])('returns %p as it is', (value) => {
    expect(corsWithOwnNames(value)).toBe(value)
  })

  // Scenario: server options with some names set, and one the lists do not hold. Expected: the same, without losing the
  // one that is not listed.
  it('give the server options an own key for each name and keep the rest', () => {
    const options = serverOptionsWithOwnNames({ path: '/rt', pingInterval: 1, extra: true })

    expect(Object.getPrototypeOf(options)).toBeNull()
    expect(options.path).toBe('/rt')
    expect(options.pingInterval).toBe(1)
    expect(options.extra).toBe(true)
    for (const name of SERVER_OWN_NAMES) expect(Object.hasOwn(options, name)).toBe(true)
  })
})
