/**
 * @fileoverview Test fixture — cookie-based JWT authenticator (Pattern A).
 * @layer test-fixture
 *
 * Reference: `docs/auth-patterns/cookie-httponly.md`
 *
 * Validates a JWT stored in an HttpOnly cookie using the standalone `jsonwebtoken`
 * package.  Used in unit tests and integration specs that need a concrete
 * `IConnectionAuthenticator` without depending on `@bymax-one/nest-auth` or
 * `@nestjs/jwt`.
 *
 * This file lives in `test/` and is never part of the published package.
 */
import { verify } from 'jsonwebtoken'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionAuthenticator,
} from '../../../src/server/interfaces/connection-authenticator.interface'

/** Shape of the JWT payload expected by the fixture. */
interface JwtPayload {
  sub: string
  tid?: string
  roles?: string[]
  iat?: number
  exp?: number
}

/**
 * Cookie-based JWT authenticator fixture.
 *
 * Reads a JWT from `ctx.cookies[cookieName]`, verifies it with `secret`,
 * and returns `{ userId, tenantId, roles }` on success or `null` on any failure.
 *
 * @see {@link https://github.com/bymaxone/nest-realtime/blob/main/docs/auth-patterns/cookie-httponly.md}
 */
export class CookieJwtAuthenticator implements IConnectionAuthenticator {
  /**
   * @param secret - The HMAC secret (or public key for RS/ES algorithms) used to verify
   *   the JWT.  Must match the key used to sign the token.
   * @param cookieName - The cookie name that carries the access token.
   *   Defaults to `'access_token'`.
   */
  constructor(
    private readonly secret: string,
    readonly cookieName = 'access_token',
  ) {}

  /**
   * Authenticate via an HttpOnly cookie.
   *
   * @returns The parsed auth result, or `null` when the cookie is absent, the token is
   *   malformed, or the signature / expiry validation fails.
   */
  async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    const token = ctx.cookies[this.cookieName]
    if (!token) return null
    try {
      const payload = verify(token, this.secret, { algorithms: ['HS256'] }) as JwtPayload
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles,
      }
    } catch {
      // Expired, malformed, or wrong-key tokens are all treated as unauthenticated.
      return null
    }
  }
}
