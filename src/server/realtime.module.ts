/**
 * @fileoverview The dynamic NestJS module wiring the SSE transport and public API.
 * @layer composition
 */
import { randomUUID } from 'node:crypto'
import { Global, Logger, Module } from '@nestjs/common'
import type { DynamicModule, Provider } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../shared/constants/error-codes.constants'
import { applyDefaults } from './config/default-options'
import { validateOptions } from './config/validate-options'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from './constants/injection-tokens.constants'
import { createSseController } from './factories/sse-controller.factory'
import type {
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleOptionsFactory,
} from './interfaces/realtime-module-options.interface'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import { ConnectionRegistry } from './services/connection-registry.service'
import { EventIdGenerator } from './services/event-id-generator.service'
import { RealtimeService } from './services/realtime.service'
import { ReauthenticationService } from './services/reauthentication.service'
import { RoomRegistry } from './services/room-registry.service'
import { EventReplayBuffer } from './transports/sse/event-replay-buffer'
import { HeartbeatService } from './transports/sse/heartbeat.service'
import { SseSubscriptionHandler } from './transports/sse/sse-subscription.handler'
import { SseTransport } from './transports/sse/sse.transport'

/**
 * Realtime module — SSE transport (default) with a unified, transport-agnostic
 * public API (`RealtimeService`). Registered globally so a single configuration
 * serves the whole application.
 */
@Global()
@Module({})
export class BymaxRealtimeModule {
  private static readonly logger = new Logger(BymaxRealtimeModule.name)

  /**
   * Configure the module synchronously.
   *
   * @example
   * ```ts
   * BymaxRealtimeModule.forRoot({
   *   transport: 'sse',
   *   authenticator: new MyAuthenticator(),
   * })
   * ```
   */
  static forRoot(options: BymaxRealtimeModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)
    if (resolved.transport !== 'sse') {
      throw new Error(
        `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: transport "${resolved.transport}" is not available; only 'sse' is supported`,
      )
    }

    const instanceId = randomUUID()
    const providers: Provider[] = [
      { provide: REALTIME_OPTIONS_TOKEN, useValue: resolved },
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: resolved.authenticator },
      { provide: REALTIME_PUBSUB_TOKEN, useValue: resolved.pubsub ?? new InMemoryPubSub() },
      { provide: REALTIME_HOOKS_TOKEN, useValue: resolved.hooks ?? {} },
      { provide: REALTIME_OFFLINE_QUEUE_TOKEN, useValue: resolved.offlineQueue },
      { provide: REALTIME_PRESENCE_TOKEN, useValue: resolved.presence },
      ConnectionRegistry,
      RoomRegistry,
      EventIdGenerator,
      EventReplayBuffer,
      HeartbeatService,
      SseTransport,
      { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      SseSubscriptionHandler,
      RealtimeService,
      ReauthenticationService,
    ]

    BymaxRealtimeModule.logger.log(
      `Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`,
    )

