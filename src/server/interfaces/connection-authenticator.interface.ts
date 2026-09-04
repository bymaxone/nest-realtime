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
  /**
   * The authenticated account. Must be a non-empty string: a blank one indexes
   * every such connection under a single key and joins them all to the room
   * `user:`, so it is refused at connection bootstrap rather than registered.
   */
  readonly userId: string
  /**
   * The tenant this connection routes on, or absent when it belongs to none.
   *
   * Absent and empty are different. Omitting it — or returning `undefined` or
   * `null` — means no tenant: indexed under none, joining no tenant room. An empty
   * or whitespace-only string is refused, because it is a shared bucket rather than
   * a missing value: every connection carrying `''` lands under the same key.
   */
  readonly tenantId?: string
  readonly roles?: readonly string[]
  /**
   * Free-form extras for downstream code (e.g. feature flags, plan tier, a
   * correlation id read off the handshake headers).
   *
   * Carried verbatim — the library never reads a key. It reaches
   * `ConnectionEventMeta.metadata` in the three hooks that receive that type —
   * `onConnect`, `onDisconnect` and `onReauthenticationFailed` — and is handed
   * back to `revalidate` as part of the original result. `onError` takes a
   * narrower payload and carries no `metadata`.
   */
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
   *
   * Returning a result whose `userId` is blank, or whose `tenantId` is present but
   * blank, is not a second way to reject: it is a contract violation. The connection
   * is refused either way, but it surfaces as a server fault rather than a 401,
   * because the credentials were accepted and the fault is in this method. Return
   * `null` to reject a client.
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
