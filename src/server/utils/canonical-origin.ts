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
const SHAPE =
  /^([a-z][a-z0-9+.-]*):\/\/(\[[0-9a-f:.]+\]|[a-z0-9]+(?:-+[a-z0-9]+)*(?:\.[a-z0-9]+(?:-+[a-z0-9]+)*)*)(?::([1-9][0-9]{0,4}))?$/

/** The longest an origin may be; a browser sends far less, and the bound keeps the match cheap. */
const MAX_LENGTH = 255

/** The port a browser leaves out of the origin of a scheme, for the two schemes that have one. */
const DEFAULT_PORT: Readonly<Record<string, string>> = {
  __proto__: null as never,
  http: '80',
  https: '443',
}

/**
 * Whether `value` is an origin written as a browser sends it: a lowercase scheme, `://`, a lowercase host (a DNS name
 * in ASCII, punycode for an international one, or a bracketed IPv6 address) and, only when it is not the default of
 * `http` (80) or `https` (443), a port from 1 to 65535. Uppercase, a trailing dot, a trailing slash, userinfo, a
 * wildcard, `null` and a port written out when it is the default are all refused.
 *
 * @param value - What the host wrote as an entry.
 * @returns `true` when it is that spelling.
 */
export function isCanonicalOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return false
  const match = SHAPE.exec(value)
  if (match === null) return false
  const scheme = match[1] as string
  const port = match[3]
  if (port === undefined) return true
  return Number(port) <= 65535 && DEFAULT_PORT[scheme] !== port
}
