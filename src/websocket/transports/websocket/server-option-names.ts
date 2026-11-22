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

/** `base` with an own `undefined` for every name in `names` that it does not hold, in an object with no prototype. */
function withOwn(names: readonly string[], base: object): Record<string, unknown> {
  const own: Record<string, unknown> = { __proto__: null }
  for (const name of names) own[name] = undefined
  return Object.assign(own, base)
}

/**
 * The cors block as the `cors` package gets it: an own key for each name it reads that no default names.
 *
 * @param cors - The `websocket.cors` block, already copied by the module; anything else is returned as it is.
 */
export function corsWithOwnNames(cors: unknown): unknown {
  return typeof cors === 'object' && cors !== null ? withOwn(CORS_OWN_NAMES, cors) : cors
}

/**
 * The server options as engine.io and Socket.IO get them: an own key for each name they read that no default names.
 *
 * @param options - What the adapter merged: the options Nest passed and the library's own.
 */
export function serverOptionsWithOwnNames(options: object): Record<string, unknown> {
  return withOwn(SERVER_OWN_NAMES, options)
}
