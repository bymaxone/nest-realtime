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
 * the same for the cookie and per-message deflate options, which engine.io copies once more, and for the HTTP compression
 * options, which it hands to zlib as they are.
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

/** The names a Socket.IO server reads off itself that it sets only on some paths, so a planted one would answer the rest. */
export const SERVER_INSTANCE_NAMES = ['_corsMiddleware', '_serveClient', 'httpServer'] as const

/**
 * The names a Socket.IO socket reads off itself for every event that it sets only when a listener is added, so a key
 * planted after the connection was made would answer them for the life of the connection.
 */
export const SOCKET_LAZY_NAMES = ['_anyListeners', '_anyOutgoingListeners'] as const

const hasOwn = Object.prototype.hasOwnProperty
const apply = Reflect.apply

/**
 * Gives `server` an own `undefined` for each of {@link SERVER_INSTANCE_NAMES} it does not hold, which shadows a planted
 * key, and leaves one it holds as it is.
 *
 * @param server - The Socket.IO server, after it is created and attached.
 */
export function shadowServerInstance(server: object): void {
  shadow(server, SERVER_INSTANCE_NAMES)
}

/** Gives `target` an own `undefined` for each of `names` it does not hold. */
function shadow(target: object, names: readonly string[]): void {
  for (const name of names) {
    if (apply(hasOwn, target, [name]) as boolean) continue
    Object.defineProperty(target, name, {
      value: undefined,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }
}

/**
 * The names the decoder of Socket.IO reads off itself, on every packet and again when its connection closes, that it sets
 * only while it reconstructs a binary packet (`reconstructor`) or when a listener is added (`_callbacks`). A key planted
 * under either, read when a connection closes, ends the process with an uncaught error.
 */
export const DECODER_LAZY_NAMES = ['_callbacks', 'reconstructor'] as const

/**
 * Gives a socket an own `undefined` for {@link SOCKET_LAZY_NAMES}, so that a key planted later does not answer them; a
 * listener the host adds sets its own. It is the listener of the `connection` event of a namespace, which Socket.IO
 * emits for every socket before it handles another packet of that socket, a recovered one included: the middleware of a
 * namespace is skipped for a recovered session when `skipMiddlewares` is on.
 *
 * @param socket - The socket that has connected to the namespace.
 */
export function shadowSocket(socket: object): void {
  shadow(socket, SOCKET_LAZY_NAMES)
}

/**
 * Gives the decoder class of the server an own `undefined` for {@link DECODER_LAZY_NAMES} on its prototype, which every
 * decoder the server makes inherits before `Object.prototype`; one that sets the name assigns its own. The server makes a
 * decoder for each client, so this is the only place the library can reach before the first packet.
 *
 * @param server - The Socket.IO server, after it is created.
 */
export function shadowDecoder(server: object): void {
  const parser = (server as { _parser?: { Decoder?: { prototype: object } } })._parser
  if (parser?.Decoder === undefined) return
  const prototype = parser.Decoder.prototype
  for (const name of DECODER_LAZY_NAMES) {
    if (apply(hasOwn, prototype, [name]) as boolean) continue
    Object.defineProperty(prototype, name, {
      value: undefined,
      configurable: true,
      enumerable: false,
      writable: true,
    })
  }
}

/**
 * The names `Object.prototype` holds in every runtime this library supports. A key outside this set was put there by
 * something else, and a package that copies an object, or reads a name off one it made, can read it as its own state: the
 * WebSocket server refuses to run while one is there, rather than list the names the packages read.
 */
export const STANDARD_OBJECT_PROTOTYPE_NAMES = [
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
] as const

const standard = new Set<string>(STANDARD_OBJECT_PROTOTYPE_NAMES)
const ownNames = Object.getOwnPropertyNames

/** How many string keys outside the standard set `Object.prototype` holds now. */
export function plantedKeyCount(): number {
  let count = 0
  for (const name of ownNames(Object.prototype)) {
    if (!standard.has(name)) count += 1
  }
  return count
}

/** The refusal's text: it says how many keys there are and never what they are called or hold. */
export const plantedKeyMessage = (count: number): string =>
  `${count} key${count === 1 ? '' : 's'} outside the standard set found on Object.prototype: the WebSocket server does not run while ${count === 1 ? 'it is' : 'they are'} there`
