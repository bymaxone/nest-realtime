/**
 * @fileoverview The client address of an HTTP request, validated, for the SSE connection context.
 * @layer utils
 */
import { isIP } from 'node:net'

/** What `isIP` returns for an IPv6 literal. */
const IPV6 = 6

/**
 * The parts of a request the resolution reads, all optional: an Express or Fastify request carries
 * them, and a request from an application that has not set `trust proxy` has an empty `ips`.
 */
export interface ClientAddressSource {
  readonly ip?: string | undefined
  readonly ips?: readonly string[] | undefined
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined
}

/**
 * Whether a header-derived entry is an address. A zone index (`fe80::1%eth0`) disqualifies it even
 * though `isIP` accepts one of any length: a zone names an interface on the machine that wrote it,
 * so it has no meaning across hops.
 */
function isHeaderAddress(candidate: string | undefined): candidate is string {
  return typeof candidate === 'string' && !candidate.includes('%') && isIP(candidate) !== 0
}

/**
 * The socket peer as an address, or `''`. The peer is the one place a zone is legitimate, since a
 * link-local peer is reported as `fe80::1%eth0`; it is cut because it is scope, not identity.
 */
function peerAddress(remoteAddress: string | undefined): string {
  if (typeof remoteAddress !== 'string') return ''
  const zoneIndex = remoteAddress.indexOf('%')
  const bare = zoneIndex === -1 ? remoteAddress : remoteAddress.slice(0, zoneIndex)
  const family = isIP(bare)
  // Only an IPv6 literal carries a zone; a `%` after anything else is not an address.
  if (zoneIndex !== -1) return family === IPV6 ? bare : ''
  return family === 0 ? '' : bare
}

/**
 * Resolves the client address of a request, or `''` when there is none.
 *
 * `X-Forwarded-For` is written by the client, so it is never read here: the application's
 * `trust proxy` setting decides how far it is believed, and Express reports the outcome as `req.ip`
 * and `req.ips` (from the first untrusted entry toward the socket). The first of those that is an
 * address wins, then the socket peer, so a non-address entry resolves to the nearest trusted hop.
 * The result is at most 45 characters: header entries carry no zone and the peer's is cut.
 */
export function resolveClientAddress(request: ClientAddressSource): string {
  // Stryker disable next-line ArrayDeclaration: a substituted default is not an address, so it is skipped and the result is unchanged
  const hops = request.ips ?? []
  for (const candidate of [request.ip, ...hops]) {
    if (isHeaderAddress(candidate)) return candidate
  }
  return peerAddress(request.socket?.remoteAddress)
}
