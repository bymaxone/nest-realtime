/**
 * @fileoverview Custom NestJS IoAdapter applying WebSocket options and the @socket.io/redis-adapter.
 * @layer infrastructure
 */
import type { ServerResponse } from 'node:http'
import { Logger } from '@nestjs/common'
import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { createAdapter as CreateAdapterFn } from '@socket.io/redis-adapter'
import type { ServerOptions } from 'socket.io'
import {
  logEvent,
  quitWithin,
  REALTIME_ERROR_CODES,
  REALTIME_OPTIONS_TOKEN,
  realtimeError,
  RealtimeMetricsTally,
  windowedReport,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions, QuitableClient } from '@bymax-one/nest-realtime/internal'
import {
  POLICY_TRANSPORTS,
  allowRequestFor,
  corsAnswersOrigins,
  refuseHostAllowRequest,
  refuseSid,
  listDifference,
  wantsPolicy,
} from './origin-policy'
import type { AllowRequest } from './origin-policy'
import { guardPublish } from './guard-publish'
import {
  corsWithOwnNames,
  placeFirst,
  plantedKeyCount,
  plantedKeyMessage,
  serverOptionsWithOwnNames,
  shadowDecoder,
  shadowServerInstance,
  shadowSocket,
} from './server-option-names'
import { socketNamespace } from './socket-namespace'

/** The part of a Socket.IO namespace this adapter uses. */
type Namespace = { on: (event: 'connection', listener: (socket: object) => void) => void }

/** An engine.io middleware: it is given the request and the response, and calls `next` to let the request go on. */
type EngineGuard = (request: unknown, response: ServerResponse, next: () => void) => void

/** Refuses a request with a 500 whose body has the error code and how many planted keys there are, when `Object.prototype` holds any. */
const stateGuard: EngineGuard = (_request, response, next) => {
  const planted = plantedKeyCount()
  if (planted === 0) {
    next()
    return
  }
  response.statusCode = 500
  response.setHeader('Content-Type', 'application/json')
  // Written as text, not with `JSON.stringify`: a `toJSON` planted on `Object.prototype` is looked up on every object it
  // serializes, and the code and the count are all this body has.
  response.end(`{"code":"${REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE}","count":${planted}}`)
}

/** The part of an engine.io socket this adapter uses to stop a packet from reaching the decoder. */
type EngineSocket = {
  prependListener: (event: 'packet', listener: (packet: { type: string }) => void) => void
  close: (discard?: boolean) => void
}

/**
 * Runs before anything else sees a packet of an open connection. While `Object.prototype` holds a planted key the
 * packet is turned into a no-op, which engine.io does not pass on, and the connection is closed, so that the decoder of
 * Socket.IO never runs on it.
 */
const guardPackets = (connection: EngineSocket): void => {
  connection.prependListener('packet', (packet) => {
    if (plantedKeyCount() === 0) return
    packet.type = 'noop'
    connection.close(true)
  })
}

/** The part of a Socket.IO server this adapter guards. */
type GuardedServer = {
  adapter: (a: unknown) => void
  close: () => Promise<void>
  engine?: {
    middlewares: EngineGuard[]
    use: (guard: typeof refuseSid) => void
    on: (event: 'connection', listener: (connection: EngineSocket) => void) => void
  }
  of: (name: string) => Namespace
  on: (event: 'new_namespace', listener: (namespace: Namespace) => void) => void
}

/**
 * Gives a server the own keys and the guards the library installs on one it creates. Per request and per packet, after
 * boot: a key planted since then is refused before anything reads the request, as the first of the engine's middlewares,
 * and before the decoder of Socket.IO runs on a packet of an open connection. A server whose guard did not end up first
 * is closed and refused, since it would answer requests unguarded.
 */
function installGuards(server: GuardedServer): void {
  shadowServerInstance(server)
  shadowDecoder(server)
  if (server.engine !== undefined && !placeFirst(server.engine.middlewares, stateGuard)) {
    server.close().catch(() => undefined)
    throw realtimeError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      'the request guard could not be installed first',
      { who: 'RealtimeIoAdapter' },
    )
  }
  server.engine?.on('connection', guardPackets)
  // Each socket of each namespace, the main one and every one made later, is given its own lazy state as it connects.
  server.of('/').on('connection', shadowSocket)
  server.on('new_namespace', (namespace) => namespace.on('connection', shadowSocket))
}

/** Shape of the lazily-required `@socket.io/redis-adapter` module. */
type RedisAdapterModule = { createAdapter: typeof CreateAdapterFn }

