/**
 * @fileoverview NestJS WebSocket gateway — handshake auth, lifecycle, and connection:established.
 * @layer transport
 */
import { Inject, Logger } from '@nestjs/common'
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import type { ConnectionAuthContext } from '../../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import { RESERVED_EVENT_NAMES } from '../../constants/reserved-events.constants'
import { parseCookieHeader } from '../../utils/parse-cookie-header'
import { WebSocketTransport } from './websocket.transport'

/** Collapse a possibly multi-valued query parameter to its first string value. */
function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

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
   * Query values follow the Node `ParsedUrlQuery` shape (`string | string[] |
   * undefined`); the single-value `ticket` parameter is collapsed to its first
   * element so the authenticator receives a well-defined string.
   *
   * Fail-closed: any thrown error disconnects the socket immediately so it cannot
   * linger in an unregistered state and receive broadcast events.
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      const { handshake } = socket
      const headers = this.normalizeHeaders(handshake.headers)
      const query: Record<string, string | string[] | undefined> = { ...handshake.query }

      // Merge Socket.IO's dedicated auth field (spec §8.1, bearer + ticket patterns).
      const handshakeAuth = handshake.auth as { token?: string; ticket?: string } | undefined
      if (handshakeAuth?.token) headers['authorization'] = `Bearer ${handshakeAuth.token}`
      if (handshakeAuth?.ticket) query['ticket'] = handshakeAuth.ticket

      // The ticket is a single-value auth parameter; collapse any array form.
      const ticket = firstQueryValue(query['ticket'])
      if (ticket !== undefined) query['ticket'] = ticket

      const ctx: ConnectionAuthContext = {
        cookies: parseCookieHeader(handshake.headers.cookie ?? ''),
        headers,
        query,
        ip: handshake.address,
        userAgent: handshake.headers['user-agent'],
        transport: 'websocket',
      }

      const auth = await this.transport.authenticator().authenticate(ctx)
      if (!auth) {
        socket.disconnect(true)
        return
      }

      await this.transport.registerSocket(socket, auth)

      if (this.options.websocket?.emitConnectionEvent !== false) {
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
