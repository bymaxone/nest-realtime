/**
 * @fileoverview The option names the `cors` package, engine.io and Socket.IO read off the objects the adapter hands them.
 * @layer transport
 *
 * Each of them copies what it is given into a fresh object, which has a prototype, and reads names from the copy: `cors`
 * does `assign({}, defaults, options)` on every request, engine.io does `Object.assign({ ...defaults }, opts)`. A name
 * that holds nothing and that the copy's defaults do not name is then answered by whatever was planted on
 * `Object.prototype`. An own key, even one that holds `undefined`, is copied over and shadows it. A name that the
 * defaults do name is not given one: the own `undefined` would overwrite the default.
 */

/** The names `cors` reads that its defaults do not name, so a planted one would answer them. */
export const CORS_OWN_NAMES = [
  'allowedHeaders',
  'credentials',
  'exposedHeaders',
  'headers',
  'maxAge',
] as const

/** The names engine.io and Socket.IO read off the server options that no default names. */
export const SERVER_OWN_NAMES = [
  'adapter',
  'addTrailingSlash',
  'allowRequest',
  'cleanupEmptyChildNamespaces',
  'connectTimeout',
  'connectionStateRecovery',
  'cookie',
  'destroyUpgrade',
  'destroyUpgradeTimeout',
  'initialPacket',
  'parser',
  'path',
  'perMessageDeflate',
  'serveClient',
] as const

/** The names the `cookie` package reads off the options of a cookie that engine.io's own defaults (name, path, httpOnly, sameSite) do not name. */
export const COOKIE_OWN_NAMES = [
  'domain',
  'encode',
  'expires',
  'maxAge',
  'partitioned',
  'priority',
  'secure',
] as const

/** The names `ws` reads off the options of per-message deflate that engine.io's default (threshold) does not name. */
export const DEFLATE_OWN_NAMES = [
  'clientMaxWindowBits',
  'clientNoContextTakeover',
  'concurrencyLimit',
  'serverMaxWindowBits',
  'serverNoContextTakeover',
  'zlibDeflateOptions',
  'zlibInflateOptions',
] as const

/** The options of a zlib stream and the threshold under which engine.io does not compress, for `httpCompression`. */
export const COMPRESSION_OWN_NAMES = [
  'chunkSize',
  'dictionary',
  'finishFlush',
  'flush',
  'info',
  'level',
  'maxOutputLength',
  'memLevel',
  'params',
  'strategy',
  'threshold',
  'windowBits',
] as const

/** `base` with an own `undefined` for every name in `names` that it does not hold, in an object with no prototype. */
function withOwn(names: readonly string[], base: object): Record<string, unknown> {
  const own: Record<string, unknown> = { __proto__: null }
  for (const name of names) own[name] = undefined
  return Object.assign(own, base)
}

/** An object `value` is copied into with own keys for `names`; `true`, which means the defaults, becomes an empty one. */
function nested(names: readonly string[], value: unknown): unknown {
  if (value === true) return withOwn(names, {})
  return typeof value === 'object' && value !== null ? withOwn(names, value) : value
}

/**
 * The cors block as the `cors` package gets it: an own key for each name it reads that no default names.
 *
 * `cors` takes an object, `true` for its defaults, or a function that answers with either, per request; the function is
 * wrapped so that what it answers is given the keys too.
 *
 * @param cors - The block, as the module copied it or as Nest passed it from a gateway; `false`, `undefined` and the like
 *   are returned as they are.
 */
export function corsWithOwnNames(cors: unknown): unknown {
  if (typeof cors === 'function') {
    return (request: unknown, done: (error: unknown, options?: unknown) => void): void =>
      (cors as (request: unknown, done: (error: unknown, options?: unknown) => void) => void)(
        request,
        (error, options) => done(error, nested(CORS_OWN_NAMES, options)),
      )
  }
  return nested(CORS_OWN_NAMES, cors)
}

/**
 * The server options as engine.io and Socket.IO get them: an own key for each name they read that no default names, and
 * the same for the cookie, per-message deflate and HTTP compression options, which engine.io copies once more.
 *
 * @param options - What the adapter merged: the options Nest passed and the library's own.
 */
export function serverOptionsWithOwnNames(options: object): Record<string, unknown> {
  const merged = withOwn(SERVER_OWN_NAMES, options)
  merged.cookie = nested(COOKIE_OWN_NAMES, merged.cookie)
  merged.perMessageDeflate = nested(DEFLATE_OWN_NAMES, merged.perMessageDeflate)
  // engine.io's own default for this option is a literal with a prototype, so it is stated here with the keys.
  merged.httpCompression =
    merged.httpCompression === undefined
      ? withOwn(COMPRESSION_OWN_NAMES, { threshold: 1024 })
      : nested(COMPRESSION_OWN_NAMES, merged.httpCompression)
  return merged
}