    return {
      module: BymaxRealtimeModule,
      controllers: [createSseController(resolved.sse.endpoint)],
      providers,
      exports: [
        RealtimeService,
        ConnectionRegistry,
        REALTIME_OPTIONS_TOKEN,
        REALTIME_INSTANCE_ID_TOKEN,
        REALTIME_AUTHENTICATOR_TOKEN,
        REALTIME_PUBSUB_TOKEN,
        REALTIME_HOOKS_TOKEN,
        REALTIME_OFFLINE_QUEUE_TOKEN,
        REALTIME_PRESENCE_TOKEN,
        REALTIME_TRANSPORT_TOKEN,
      ],
    }
  }

  /**
   * Configure the module asynchronously so consumers can resolve options (and
   * the authenticator) through DI — `ConfigService`, `JwtService`, a Redis
   * client, etc.
   *
   * Options are validated and defaulted **inside** the resolving factory, so a
   * malformed configuration rejects via the Promise at bootstrap time and the
   * application fails to start with a clear error.
   *
   * Controllers are registered at decoration time, so the async path binds the
   * SSE controller to the fixed default endpoint `/events`.  Consumers that need
   * a non-default endpoint with async configuration should use `forRoot` and
   * pre-resolve the options before passing them.
   *
   * @example
   * ```ts
   * BymaxRealtimeModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: async (cfg: ConfigService) => ({
   *     transport: 'sse',
   *     authenticator: new CookieJwtAuthenticator(cfg.get('JWT_SECRET')!),
   *   }),
   * })
   * ```
   */
  static forRootAsync(asyncOptions: BymaxRealtimeModuleAsyncOptions): DynamicModule {
    // Internal token scoped to this call — avoids collisions between multiple forRootAsync calls.
    const FACTORY_TOKEN = Symbol('REALTIME_OPTIONS_FACTORY')

    // The resolved-options provider normalises all three async patterns into a single
    // REALTIME_OPTIONS_TOKEN provider that validates + applies defaults.
    const resolvedOptionsProvider: Provider = asyncOptions.useFactory
      ? {
          provide: REALTIME_OPTIONS_TOKEN,
          useFactory: async (...args: unknown[]) => {
            const raw = await asyncOptions.useFactory!(...args)
            if (!raw)
              throw new Error(
                `${REALTIME_ERROR_CODES.INVALID_OPTIONS}: useFactory returned nothing`,
              )
            validateOptions(raw)
            return applyDefaults(raw)
          },
          inject: [...(asyncOptions.inject ?? [])],
        }
      : {
          // useClass / useExisting: inject the factory service and call createRealtimeOptions().
          provide: REALTIME_OPTIONS_TOKEN,
          useFactory: async (factory: BymaxRealtimeModuleOptionsFactory) => {
            const raw = await factory.createRealtimeOptions()
            if (!raw)
              throw new Error(
                `${REALTIME_ERROR_CODES.INVALID_OPTIONS}: options factory returned nothing`,
              )
            validateOptions(raw)
            return applyDefaults(raw)
          },
          inject: [asyncOptions.useClass ? FACTORY_TOKEN : asyncOptions.useExisting!],
        }

    // For useClass, register the factory class under the internal token so DI can
    // instantiate it (it may itself have injectable dependencies).
    const factoryClassProvider: Provider[] = asyncOptions.useClass
      ? [{ provide: FACTORY_TOKEN, useClass: asyncOptions.useClass }]
      : []

    const authenticatorProvider: Provider = {
      provide: REALTIME_AUTHENTICATOR_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.authenticator,
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const pubsubProvider: Provider = {
      provide: REALTIME_PUBSUB_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.pubsub ?? new InMemoryPubSub(),
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const hooksProvider: Provider = {
      provide: REALTIME_HOOKS_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.hooks ?? {},
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const instanceId = randomUUID()

    const providers: Provider[] = [
      ...factoryClassProvider,
      resolvedOptionsProvider,
      authenticatorProvider,
      pubsubProvider,
      hooksProvider,
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      {
        provide: REALTIME_OFFLINE_QUEUE_TOKEN,
        useFactory: (opts: BymaxRealtimeModuleOptions) => opts.offlineQueue,
        inject: [REALTIME_OPTIONS_TOKEN],
      },
      {
        provide: REALTIME_PRESENCE_TOKEN,
        useFactory: (opts: BymaxRealtimeModuleOptions) => opts.presence,
        inject: [REALTIME_OPTIONS_TOKEN],
      },
      ConnectionRegistry,
      RoomRegistry,
      EventIdGenerator,
      EventReplayBuffer, // plain class — injects REALTIME_OPTIONS_TOKEN itself
      HeartbeatService,
      SseTransport,
      { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      SseSubscriptionHandler,
      RealtimeService,
      ReauthenticationService,
      ...(asyncOptions.extraProviders ?? []),
    ]

    return {
      module: BymaxRealtimeModule,
      imports: asyncOptions.imports ?? [],
      providers,
      // Controllers are registered at decoration time; the async path binds the
      // fixed default endpoint. Use forRoot when a custom endpoint is needed.
      controllers: [createSseController('/events')],
      exports: [
        RealtimeService,
        ConnectionRegistry,
        REALTIME_OPTIONS_TOKEN,
        REALTIME_INSTANCE_ID_TOKEN,
        REALTIME_AUTHENTICATOR_TOKEN,
        REALTIME_PUBSUB_TOKEN,
        REALTIME_HOOKS_TOKEN,
        REALTIME_OFFLINE_QUEUE_TOKEN,
        REALTIME_PRESENCE_TOKEN,
        REALTIME_TRANSPORT_TOKEN,
      ],
    }
  }
}
