/**
 * @fileoverview Parser turning a raw HTTP `Cookie` header into a plain object.
 * @layer utils
 */

/**
 * Parse an HTTP `Cookie` header into a plain object.
 *
 * Returns an empty object for empty/missing input and ignores malformed pairs
 * (no `=`, or an empty name). Values are NOT URL-decoded — that is the consumer's
 * responsibility, since tokens in HttpOnly cookies set by server frameworks are
 * typically not URL-encoded.
 *
 * @example
 * ```ts
 * parseCookieHeader('access_token=eyJ...; theme=dark')
 * // → { access_token: 'eyJ...', theme: 'dark' }
 * ```
 */
export function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (name) out[name] = value
  }
  return out
}
