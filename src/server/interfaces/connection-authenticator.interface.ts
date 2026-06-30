/**
 * @fileoverview The single auth contract the library owns (auth inversion).
 * @layer contracts
 */

/**
 * Transport-agnostic context passed to `IConnectionAuthenticator.authenticate`.
 *
 * Built from the HTTP request (SSE) or the Socket.IO handshake (WebSocket).
 * Cookies are parsed; header names are normalized to lowercase.
 */
export interface ConnectionAuthContext {
  /** Cookies parsed from the request/handshake headers. */
  readonly cookies: Record<string, string>
  /**
   * Selected headers (lowercase keys). `authorization` is always stripped for SSE:
   * an `EventSource` cannot send custom headers, so it is never a valid SSE auth
   * channel (use a cookie or the ticket pattern). It is available for WebSocket.
   */
  readonly headers: Record<string, string | undefined>
  /**
   * Query string parameters — useful for the ticket pattern.
   *
   * Values follow the Node `ParsedUrlQuery` shape: a repeated key (`?a=1&a=2`)
   * arrives as a `string[]`. Authenticators that expect a single value should
   * normalize accordingly; the WebSocket gateway already collapses the `ticket`
   * parameter to a single string before delegating.
   */
  readonly query: Record<string, string | string[] | undefined>
  /**
   * Client IP — best-effort. Derived from `X-Forwarded-For` when present, which is
   * spoofable unless set by a trusted proxy; do not use it for security decisions
   * without validating the proxy chain.
   */
  readonly ip: string
  /** Raw User-Agent. */
  readonly userAgent: string | undefined
  /** Transport kind initiating the connection. */
  readonly transport: 'sse' | 'websocket'
}

/**
 * Authenticated traits returned by a successful `authenticate()` call. Consumers
 * may carry extra fields through the `metadata` bag.
 */
export interface AuthenticationResult {
  readonly userId: string
  readonly tenantId?: string
  readonly roles?: readonly string[]
  /** Free-form extras for downstream code (e.g. feature flags, plan tier). */
  readonly metadata?: Record<string, unknown>
}

/**
 * Connection authenticator contract — the only auth surface the library owns.
 *
 * Implementations bridge the library to whatever auth strategy the consumer uses
 * (cookie JWT, the ticket pattern, a bearer header in WS, etc.). The library
 * NEVER imports a concrete auth library; see `docs/technical_specification.md`
 * §1.6 ("auth inversion").
 *
 * @example
 * ```ts
 * class CookieAuthenticator implements IConnectionAuthenticator {
 *   async authenticate(ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> {
 *     const token = ctx.cookies['access_token']
 *     if (!token) return null
 *     const claims = await verify(token)
 *     return { userId: claims.sub, tenantId: claims.tid, roles: claims.roles }
 *   }
 * }
 * ```
 */
export interface IConnectionAuthenticator {
  /**
   * Authenticate a new connection request.
   *
   * @returns the authenticated result, or `null` to reject the connection (the
   *          transport replies 401 / disconnects accordingly).
   */
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null>

  /**
   * Optionally re-validate during long sessions. Called periodically based on
   * `reauthenticationPolicy.intervalSeconds`.
   *
   * @returns `true` to keep the connection alive, `false` to disconnect.
   */
  revalidate?(connectionId: string, originalAuth: AuthenticationResult): Promise<boolean>
}
