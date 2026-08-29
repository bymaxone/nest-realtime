/**
 * @fileoverview The dynamic NestJS module for the SSE transport.
 * @layer composition
 */
import { Global, Logger, Module } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import { composeForRoot, composeForRootAsync } from './composition/realtime-module.factory'
import { sseWiring } from './composition/sse-wiring'
import type {
  SseRealtimeModuleAsyncOptions,
  SseRealtimeModuleOptions,
} from './interfaces/realtime-module-options.interface'

/**
 * Realtime module for Server-Sent Events. Registered globally so a single
 * configuration serves the whole application.
 *
 * WebSocket lives behind `@bymax-one/nest-realtime/websocket`, and that split is
 * what this module buys: nothing reachable from here imports
 * `@nestjs/websockets` or `socket.io`, so an SSE application never installs the
 * Socket.IO stack. Reach for `BymaxRealtimeWebSocketModule` when the transport
 * is `'websocket'` or `'both'`.
 */
@Global()
@Module({})
export class BymaxRealtimeModule {
  private static readonly logger = new Logger(BymaxRealtimeModule.name)

  /**
   * Configure the module synchronously.
   *
   * @throws when the options are invalid.
   * @example
   * ```ts
   * BymaxRealtimeModule.forRoot({
   *   transport: 'sse',
   *   authenticator: new MyAuthenticator(),
   * })
   * ```
   */
  static forRoot(options: SseRealtimeModuleOptions): DynamicModule {
    return composeForRoot(BymaxRealtimeModule, sseWiring, BymaxRealtimeModule.logger, options)
  }

  /**
   * Configure the module asynchronously so options — and the authenticator —
   * can be resolved through DI: `ConfigService`, a Redis client, and so on.
   *
   * Options are validated inside the resolving factory, so a malformed
   * configuration rejects at bootstrap and the application fails to start with
   * a clear error.
   *
   * Controllers are registered at decoration time, so the SSE route comes from
   * `sseEndpoint` on the registration rather than from the `sse.endpoint` the
   * factory resolves — the factory has not run yet when the controller is
   * built. It defaults to `/events`, and a factory that resolves a disagreeing
   * `sse.endpoint` is rejected at bootstrap rather than silently served on
   * another path.
   *
   * @throws when no factory pattern is given, more than one is, or the factory
   *   resolves a transport other than `'sse'`.
   * @example
   * ```ts
   * BymaxRealtimeModule.forRootAsync({
   *   transport: 'sse',
   *   sseEndpoint: '/realtime/sse', // optional; defaults to '/events'
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (cfg: ConfigService) => ({
   *     transport: 'sse' as const,
   *     authenticator: new CookieJwtAuthenticator(cfg.getOrThrow('JWT_SECRET')),
   *   }),
   * })
   * ```
   */
  static forRootAsync(asyncOptions: SseRealtimeModuleAsyncOptions): DynamicModule {
    return composeForRootAsync(
      BymaxRealtimeModule,
      sseWiring,
      BymaxRealtimeModule.logger,
      asyncOptions,
    )
  }
}
