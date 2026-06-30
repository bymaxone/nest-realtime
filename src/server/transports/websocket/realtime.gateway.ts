/**
 * @fileoverview NestJS WebSocket gateway — handshake auth, lifecycle, and connection:established.
 * @layer transport
 */
import { Inject, Logger } from '@nestjs/common'
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import { parseCookieHeader } from '../../utils/parse-cookie-header'
import { WebSocketTransport } from './websocket.transport'

/**
 * NestJS WebSocket gateway wiring the Socket.IO lifecycle to `WebSocketTransport`.
 *
 * Authentication flows exclusively through the consumer-provided
 * `IConnectionAuthenticator` (auth inversion — spec §1.6). The gateway never
 * imports a concrete auth library; it only shapes the `ConnectionAuthContext`
 * from the Socket.IO handshake and delegates to the authenticator.
 *
 * Namespace, CORS, ping options, and the Redis adapter are applied by
 * `RealtimeIoAdapter` (not here), because `@WebSocketGateway()` args are
 * evaluated at class-decoration time — before the module options are resolved.
 *
 * CORS is intentionally disabled in the decorator (`origin: false`). The real
 * policy is applied by `RealtimeIoAdapter.createIOServer` from the consumer's
 * `websocket.cors` option. Leaving it open-by-default here would allow any
 * origin to make credentialed connections before the adapter overrides the policy.
 */
@WebSocketGateway({
  cors: { origin: false },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name)

  @WebSocketServer()
  server!: Server

  constructor(
    @Inject(WebSocketTransport) private readonly transport: WebSocketTransport,
    @Inject(REALTIME_OPTIONS_TOKEN) private readonly options: BymaxRealtimeModuleOptions,
  ) {}

  /** Wire the resolved Socket.IO server to the transport after gateway init. */
  afterInit(server: Server): void {
    this.transport.setServer(server)
    this.logger.log('RealtimeGateway initialized')
  }

  /**
   * Handle a new WebSocket connection.
   *
   * Builds a `ConnectionAuthContext` from the Socket.IO handshake, merging the
   * three supported auth patterns (spec §8.1):
   *   - Cookie HttpOnly — extracted via `parseCookieHeader`.
   *   - Ticket — available in `ctx.query.ticket` or via `auth.ticket`.
   *   - Bearer header — available in `headers.authorization` or via `auth.token`.
   *
   * `socket.handshake.auth.token` and `.ticket` are the Socket.IO-idiomatic paths
   * (set via `io(url, { auth: { token } })`); the gateway normalizes them into the
   * context so the authenticator sees a single unified shape regardless of client.
   *
   * Fail-closed: any thrown error disconnects the socket immediately so it cannot
   * linger in an unregistered state and receive broadcast events.
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      const ctx = {
        cookies: parseCookieHeader(socket.handshake.headers.cookie ?? ''),
        headers: this.normalizeHeaders(socket.handshake.headers),
        query: socket.handshake.query as Record<string, string | undefined>,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        transport: 'websocket' as const,
      }

      // Merge Socket.IO's dedicated auth field (spec §8.1, bearer + ticket patterns).
      const handshakeAuth = socket.handshake.auth as { token?: string; ticket?: string } | undefined
      if (handshakeAuth?.token) {
        ctx.headers['authorization'] = `Bearer ${handshakeAuth.token}`
      }
      if (handshakeAuth?.ticket) {
        ctx.query = { ...ctx.query, ticket: handshakeAuth.ticket }
      }

      const auth = await this.transport.authenticator().authenticate(ctx)
      if (!auth) {
        socket.disconnect(true)
        return
      }

      await this.transport.registerSocket(socket, auth)

      if (this.options.sse?.emitConnectionEvent !== false) {
        socket.emit(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED, {
          connectionId: socket.id,
          traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
        })
      }
    } catch (err) {
      this.logger.error(
        `handleConnection threw for socket ${socket.id} — disconnecting: ${(err as Error).message}`,
      )
      socket.disconnect(true)
    }
  }

  /** Handle a WebSocket disconnection — unregister the connection. */
  async handleDisconnect(socket: Socket): Promise<void> {
    await this.transport.unregisterSocket(socket.id, 'CLIENT_DISCONNECT')
  }

  /**
   * Normalize raw Socket.IO handshake headers into a plain lowercase-keyed map.
   *
   * Array header values (e.g. `Set-Cookie`) are joined with `,` to produce a
   * single string, matching the shape expected by `ConnectionAuthContext.headers`.
   */
  private normalizeHeaders(
    input: Record<string, string | string[] | undefined>,
  ): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(input)) {
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
    }
    return out
  }
}
