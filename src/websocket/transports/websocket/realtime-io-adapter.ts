/**
 * @fileoverview Custom NestJS IoAdapter applying WebSocket options and the @socket.io/redis-adapter.
 * @layer infrastructure
 */
import type { ServerResponse } from 'node:http'
import { Logger } from '@nestjs/common'
import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { createAdapter as CreateAdapterFn } from '@socket.io/redis-adapter'
import type { Server, ServerOptions } from 'socket.io'
import {
  logEvent,
  quitWithin,
  REALTIME_ERROR_CODES,
  REALTIME_OPTIONS_TOKEN,
  realtimeError,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions, QuitableClient } from '@bymax-one/nest-realtime/internal'
import {
  corsWithOwnNames,
  plantedStateMessage,
  plantedStateNames,
  serverOptionsWithOwnNames,
  shadowServerInstance,
  shadowSocket,
} from './server-option-names'

/** The part of a Socket.IO namespace this adapter uses. */
type Namespace = { use: (middleware: (socket: object, next: () => void) => void) => void }

/** An engine.io middleware: it is given the request and the response, and calls `next` to let the request go on. */
type EngineGuard = (request: unknown, response: ServerResponse, next: () => void) => void

/** Refuses a request with a 500 that names the planted fields, when `Object.prototype` holds any of them. */
const stateGuard: EngineGuard = (_request, response, next) => {
  const planted = plantedStateNames()
  if (planted.length === 0) {
    next()
    return
  }
  response.statusCode = 500
  response.setHeader('Content-Type', 'application/json')
  response.end(
    JSON.stringify({
      code: REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      message: plantedStateMessage(planted),
    }),
  )
}

/** Shape of the lazily-required `@socket.io/redis-adapter` module. */
type RedisAdapterModule = { createAdapter: typeof CreateAdapterFn }

/** The commands the Socket.IO Redis adapter sends on its subscriber connection. */
const ADAPTER_COMMANDS = ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'] as const

const realtimeServers = new WeakSet<object>()

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

  constructor(app: INestApplicationContext) {
    super(app)
    this.options = app.get<BymaxRealtimeModuleOptions>(REALTIME_OPTIONS_TOKEN)
  }

  /**
   * Bind the gateway to `websocket.namespace` when configured.
   *
   * `@WebSocketGateway()` args are evaluated at class-decoration time — before
   * the module options resolve — so the namespace cannot be declared there.
   * Instead we build the root server via `super.create` (which routes through the
   * overridden {@link createIOServer}, applying CORS/ping/Redis) and then return
   * the requested namespace via `server.of(ns)`. The gateway's `@WebSocketServer()`
   * and `WebSocketTransport` then operate on that `Namespace`. A `'/'` or unset
   * namespace leaves the root server untouched.
   */
  override create(
    port: number,
    options?: ServerOptions & { namespace?: string; server?: unknown },
  ): Server {
    const server = super.create(port, options)
    const ns = this.options.websocket?.namespace
    if (ns && ns !== '/' && typeof (server as { of?: unknown }).of === 'function') {
      const namespace = (server as unknown as { of: (name: string) => Server }).of(ns)
      realtimeServers.add(namespace)
      return namespace
    }
    return server
  }

  /**
   * Create the Socket.IO server with merged WebSocket options.
   *
   * When `websocket.redisAdapter.pubClient` is set, installs the
   * `@socket.io/redis-adapter` lazily: the optional peer is needed only then.
   */
  override createIOServer(port: number, opts?: ServerOptions): unknown {
    const planted = plantedStateNames()
    if (planted.length > 0) {
      throw realtimeError(
        REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
        plantedStateMessage(planted),
        {
          who: 'RealtimeIoAdapter',
        },
      )
    }
    const wsOpts = this.options.websocket ?? {}
    const mergedOpts = serverOptionsWithOwnNames({
      ...opts,
      cors: corsWithOwnNames(wsOpts.cors ?? opts?.cors),
      pingInterval: wsOpts.pingIntervalMs ?? 25_000,
      pingTimeout: wsOpts.pingTimeoutMs ?? 20_000,
      maxHttpBufferSize: wsOpts.maxHttpBufferSize ?? 1_000_000,
    }) as unknown as ServerOptions

    const server = super.createIOServer(port, mergedOpts) as {
      adapter: (a: unknown) => void
      close: () => Promise<void>
      engine?: { use: (guard: EngineGuard) => void }
      of: (name: string) => Namespace
      on: (event: 'new_namespace', listener: (namespace: Namespace) => void) => void
    }
    shadowServerInstance(server)
    // Per request, after boot: a key planted since then is refused before engine.io reads the request.
    server.engine?.use(stateGuard)
    // Each socket of each namespace, the main one and every one made later, is given its own lazy state before it connects.
    server.of('/').use(shadowSocket)
    server.on('new_namespace', (namespace) => namespace.use(shadowSocket))

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
    return server
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
          const kind = (Object(err).constructor?.name as string | undefined) ?? 'Error'
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
      // `disconnectTimeout` is how long ioredis lets a socket close after `disconnect()`; a closed
      // connection has nothing left to clear it, so the default would hold the process for it.
      sub = pub.duplicate({ disconnectTimeout: 1 }) as QuitableClient
      this.subscribers.add(sub)
      this.guardCommands(sub)
      server.adapter(createAdapter(pub as never, sub as never))
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
