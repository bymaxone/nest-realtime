/**
 * @fileoverview Custom NestJS IoAdapter applying WebSocket options and the @socket.io/redis-adapter.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { createAdapter as CreateAdapterFn } from '@socket.io/redis-adapter'
import type { ServerOptions } from 'socket.io'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'

/** Shape of the lazily-required `@socket.io/redis-adapter` module. */
type RedisAdapterModule = { createAdapter: typeof CreateAdapterFn }

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
  private readonly logger = new Logger(RealtimeIoAdapter.name)
  private readonly options: BymaxRealtimeModuleOptions

  constructor(app: INestApplicationContext) {
    super(app)
    this.options = app.get<BymaxRealtimeModuleOptions>(REALTIME_OPTIONS_TOKEN)
  }

  /**
   * Create the Socket.IO server with merged WebSocket options.
   *
   * When `websocket.redisAdapter.pubClient` is set, installs the
   * `@socket.io/redis-adapter` lazily (so the package stays an optional peer
   * dep — its absence does not crash the lib).
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

    const server = super.createIOServer(port, mergedOpts) as { adapter: (a: unknown) => void }

    if (wsOpts.redisAdapter?.pubClient) {
      this.installRedisAdapter(server, wsOpts.redisAdapter.pubClient)
    }

    return server
  }

  /**
   * Lazily load and install `@socket.io/redis-adapter`.
   *
   * Uses a dynamic `require` so the package stays optional — absent peers do
   * not crash the lib. A load or install failure is logged and tolerated;
   * the lib degrades gracefully to single-instance mode.
   */
  private installRedisAdapter(server: { adapter: (a: unknown) => void }, pubClient: unknown): void {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter') as RedisAdapterModule
      const pub = pubClient as { duplicate: () => unknown }
      const sub = pub.duplicate()
      server.adapter(createAdapter(pub as never, sub as never))
      this.logger.log(
        'Socket.IO Redis adapter registered — cross-instance WebSocket fan-out enabled',
      )
    } catch (err) {
      this.logger.error(
        `Failed to register @socket.io/redis-adapter: ${(err as Error).message}. ` +
          'Falling back to single-instance mode.',
      )
    }
  }
}
