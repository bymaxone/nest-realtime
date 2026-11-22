/**
 * @fileoverview The names the adapter gives an own key are the names the pinned `cors`, engine.io and Socket.IO read.
 * @layer transport
 *
 * The lists are the library's account of what those packages read off the objects they copy. A version that reads a
 * name the lists do not hold would answer it from `Object.prototype`, so the sources of the installed versions are
 * scanned and the test fails on a name that is in none of the lists.
 *
 * The scan follows property access (also optional and bracket access), the `in` check, destructuring and a local alias of
 * the options object, in every file of the package that is not a test. The objects engine.io copies once more, the
 * cookie and per-message deflate options, are scanned in `cookie` and `ws`. Not scanned, and stated as limits: the zlib
 * options, which Node reads in its own sources and which are listed here from its documentation, and the objects a host
 * nests inside those (`zlibDeflateOptions`, `zlibInflateOptions`), which are the host's own.
 */
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  COMPRESSION_OWN_NAMES,
  COOKIE_OWN_NAMES,
  CORS_OWN_NAMES,
  DEFLATE_OWN_NAMES,
  SERVER_OWN_NAMES,
  STANDARD_OBJECT_PROTOTYPE_NAMES,
  corsWithOwnNames,
  plantedKeyCount,
  plantedKeyMessage,
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
  strict: "an option of the v3 parser's utf8 encoder, which the parser gives itself",
  wsPreEncoded: 'a per-packet field engine.io sets for the ws transport',
  wsPreEncodedFrame: 'a per-packet field engine.io sets for the ws transport',
}

/** The names the `cookie` package reads that engine.io's cookie defaults name, and the one it reads only to parse. */
const COOKIE_DEFAULTED_NAMES = ['httpOnly', 'path', 'sameSite'] as const

/** What `cookie` reads of its options that is not read from the object engine.io hands it to write a cookie. */
const COOKIE_NOT_WRITTEN_NAMES: Readonly<Record<string, string>> = {
  decode: 'read only when a cookie is parsed, which engine.io does without options',
}

/** The names `ws` reads of per-message deflate that engine.io's default or `ws` itself sets. */
const DEFLATE_SET_NAMES = ['isServer', 'maxPayload', 'threshold'] as const

/** The directory of a package installed next to `neighbour`, as both a flat `node_modules` and pnpm's links lay it out. */
const siblingDir = (name: string, neighbour: string): string =>
  realpathSync(join(dirname(neighbour), name))

const socketIoDir = dirname(require.resolve('socket.io/package.json'))
const engineIoDir = siblingDir('engine.io', socketIoDir)
const corsDir = join(siblingDir('cors', engineIoDir), 'lib')
const cookieDir = siblingDir('cookie', engineIoDir)
const wsDeflateDir = join(siblingDir('ws', engineIoDir), 'lib')

/** Every `.js` file under `directory` (only the one named `only`, when given), with its comments taken out. */
function sources(directory: string, only?: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path, only)
    if (!entry.name.endsWith('.js') || (only !== undefined && entry.name !== only)) return []
    return [
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    ]
  })
}

