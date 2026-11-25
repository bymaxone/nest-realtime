/**
 * @fileoverview NestJS WebSocket gateway — handshake auth, lifecycle, and connection:established.
 * @layer transport
 */
import { Inject, Logger, Optional } from '@nestjs/common'
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import {
  AuthenticationUnavailableError,
  ConnectionLimitError,
  RealtimeMetricsTally,
  RealtimeTracing,
  logEvent,
  REALTIME_ERROR_CODES,
  REALTIME_OPTIONS_TOKEN,
  RESERVED_EVENT_NAMES,
  parseCookieHeader,
  admitRooms,
  assertIdentityIsNotBlank,
  resolveAuthTenant,
  returnable,
  shielded,
} from '@bymax-one/nest-realtime/internal'
import type {
  AdmissionTicket,
  AuthenticationResult,
  ConnectionAuthContext,
  BymaxRealtimeModuleOptions,
} from '@bymax-one/nest-realtime/internal'
import { ConnectHookFailure } from './connect-hook-failure'
import { isRealtimeIoServer } from './realtime-io-adapter'
import { socketNamespace } from './socket-namespace'
import { WebSocketTransport } from './websocket.transport'

/** The root server a namespace belongs to; a root server has no `server` and is its own root. */
function rootOf(server: Server): unknown {
  return (server as { server?: unknown }).server ?? server
}

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
 * `@WebSocketGateway()` args are evaluated when the class is decorated, before the
 * module options are resolved, so none of those options is read here: the module
 * registers a subclass that declares `websocket.namespace`, and `RealtimeIoAdapter`
 * applies CORS, the ping options, the message size limit and the Redis adapter.
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
    // Optional so the gateway can be unit-constructed in isolation; the module always provides it.
    @Optional()
    @Inject(RealtimeMetricsTally)
    private readonly tally?: RealtimeMetricsTally,
    // Optional so the gateway can be unit-constructed in isolation; the module always provides it.
    @Optional()
    @Inject(RealtimeTracing)
    private readonly tracing?: RealtimeTracing,
  ) {}

  /** Identities the handshake middleware resolved, until `handleConnection` takes them. */
  private readonly authenticated = new WeakMap<Socket, AuthenticationResult>()

  /** The place held for a socket from before its handshake is authenticated until it is registered. */
  private readonly tickets = new WeakMap<Socket, AdmissionTicket>()

  /**
   * Authenticate before accept, inside the `realtime.handshake` span when tracing is wired.
   *
   * The refusal the handshake produces is held until the span has ended, so that the span carries it, and is
   * then handed to `next`.
   */
  private readonly authenticateHandshake = async (
    socket: Socket,
    next: (err?: Error) => void,
  ): Promise<void> => {
    let outcome: Error | undefined
    const run = async (): Promise<void> => {
      await shielded(
        this.handshake(socket, (err) => {
          outcome = err
        }),
      )
      if (outcome) throw outcome
    }
    try {
      await (this.tracing
        ? this.tracing.span('realtime.handshake', { 'bymax.realtime.transport': 'websocket' }, run)
        : run())
    } catch {
      // The refusal is `outcome`, already recorded on the span.
    }
    if (outcome) next(outcome)
    else next()
  }

  /** Authenticate before accept: a refusal is a `connect_error` with `data.code`; a failure is generic. */
  private async handshake(socket: Socket, next: (err?: Error) => void): Promise<void> {
    let ticket: AdmissionTicket | undefined
    let handedOver = false
    try {
      if (this.transport.shuttingDown) {
        this.tally?.refused('unavailable')
        next(this.unavailable())
        return
      }
      // Room is taken before the authenticator is asked, and given back when the socket is
      // registered or its engine connection closes, whichever comes first: a client that leaves
      // while it is being authenticated never reaches `handleConnection`.
      const held = this.admit(socket)
      ticket = held
      const auth = await shielded(this.transport.authenticate(this.buildAuthContext(socket)))
      // Authentication is asynchronous, so shutdown may have begun while this handshake waited.
      if (this.transport.shuttingDown) {
        this.tally?.refused('unavailable')
        next(this.unavailable())
        return
      }
      if (!auth) {
        this.tally?.refused('unauthorized')
        const refusal = new Error(REALTIME_ERROR_CODES.AUTH_FAILED) as Error & { data: unknown }
        refusal.data = { code: REALTIME_ERROR_CODES.AUTH_FAILED }
        next(refusal)
        return
      }
      const resolvedAuth = resolveAuthTenant(this.options, auth)
      assertIdentityIsNotBlank(resolvedAuth)
      this.authenticated.set(socket, admitRooms(resolvedAuth))
      this.tickets.set(socket, held)
      handedOver = true
      next()
    } catch (err) {
      next(this.refusalFor(socket, err))
    } finally {
      if (!handedOver) ticket?.release()
    }
  }

  /**
   * The error a handshake that failed is answered with, after the log line the failure earns.
   *
   * The gate and the admission count and log their own refusals once for each window; one line for
   * each handshake would let an attack flood the log. The message stays generic. A refusal that is
   * the instance's capacity or the authenticator's availability carries the transport code, so a
   * client can retry it; any other failure is not something a client can act on and carries none.
   */
  private refusalFor(socket: Socket, err: unknown): Error {
    if (err instanceof ConnectionLimitError) {
      this.tally?.refused('limit')
      return this.unavailable('Internal Server Error')
    }
    if (err instanceof AuthenticationUnavailableError) {
      this.tally?.refused('unavailable')
      return this.unavailable('Internal Server Error')
    }
    this.tally?.refused('error')
    logEvent(
      this.logger,
      'error',
      'REALTIME_HANDSHAKE_FAILED',
      `handshake refused`,
      { socketId: socket.id },
      err,
    )
    return new Error('Internal Server Error')
  }

  /** A `connect_error` carrying `data.code` `REALTIME_TRANSPORT_UNAVAILABLE`, for a handshake the instance cannot take now. */
  private unavailable(message: string = REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE): Error {
    const refusal = new Error(message) as Error & {
      data: unknown
    }
    refusal.data = { code: REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE }
    return refusal
  }

  /** Wire the resolved Socket.IO server to the transport after gateway init. */
  afterInit(server: Server): void {
    server.use(this.authenticateHandshake)
    this.transport.setServer(server)
    if (!isRealtimeIoServer(rootOf(server))) this.reportMissingAdapter()
    this.logger.log('RealtimeGateway initialized')
  }

  /** Report a server that `RealtimeIoAdapter` did not create: the options the adapter applies are dropped. */
  private reportMissingAdapter(): void {
    const websocket = this.options.websocket ?? {}
    const configured = Object.keys(websocket).filter((key) => key !== 'namespace')
    logEvent(
      this.logger,
      'error',
      'REALTIME_ADAPTER_MISSING',
      'RealtimeIoAdapter is not the active WebSocket adapter, so the websocket options' +
        (configured.length > 0 ? ` (${configured.join(', ')})` : '') +
        ' are ignored and the gateway CORS stays closed (origin: false): browsers on another ' +
        'origin cannot connect. Add app.useWebSocketAdapter(new RealtimeIoAdapter(app)) in ' +
        "main.ts, importing it from '@bymax-one/nest-realtime/websocket'." +
        (socketNamespace(websocket.namespace) === '/'
          ? ''
          : " websocket.namespace is applied without it: the library is served there, and the library's authenticator " +
            "does not run for the clients of '/' or of any other gateway's namespace. Isolation from your gateways' " +
            'namespaces is not guaranteed without RealtimeIoAdapter.'),
    )
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
  /**
   * Map a Socket.IO handshake onto the transport-agnostic auth context.
   *
   * Socket.IO carries credentials in three places and the authenticator sees one
   * shape: `handshake.auth` is merged into the headers and query it stands in for,
   * and a repeated `ticket` parameter is collapsed to its first value, because the
   * ticket pattern is single-valued and an array reaching an authenticator that
   * expects a string is a bug at the far end.
   *
   * @param socket - The connecting Socket.IO socket.
   * @returns The context handed to `IConnectionAuthenticator.authenticate`.
   */
  private buildAuthContext(socket: Socket): ConnectionAuthContext {
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

    return {
      cookies: parseCookieHeader(handshake.headers.cookie ?? ''),
      headers,
      query,
      ip: handshake.address,
      remoteAddress: handshake.address,
      userAgent: handshake.headers['user-agent'],
      transport: 'websocket',
    }
  }

  async handleConnection(socket: Socket): Promise<void> {
    let ticket: AdmissionTicket | undefined
    try {
      const handshake = await shielded(this.takeHandshake(socket))
      if (!handshake) return
      ticket = handshake.ticket
      const { auth } = handshake
      // Namespace middleware that runs after ours can delay a socket past the time bound, so the
      // place is taken again, or the socket is refused, rather than registering past the limit.
      ticket?.renew()
      const registering = this.transport.registerSocket(socket, auth)
      // The registry holds the socket from the call on, so the place would be counted twice for as
      // long as the rest of the registration, a consumer's `onConnect` hook included, takes.
      ticket?.release()
      await shielded(registering)

      if (this.options.websocket?.emitConnectionEvent !== false) {
        socket.emit(RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED, {
          connectionId: socket.id,
          traits: { userId: auth.userId, tenantId: auth.tenantId, roles: auth.roles },
        })
      }
    } catch (err) {
      if (err instanceof ConnectionLimitError) {
        this.tally?.refused('limit')
      } else if (err instanceof AuthenticationUnavailableError) {
        this.tally?.refused('unavailable')
      } else {
        // A connection onConnect closed was admitted first, as on SSE, so it is logged and not a refusal.
        if (!(err instanceof ConnectHookFailure)) this.tally?.refused('error')
        logEvent(
          this.logger,
          'error',
          'REALTIME_HANDSHAKE_FAILED',
          `handleConnection threw — disconnecting`,
          { socketId: socket.id },
          err,
        )
      }
      socket.disconnect(true)
    } finally {
      ticket?.release()
    }
  }

  /**
   * Take a place for a socket, given back when it is released or when the socket's engine connection
   * closes. Several namespaces share one engine connection, so the listener is removed on release:
   * left attached, every handshake that is refused would add one for as long as the connection lives.
   */
  private admit(socket: Socket): AdmissionTicket {
    const held = this.transport.admit()
    const onClose = (): void => held.release()
    socket.conn.once('close', onClose)
    return {
      release: () => {
        socket.conn.off('close', onClose)
        held.release()
      },
      renew: () => held.renew(),
    }
  }

  /**
   * The identity of a socket and the place held for it: what the handshake middleware kept, or, for a
   * socket it never saw, a fresh authentication, failing closed. Resolves to nothing for a socket that
   * has been disconnected here.
   */
  private async takeHandshake(
    socket: Socket,
  ): Promise<{ auth: AuthenticationResult; ticket: AdmissionTicket | undefined } | undefined> {
    const auth = this.authenticated.get(socket)
    const ticket = this.tickets.get(socket)
    this.authenticated.delete(socket)
    this.tickets.delete(socket)
    if (auth) {
      // The place the middleware took is given back when the answer is refused: no caller is left to release it.
      try {
        return returnable({ auth, ticket })
      } catch (err) {
        ticket?.release()
        throw err
      }
    }
    if (this.transport.shuttingDown) {
      this.tally?.refused('unavailable')
      socket.disconnect(true)
      return undefined
    }
    const held = this.admit(socket)
    try {
      const fresh = await shielded(this.transport.authenticate(this.buildAuthContext(socket)))
      if (!fresh) {
        this.tally?.refused('unauthorized')
        socket.disconnect(true)
        held.release()
        return undefined
      }
      const resolved = resolveAuthTenant(this.options, fresh)
      assertIdentityIsNotBlank(resolved)
      return returnable({ auth: admitRooms(resolved), ticket: held })
    } catch (err) {
      held.release()
      throw err
    }
  }

  /** Handle a WebSocket disconnection — unregister the connection. */
  async handleDisconnect(socket: Socket): Promise<void> {
    await shielded(this.transport.unregisterSocket(socket.id, 'CLIENT_DISCONNECT'))
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