/** For each server built with an origin policy, its origin list; `undefined` under `websocketOnly` alone. */
const serverPolicies = new WeakMap<object, readonly string[] | undefined>()

/**
 * Why `server` does not serve the origin policy `websocket` asks for, or `undefined` when it does. One server is shared
 * by every registration of an application and is built from one of them, so each gateway has to ask about its own.
 */
export function policyMismatch(
  server: unknown,
  websocket: BymaxRealtimeModuleOptions['websocket'],
): string | undefined {
  const key = server as object
  if (!serverPolicies.has(key)) return 'the server was built with neither'
  return listDifference(serverPolicies.get(key), websocket?.allowedOrigins)
}

/** The commands the Socket.IO Redis adapter sends on its subscriber connection. */
const ADAPTER_COMMANDS = ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'] as const

/**
 * What the subscriber connection does not take from the host client. The adapter sends each
 * SUBSCRIBE once and never again, so one that is refused locally, dropped after a number of
 * retries or not restored after a reconnect leaves this instance deaf to the others: it queues
 * while there is no connection, waits while the client keeps reconnecting, and is restored then.
 * `disconnectTimeout` is how long ioredis lets a socket close after `disconnect()`; a closed
 * connection has nothing left to clear it, so the default would hold the process for it.
 */
const SUBSCRIBER_OVERRIDES = {
  autoResendUnfulfilledCommands: true,
  autoResubscribe: true,
  disconnectTimeout: 1,
  enableOfflineQueue: true,
  maxRetriesPerRequest: null,
} as const

/** The class of what a Redis command rejected with: its message can carry the host or a credential. */
function kindOf(error: unknown): string {
  try {
    const name = Object(error).constructor?.name as unknown
    return typeof name === 'string' ? name : 'Error'
  } catch {
    // The value refused the read; this runs in rejection handlers, where a throw is unhandled.
    return 'Error'
  }
}

const realtimeServers = new WeakSet<object>()

/** The servers of an application's port and default path, which is where the library's gateway listens. */
const libraryServers = new WeakSet<object>()

/** Whether `server` is the `/` namespace of a library server: the server itself, or its namespace of that name. */
function isLibraryRoot(server: unknown): boolean {
  const { name, server: root } = Object(server) as { name?: unknown; server?: unknown }
  return libraryServers.has((name === '/' ? root : server) as object)
}

/** Whether `server` was created by `RealtimeIoAdapter`. */
export function isRealtimeIoServer(server: unknown): boolean {
  return typeof server === 'object' && server !== null && realtimeServers.has(server)
}

