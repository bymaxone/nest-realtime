/**
 * @fileoverview Test fixture — bearer-header authenticator (Pattern C, WebSocket only).
 * @layer test-fixture
 *
 * Reference: `docs/auth-patterns/bearer-header.md`
 *
 * Parses an `Authorization: Bearer <token>` header and returns a pre-configured auth
 * result when the token matches a known value.  Used in unit tests and integration
 * specs that validate the bearer flow.
 *
 * DO NOT use this pattern for SSE — the SSE handler strips the `authorization` header
 * unconditionally before calling `authenticate`.
 *
 * This file lives in `test/` and is never part of the published package.
 */
import type {
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionAuthenticator,
} from '../../../src/server/interfaces/connection-authenticator.interface'

/**
 * Bearer-header authenticator fixture.
 *
 * Validates the `Authorization: Bearer <token>` header against a fixed set of known
 * tokens supplied at construction time.  Production implementations would verify a
 * signed JWT instead.
 *
 * @see {@link https://github.com/bymaxone/nest-realtime/blob/main/docs/auth-patterns/bearer-header.md}
 */
export class BearerAuthenticator implements IConnectionAuthenticator {
  /**
   * @param knownTokens - A map of raw token strings to the auth result they resolve to.
   *   A token absent from the map causes `authenticate` to return `null`.
   */
  constructor(private readonly knownTokens: Map<string, AuthenticationResult> = new Map()) {}

  /**
   * Register a valid token → auth result pair.
   *
   * @param token - The raw bearer token value (without the `Bearer ` prefix).
   * @param auth - The auth result returned when this token is presented.
   */
  register(token: string, auth: AuthenticationResult): void {
    this.knownTokens.set(token, auth)
  }

  /**
   * Authenticate via the `Authorization: Bearer <token>` header.
   *
   * Returns `null` when the header is absent, does not start with `Bearer `, the token
   * portion is empty, or the token is not in the known-tokens map.
   *
   * Note: for SSE contexts the `authorization` header is stripped by the transport
   * before this method is called; the result will always be `null` for SSE.
   */
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const raw = ctx.headers['authorization']
    const token = this.extractBearer(raw)
    if (!token) return null
    return this.knownTokens.get(token) ?? null
  }

  /**
   * Extract the raw token from an `Authorization: Bearer <token>` header.
   *
   * @returns The token string, or `undefined` when the header is missing, has the wrong
   *   prefix, or has an empty token portion.
   */
  private extractBearer(header: string | undefined): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined
    const token = header.slice(7)
    return token.length > 0 ? token : undefined
  }
}
