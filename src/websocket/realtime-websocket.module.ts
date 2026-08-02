/**
 * @fileoverview The dynamic NestJS module for the WebSocket transport.
 * @layer composition
 */
import { Global, Logger, Module } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import { composeForRoot, composeForRootAsync } from '../server/composition/realtime-module.factory'
import type {
  WebSocketRealtimeModuleAsyncOptions,
  WebSocketRealtimeModuleOptions,
} from '../server/interfaces/realtime-module-options.interface'
import { webSocketWiring } from './websocket-wiring'

/**
 * Realtime module for Socket.IO, and for `'both'` where SSE and WebSocket are
 * composed. Registered globally so a single configuration serves the whole
 * application.
 *
 * It lives in its own entry point because it is the only part of the library
 * that imports `@nestjs/websockets` and `@nestjs/platform-socket.io`. Importing
 * it is what pulls the Socket.IO stack in — an application on SSE uses
 * `BymaxRealtimeModule` from the package root and never installs it.
 */
@Global()
@Module({})
export class BymaxRealtimeWebSocketModule {
  private static readonly logger = new Logger(BymaxRealtimeWebSocketModule.name)

  /**
   * Configure the module synchronously.
   *
   * @throws when the options are invalid.
   * @example
   * ```ts
   * BymaxRealtimeWebSocketModule.forRoot({
   *   transport: 'websocket',
   *   authenticator: new MyAuthenticator(),
   * })
   * ```
   */
  static forRoot(options: WebSocketRealtimeModuleOptions): DynamicModule {
    return composeForRoot(
      BymaxRealtimeWebSocketModule,
      webSocketWiring,
      BymaxRealtimeWebSocketModule.logger,
      options,
    )
  }

  /**
   * Configure the module asynchronously so options — and the authenticator —
   * can be resolved through DI.
   *
   * Controllers are registered at decoration time, so `'both'` binds the SSE
   * controller to the default endpoint `/events`. A non-default endpoint needs
   * `forRoot` with pre-resolved options.
   *
   * @throws when no factory pattern is given, more than one is, or the factory
   *   resolves a transport other than the one declared.
   * @example
   * ```ts
   * BymaxRealtimeWebSocketModule.forRootAsync({
   *   transport: 'both',
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (cfg: ConfigService) => ({
   *     transport: 'both' as const,
   *     authenticator: new CookieJwtAuthenticator(cfg.getOrThrow('JWT_SECRET')),
   *   }),
   * })
   * ```
   */
  static forRootAsync(asyncOptions: WebSocketRealtimeModuleAsyncOptions): DynamicModule {
    return composeForRootAsync(
      BymaxRealtimeWebSocketModule,
      webSocketWiring,
      BymaxRealtimeWebSocketModule.logger,
      asyncOptions,
    )
  }
}
