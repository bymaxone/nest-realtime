/**
 * @fileoverview The one spelling an entry of `websocket.allowedOrigins` may have, which is the spelling a browser sends.
 * @layer utils
 *
 * The list is compared with the `Origin` header byte for byte, so an entry that a browser would never send can never
 * match, and one a browser would send in another spelling would match nothing and look like it did. Both are refused at
 * boot instead of being corrected: what the host wrote is what is compared. `URL.origin` is not the definition, because
 * it is the string `null` for every scheme it does not know, `capacitor://localhost` and `ionic://localhost` included.
 */

/** Scheme `://` host and an optional port, with nothing after the port: no userinfo, path, query or fragment. */
const SHAPE = /^([a-z][a-z0-9+.-]*):\/\/(\[[0-9a-f:.]+\]|[A-Za-z0-9._-]+)(?::([1-9][0-9]{0,4}))?$/

/** The host name a browser sends for `http` and `https`: lowercase ASCII labels, with no empty one. */
const WEB_NAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/

/** The schemes no `Origin` header carries: a page's origin is `http`, `https` or one of an application's own. */
const NEVER_AN_ORIGIN: Readonly<Record<string, true>> = {
  __proto__: null as never,
  ws: true,
  wss: true,
  ftp: true,
}

/** The longest an origin may be; a browser sends far less, and the bound keeps the match cheap. */
const MAX_LENGTH = 255

/** The port a browser leaves out of the origin of a scheme, for the two schemes that have one. */
const DEFAULT_PORT: Readonly<Record<string, string>> = {
  __proto__: null as never,
  http: '80',
  https: '443',
}

/** The host as a browser serializes it: an IPv4 address in four plain decimal parts, an IPv6 address compressed. */
function isCanonicalHost(host: string): boolean {
  try {
    return new URL(`http://${host}`).host === host
  } catch {
    return false
  }
}

/**
 * Whether the host is spelled as the scheme allows. `http` and `https` take a lowercase name or a canonical address;
 * any other scheme keeps its host as the application wrote it, since a browser does not rewrite it.
 */
function isHostOf(scheme: string, host: string): boolean {
  if (DEFAULT_PORT[scheme] === undefined) {
    return NEVER_AN_ORIGIN[scheme] === undefined && !host.startsWith('[')
  }
  return (host.startsWith('[') || WEB_NAME.test(host)) && isCanonicalHost(host)
}

/**
 * Whether `value` is an origin written as a browser sends it: a lowercase scheme, `://`, a host and, only when it is
 * not the default of `http` (80) or `https` (443), a port from 1 to 65535. For `http` and `https` the host is a
 * lowercase ASCII name, punycode for an international one, or a canonical address; for any other scheme it is
 * `[A-Za-z0-9._-]+` as written. `ws`, `wss`, `ftp`, a trailing slash, userinfo, a wildcard, `null` and a port written
 * out when it is the default are refused, as is a trailing dot on an `http` or `https` name: a browser that opened the
 * page with the dot sends it, and that page is not admitted.
 *
 * @param value - What the host wrote as an entry.
 * @returns `true` when it is that spelling.
 */
export function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return false
  const match = SHAPE.exec(value)
  if (match === null) return false
  const scheme = match[1] as string
  if (!isHostOf(scheme, match[2] as string)) return false
  const port = match[3]
  if (port === undefined) return true
  return Number(port) <= 65535 && DEFAULT_PORT[scheme] !== port
}