/**
 * Custom NestJS `IoAdapter` that:
 *
 * 1. Applies `websocket.cors`, `pingIntervalMs`, `pingTimeoutMs`, and
 *    `maxHttpBufferSize` from `BymaxRealtimeModuleOptions`.
 * 2. Lazily installs `@socket.io/redis-adapter` when
 *    `websocket.redisAdapter.pubClient` is provided, enabling transparent
 *    cross-instance WebSocket fan-out (spec §11.4).
 *
 * Register this adapter in `main.ts` **before** `app.listen()`:
 *
 * ```ts
 * import { RealtimeIoAdapter } from '@bymax-one/nest-realtime'
 *
 * const app = await NestFactory.create(AppModule)
 * app.useWebSocketAdapter(new RealtimeIoAdapter(app))
 * await app.listen(3000)
 * ```
 *
 * Sticky sessions are MANDATORY when the polling fallback is enabled in a
 * horizontally scaled deployment. The adapter synchronizes messages across
 * nodes but does NOT remove the load-balancer's session-affinity requirement
 * (spec §11.5).
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RealtimeIoAdapter.name)
  private readonly options: BymaxRealtimeModuleOptions
  /** The subscriber connections this adapter opened for the Redis adapter, closed with it. */
  private readonly subscribers = new Set<QuitableClient>()
  private reportedOutside = false
  private readonly tally: RealtimeMetricsTally | undefined
  private readonly publishFailures = windowedReport(
    (): { count: number; last?: string } => ({ count: 0 }),
    ({ count, last }) => {
      logEvent(
        this.adapterLogger,
        'warn',
        'REALTIME_ADAPTER_PUBLISH_FAILED',
        `Redis adapter publishes failed since the last report: ${count} (${String(last)}); other instances may not ` +
          'have received those messages',
        { count },
      )
    },
  )

  constructor(app: INestApplicationContext) {
    super(app)
    this.options = app.get<BymaxRealtimeModuleOptions>(REALTIME_OPTIONS_TOKEN)
    this.tally = app.get<RealtimeMetricsTally | undefined>(RealtimeMetricsTally)
  }

  /**
   * Create the Socket.IO server with merged WebSocket options.
   *
   * When `websocket.redisAdapter.pubClient` is set, installs the
   * `@socket.io/redis-adapter` lazily: the optional peer is needed only then.
   */
  override createIOServer(port: number, opts?: ServerOptions): unknown {
    const planted = plantedKeyCount()
    if (planted > 0) {
      throw realtimeError(REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE, plantedKeyMessage(planted), {
        who: 'RealtimeIoAdapter',
      })
    }
    const wsOpts = this.options.websocket ?? {}
    const policy = wantsPolicy(wsOpts)
    if (policy) this.refuseConflicts(wsOpts.cors ?? opts?.cors, opts)
    const mergedOpts = serverOptionsWithOwnNames({
      ...opts,
      ...(policy
        ? {
            transports: [...POLICY_TRANSPORTS],
            allowRequest: allowRequestFor(
              wsOpts.allowedOrigins,
              (opts as { allowRequest?: AllowRequest } | undefined)?.allowRequest,
            ),
          }
        : {}),
      cors: corsWithOwnNames(wsOpts.cors ?? opts?.cors),
      pingInterval: wsOpts.pingIntervalMs ?? 25_000,
      pingTimeout: wsOpts.pingTimeoutMs ?? 20_000,
      maxHttpBufferSize: wsOpts.maxHttpBufferSize ?? 1_000_000,
    }) as unknown as ServerOptions

    const server = super.createIOServer(port, mergedOpts) as GuardedServer
    installGuards(server)
    if (policy) this.installSidGuard(server)
    const isLibraryServer = port === 0 && opts?.path === undefined
    if (isLibraryServer) this.openLibraryNamespace(server)

    if (wsOpts.redisAdapter?.pubClient) {
      try {
        this.installRedisAdapter(server, wsOpts.redisAdapter.pubClient)
      } catch (err) {
        // A server given its own port listens already; a failed boot must not keep the process alive.
        server.close().catch(() => undefined)
        throw err
      }
    }

    realtimeServers.add(server)
    if (policy) serverPolicies.set(server, wsOpts.allowedOrigins)
    if (isLibraryServer) libraryServers.add(server)
    return server
  }

  /**
   * Opens the library's namespace on its server, the one of the application's port and default path, before any gateway
   * joins it: Socket.IO makes a namespace opened later by name a child of a RegExp namespace that matches it, and that
   * gateway's broadcasts, rooms and handlers would then reach the library's sockets.
   */
  private openLibraryNamespace(server: GuardedServer): void {
    const namespace = socketNamespace(this.options.websocket?.namespace)
    if (namespace !== '/') server.of(namespace)
  }

  /**
   * Refuses the boot of a policy that two lists would decide: a `cors` that answers origins beside `allowedOrigins`, or
   * a host `allowRequest` that cannot be called.
   */
  private refuseConflicts(cors: unknown, opts: ServerOptions | undefined): void {
    refuseHostAllowRequest((opts as { allowRequest?: unknown } | undefined)?.allowRequest)
    if (this.options.websocket?.allowedOrigins !== undefined && corsAnswersOrigins(cors)) {
      throw realtimeError(
        REALTIME_ERROR_CODES.INVALID_OPTIONS,
        'websocket.allowedOrigins cannot be set together with a cors.origin other than false, in websocket.cors or in the gateway options',
        { who: RealtimeIoAdapter.name },
      )
    }
  }

  /**
   * Installs the guard that refuses a request naming a session, after the request guard and before any middleware the
   * host adds, which can only be added once this server has been returned. A server whose engine cannot take the guard,
   * or that has no engine yet, is closed and refused: it would answer requests the policy cannot cover, at once or once
   * attached.
   */
  private installSidGuard(server: GuardedServer): void {
    if (typeof server.engine?.use !== 'function') {
      server.close().catch(() => undefined)
      throw realtimeError(
        REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
        server.engine === undefined
          ? 'the websocket origin policy could not be installed: the server has no engine, so one attached later would not be covered'
          : 'the websocket origin policy could not be installed: the engine has no middleware hook',
        { who: RealtimeIoAdapter.name },
      )
    }
    server.engine.use(refuseSid)
  }

  /**
   * Binds a gateway's connection handler as `IoAdapter` does. Nest calls this for every gateway, so this is where one on
   * `/` of the library's server is seen while the library is served on another namespace.
   */
  override bindClientConnect(server: unknown, callback: (...args: unknown[]) => void): void {
    super.bindClientConnect(server as Parameters<IoAdapter['bindClientConnect']>[0], callback)
    if (this.reportedOutside || socketNamespace(this.options.websocket?.namespace) === '/') return
    if (!isLibraryRoot(server)) return
    this.reportedOutside = true
    logEvent(
      this.adapterLogger,
      'warn',
      'REALTIME_GATEWAY_OUTSIDE_NAMESPACE',
      "A gateway of this application is on '/' while websocket.namespace puts the library elsewhere: the library's " +
        "authenticator does not run for the clients of '/', and the library's rooms are not reachable from it. Give the " +
        'gateway the namespace of websocket.namespace, or authenticate its clients in the gateway itself.',
    )
  }

  /**
   * Closes the subscriber connections this adapter opened, after Nest has closed every server.
   *
   * The caller's `pubClient` is not touched: it belongs to the caller. Each connection is quit with
   * a bound, and all of them at once, so a Redis that stopped answering costs one bound and not one
   * per connection.
   */
  override async dispose(): Promise<void> {
    await super.dispose()
    const closing = [...this.subscribers].map((sub) => quitWithin(sub))
    this.subscribers.clear()
    await Promise.allSettled(closing)
    this.publishFailures.stop()
  }

  /**
   * Handles the rejection of the subscriber commands the Socket.IO Redis adapter sends and never
   * awaits. Its `subscribe` at boot and its `unsubscribe` at close discard their promises, so a
   * command that fails, as every pending one does when the connection is closed or gives up,
   * would be an unhandled rejection that ends the process.
   *
   * Each command still returns its own promise, so anything that awaits it sees the rejection; a
   * handler is attached beside it. The failure is logged once per connection, by its class only: the
   * message of a connection error can carry the host or a credential.
   */
  private guardCommands(sub: QuitableClient): void {
    const commands = sub as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>
    let reported = false
    for (const name of ADAPTER_COMMANDS) {
      const original = commands[name]
      if (original === undefined) continue
      commands[name] = (...args: unknown[]) => {
        const pending = original.apply(sub, args)
        Promise.resolve(pending).catch((err: unknown) => {
          if (reported) return
          reported = true
          const kind = kindOf(err)
          logEvent(
            this.adapterLogger,
            'warn',
            'REALTIME_ADAPTER_COMMAND_FAILED',
            `Redis adapter subscriber command failed (${kind})`,
          )
        })
        return pending
      }
    }
  }

  /** Counts one rejected publish of the Redis adapter and reports it, at most once for each window. */
  private publishFailed(error: unknown): void {
    this.tally?.adapterPublishFailed()
    this.publishFailures(({ count }) => ({ count: count + 1, last: kindOf(error) }))
  }

  /**
   * Install `@socket.io/redis-adapter`. A deterministic failure fails the boot: a
   * silent single-instance server drops cross-node messages. An unreachable Redis
   * is not one; reconnecting stays with the client.
   */
  private installRedisAdapter(server: { adapter: (a: unknown) => void }, pubClient: unknown): void {
    let sub: QuitableClient | undefined
    try {
      const { createAdapter } = require('@socket.io/redis-adapter') as RedisAdapterModule
      const pub = pubClient as { duplicate: (overrides: object) => unknown }
      sub = pub.duplicate(SUBSCRIBER_OVERRIDES) as QuitableClient
      this.subscribers.add(sub)
      this.guardCommands(sub)
      const publisher = guardPublish(pubClient as object, (error) => this.publishFailed(error))
      server.adapter(createAdapter(publisher as never, sub as never))
    } catch (err) {
      // A connection opened for an adapter that failed to install has no owner left to close it.
      if (sub !== undefined) {
        this.subscribers.delete(sub)
        try {
          sub.disconnect()
        } catch {
          // The install failure below is the one to report; a failed release must not replace it.
        }
      }
      throw realtimeError(
        REALTIME_ERROR_CODES.REDIS_ADAPTER_FAILED,
        'websocket.redisAdapter is set but the Socket.IO Redis adapter could not be installed. ' +
          'Install @socket.io/redis-adapter and pass an ioredis client as pubClient.',
        { who: RealtimeIoAdapter.name, cause: err },
      )
    }
    this.adapterLogger.log(
      'Socket.IO Redis adapter registered — cross-instance WebSocket fan-out enabled',
    )
  }
}