/** The names read off any of `carriers`, or off a local alias of one: property and bracket access, `in`, destructuring. */
function namesRead(directory: string, carriers: readonly string[], only?: string): Set<string> {
  const names = new Set<string>()
  for (const text of sources(directory, only)) {
    const ids = new Set<string>(carriers)
    const alias = new RegExp(
      `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:this\\.)?(?:${carriers.join('|')})\\s*(?:;|,|\\n)`,
      'g',
    )
    for (const match of text.matchAll(alias)) ids.add(match[1] as string)
    for (const id of ids) {
      const carrier = `(?:this\\.)?${id}`
      const patterns = [
        new RegExp(`\\b${carrier}\\??\\.([A-Za-z0-9_]+)`, 'g'),
        new RegExp(`\\b${carrier}\\??\\.?\\[\\s*['"]([A-Za-z0-9_]+)['"]\\s*\\]`, 'g'),
        new RegExp(`['"]([A-Za-z0-9_]+)['"]\\s+in\\s+${carrier}\\b`, 'g'),
      ]
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) names.add(match[1] as string)
      }
      const destructuring = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${carrier}\\b`, 'g')
      for (const match of text.matchAll(destructuring)) {
        for (const part of (match[1] as string).split(',')) {
          const name = part.trim().split(/[:=\s]/)[0]
          if (name && !name.startsWith('...')) names.add(name)
        }
      }
    }
  }
  return names
}

/** What `known` does not hold of `read`. */
const missing = (read: Set<string>, known: readonly string[]): string[] =>
  [...read].filter((name) => !known.includes(name))

describe('the option names the adapter gives an own key', () => {
  // Scenario: every name the installed cors package reads. Expected: it is in the list of names given an own key or in
  // the list of names its defaults hold, so no name is left for a planted key to answer.
  it('hold every name the installed cors package reads', () => {
    const known = [...CORS_OWN_NAMES, ...CORS_DEFAULTED_NAMES]

    expect(missing(namesRead(corsDir, ['options', 'corsOptions']), known)).toStrictEqual([])
  })

  // Scenario: every name the installed engine.io and Socket.IO read. Expected: each is in a list, or is one that is not a
  // server option, with the reason.
  it.each([
    ['engine.io', join(engineIoDir, 'build')],
    ['socket.io', join(socketIoDir, 'dist')],
  ])('hold every name the installed %s reads', (_name, directory) => {
    const known = [
      ...SERVER_OWN_NAMES,
      ...SERVER_DEFAULTED_NAMES,
      ...Object.keys(NOT_SERVER_OPTION_NAMES),
    ]

    expect(missing(namesRead(directory, ['opts', '_opts', 'options']), known)).toStrictEqual([])
  })

  // Scenario: the cookie options engine.io copies once more and hands the `cookie` package, and the per-message deflate
  // options it hands `ws`. Expected: every name those read is in a list.
  it('hold every name the installed cookie package reads', () => {
    const known = [
      ...COOKIE_OWN_NAMES,
      ...COOKIE_DEFAULTED_NAMES,
      ...Object.keys(COOKIE_NOT_WRITTEN_NAMES),
    ]

    expect(missing(namesRead(cookieDir, ['opt', 'options']), known)).toStrictEqual([])
  })

  it('hold every name the installed ws reads of per-message deflate', () => {
    const known = [...DEFLATE_OWN_NAMES, ...DEFLATE_SET_NAMES]

    expect(
      missing(namesRead(wsDeflateDir, ['options', '_options'], 'permessage-deflate.js'), known),
    ).toStrictEqual([])
  })

  // Scenario: the default engine.io gives `httpCompression`, which the adapter states itself so that it has the keys.
  // Expected: the installed version's default is the one the adapter states, a threshold of 1024.
  it('state the default of httpCompression the installed engine.io has', () => {
    const server = readFileSync(join(engineIoDir, 'build', 'server.js'), 'utf8')

    expect(server).toMatch(/httpCompression:\s*\{\s*threshold:\s*1024,?\s*\}/)
  })

  // Scenario: the lists themselves. Expected: no name is both given an own key and named by a default, because an own
  // `undefined` would overwrite the default.
  it('give no own key to a name a default holds', () => {
    const pairs: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
      [CORS_OWN_NAMES, CORS_DEFAULTED_NAMES],
      [SERVER_OWN_NAMES, SERVER_DEFAULTED_NAMES],
      [COOKIE_OWN_NAMES, COOKIE_DEFAULTED_NAMES],
      [DEFLATE_OWN_NAMES, DEFLATE_SET_NAMES.filter((name) => name === 'threshold')],
    ]

    for (const [own, defaulted] of pairs) {
      expect(own.filter((name) => defaulted.includes(name))).toStrictEqual([])
    }
  })

  // Scenario: the scan itself, on text it should read names from. Expected: property and optional access, bracket
  // access, `in`, destructuring and an alias are all seen, so a version that reads a name in one of those forms is caught.
  it('sees a name read in each of the forms', () => {
    const directory = mkdtempSync(join(tmpdir(), 'names-'))
    writeFileSync(
      join(directory, 'a.js'),
      [
        'const alias = this.opts',
        'a(opts.plain, opts?.optional, opts["bracket"], "membership" in opts)',
        'const { destructured, renamed: other, ...rest } = opts',
        'b(alias.viaAlias)',
        '// opts.inComment',
      ].join('\n'),
    )

    expect([...namesRead(directory, ['opts'])].sort()).toStrictEqual(
      ['bracket', 'destructured', 'membership', 'optional', 'plain', 'renamed', 'viaAlias'].sort(),
    )
  })
})

describe('the keys the WebSocket server accepts on Object.prototype', () => {
  /** This realm's root prototype, and the one Node's own classes end in, which differ under a test runner. */
  const roots: object[] = [
    ...new Set<object>([Object.prototype, Object.getPrototypeOf(EventEmitter.prototype) as object]),
  ]

  // Scenario: the runtime this suite runs in. Expected: every name `Object.prototype` holds is in the standard set, so a
  // clean process is never refused; a new runtime that adds a name fails here, and the set is extended on purpose.
  it('hold exactly the names this runtime puts on Object.prototype, in every root', () => {
    for (const root of roots) {
      const extra = Object.getOwnPropertyNames(root).filter(
        (name) => !(STANDARD_OBJECT_PROTOTYPE_NAMES as readonly string[]).includes(name),
      )
      expect(extra).toStrictEqual([])
    }
  })

  // Scenario: nothing planted, then keys planted one at a time. Expected: none counts, then each key counts once, a
  // standard name that is overwritten does not count, and a key taken away stops counting.
  it('count the keys outside the standard set', () => {
    const root = Object.prototype as unknown as Record<string, unknown>
    const before = Object.getOwnPropertyDescriptor(Object.prototype, 'toString')

    expect(plantedKeyCount()).toBe(0)
    Object.defineProperty(Object.prototype, 'zzOne', { value: 1, configurable: true })
    Object.defineProperty(Object.prototype, 'zzTwo', { value: 2, configurable: true })
    Object.defineProperty(Object.prototype, 'toString', {
      value: 3,
      configurable: true,
      writable: true,
    })
    try {
      expect(plantedKeyCount()).toBe(2)
    } finally {
      delete root.zzOne
      delete root.zzTwo
      Object.defineProperty(Object.prototype, 'toString', before as PropertyDescriptor)
    }
    expect(plantedKeyCount()).toBe(0)
  })

  // Scenario: the refusal's text. Expected: it says how many, in the singular and the plural, and nothing else.
  it.each([
    [
      1,
      '1 key outside the standard set found on Object.prototype: the WebSocket server does not run while it is there',
    ],
    [
      3,
      '3 keys outside the standard set found on Object.prototype: the WebSocket server does not run while they are there',
    ],
  ])('say %p planted keys without naming them', (count, text) => {
    expect(plantedKeyMessage(count)).toBe(text)
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

  // Scenario: `true`, which `cors` reads as its defaults. Expected: a block with the keys and nothing else.
  it('turns true into a block with only the keys', () => {
    const cors = corsWithOwnNames(true) as Record<string, unknown>

    expect(Object.getPrototypeOf(cors)).toBeNull()
    expect(Object.keys(cors).sort()).toStrictEqual([...CORS_OWN_NAMES].sort())
  })

  // Scenario: a value that is not a block. Expected: returned as it is.
  it.each([[undefined], [null], [false], ['*']])('returns %p as it is', (value) => {
    expect(corsWithOwnNames(value)).toBe(value)
  })

  // Scenario: a function that answers per request. Expected: what it answers is given the keys, an error and a
  // non-object answer pass through, and the function is given the request it was asked.
  it('wraps a function so that what it answers has the keys', () => {
    const asked: unknown[] = []
    const delegate = (
      request: unknown,
      done: (error: unknown, options?: unknown) => void,
    ): void => {
      asked.push(request)
      done(null, { origin: ['https://a.example'] })
    }
    const answers: unknown[][] = []

    ;(corsWithOwnNames(delegate) as (request: unknown, done: (...args: unknown[]) => void) => void)(
      'request',
      (...args) => answers.push(args),
    )
    ;(
      corsWithOwnNames((_request: unknown, done: (error: unknown, options?: unknown) => void) =>
        done(new Error('refused'), false),
      ) as (request: unknown, done: (...args: unknown[]) => void) => void
    )('request', (...args) => answers.push(args))

    expect(asked).toStrictEqual(['request'])
    const [first, second] = answers as [unknown[], unknown[]]
    expect(first[0]).toBeNull()
    expect(Object.keys(first[1] as object).sort()).toStrictEqual(
      [...CORS_OWN_NAMES, 'origin'].sort(),
    )
    expect((second[0] as Error).message).toBe('refused')
    expect(second[1]).toBe(false)
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

  // Scenario: the cookie, per-message deflate and compression options, set to an object, to `true`, to `false` and not
  // set. Expected: an object or `true` becomes an object with the keys, `false` stays, and compression that was not set
  // is engine.io's own default stated with the keys.
  it.each([
    ['cookie', COOKIE_OWN_NAMES],
    ['perMessageDeflate', DEFLATE_OWN_NAMES],
    ['httpCompression', COMPRESSION_OWN_NAMES],
  ])('give the %s option the keys of the package that reads it', (key, names) => {
    const own = (value: unknown): Record<string, unknown> =>
      serverOptionsWithOwnNames({ [key]: value })[key] as Record<string, unknown>

    expect(Object.keys(own({ marker: 1 })).sort()).toStrictEqual([...names, 'marker'].sort())
    expect(Object.getPrototypeOf(own(true))).toBeNull()
    for (const name of names) expect(Object.hasOwn(own(true), name)).toBe(true)
    expect(serverOptionsWithOwnNames({ [key]: false })[key]).toBe(false)
  })

  it('states the default compression, with the keys, when none is set', () => {
    const compression = serverOptionsWithOwnNames({}).httpCompression as Record<string, unknown>

    expect(compression.threshold).toBe(1024)
    expect(Object.getPrototypeOf(compression)).toBeNull()
    for (const name of COMPRESSION_OWN_NAMES) expect(Object.hasOwn(compression, name)).toBe(true)
  })

  it.each(['cookie', 'perMessageDeflate'])('leaves %s unset as it is', (key) => {
    expect(serverOptionsWithOwnNames({})[key]).toBeUndefined()
  })
})
