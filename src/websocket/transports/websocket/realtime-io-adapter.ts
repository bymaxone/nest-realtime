/**
 * @fileoverview Custom NestJS IoAdapter applying WebSocket options and the @socket.io/redis-adapter.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { createAdapter as CreateAdapterFn } from '@socket.io/redis-adapter'
import type { Server, ServerOptions } from 'socket.io'
import {
  describeError,
  REALTIME_ERROR_CODES,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'

/** Shape of the lazily-required `@socket.io/redis-adapter` module. */
type RedisAdapterModule = { createAdapter: typeof CreateAdapterFn }

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
    const wsOpts = this.options.websocket ?? {}
    const mergedOpts: ServerOptions = {
      ...opts,
      cors: wsOpts.cors ?? opts?.cors,
      pingInterval: wsOpts.pingIntervalMs ?? 25_000,
      pingTimeout: wsOpts.pingTimeoutMs ?? 20_000,
      maxHttpBufferSize: wsOpts.maxHttpBufferSize ?? 1_000_000,
    } as ServerOptions

    const server = super.createIOServer(port, mergedOpts) as {
      adapter: (a: unknown) => void
      close: () => Promise<void>
    }

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
   * Install `@socket.io/redis-adapter`. A deterministic failure fails the boot: a
   * silent single-instance server drops cross-node messages. An unreachable Redis
   * is not one; reconnecting stays with the client.
   */
  private installRedisAdapter(server: { adapter: (a: unknown) => void }, pubClient: unknown): void {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter') as RedisAdapterModule
      const pub = pubClient as { duplicate: () => unknown }
      const sub = pub.duplicate()
      server.adapter(createAdapter(pub as never, sub as never))
    } catch (err) {
      const reason = describeError(err)
      throw new Error(
        `[${RealtimeIoAdapter.name}] ${REALTIME_ERROR_CODES.REDIS_ADAPTER_FAILED}: ` +
          `websocket.redisAdapter is set but the Socket.IO Redis adapter could not be installed (${reason}). ` +
          'Install @socket.io/redis-adapter and pass an ioredis client as pubClient.',
        { cause: err },
      )
    }
    this.adapterLogger.log(
      'Socket.IO Redis adapter registered — cross-instance WebSocket fan-out enabled',
    )
  }
}
