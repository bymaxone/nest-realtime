/**
 * @fileoverview The dynamic NestJS module wiring SSE, WebSocket, or both transports.
 * @layer composition
 */
import { randomUUID } from 'node:crypto'
import { Global, Logger, Module } from '@nestjs/common'
import type { DynamicModule, Provider, Type } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../shared/constants/error-codes.constants'
import type { TransportMode } from '../shared/types/transport-mode.type'
import { applyDefaults } from './config/default-options'
import type { ResolvedRealtimeOptions } from './config/default-options'
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
import { RealtimePubSubSubscriber } from './pubsub/realtime-pubsub-subscriber'
import { OfflineQueueDeliveryService } from './offline-queue/offline-queue-delivery.service'
import { ConnectionRegistry } from './services/connection-registry.service'
import { EventIdGenerator } from './services/event-id-generator.service'
import { RealtimeService } from './services/realtime.service'
import { ReauthenticationService } from './services/reauthentication.service'
import { RoomRegistry } from './services/room-registry.service'
import { EventReplayBuffer } from './transports/sse/event-replay-buffer'
import { HeartbeatService } from './transports/sse/heartbeat.service'
import { SseSubscriptionHandler } from './transports/sse/sse-subscription.handler'
import { SseTransport } from './transports/sse/sse.transport'
import { WebSocketTransport } from './transports/websocket/websocket.transport'
import { RealtimeGateway } from './transports/websocket/realtime.gateway'
import { CompositeTransport } from './transports/composite/composite.transport'

/**
 * Assert that the required WebSocket peer packages are resolvable.
 *
 * Called before registering WS providers so the consumer receives a clear,
 * actionable error instead of a confusing `Cannot find module` at boot time.
 * An optional `resolver` parameter makes this testable without touching the
 * file system.
 */
export function assertWsPeerDeps(resolver: (id: string) => string = require.resolve): void {
  try {
    resolver('@nestjs/websockets')
    resolver('socket.io')
  } catch {
    throw new Error(
      "[BymaxRealtimeModule] transport 'websocket'|'both' requires '@nestjs/websockets' and " +
        "'socket.io' — install them, or switch to transport: 'sse'.",
    )
  }
}

/** Common providers required by all transport modes. */
function buildCommonProviders(
  resolved: BymaxRealtimeModuleOptions,
  instanceId: string,
): Provider[] {
  return [
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
    RealtimeService,
    ReauthenticationService,
    OfflineQueueDeliveryService,
  ]
}

/** Build transport-specific providers + the REALTIME_TRANSPORT_TOKEN binding. */
function buildTransportProviders(resolved: ResolvedRealtimeOptions): {
  providers: Provider[]
  controllers: Parameters<typeof createSseController>[0][]
  gateways: Provider[]
} {
  const transport = resolved.transport
  const providers: Provider[] = []
  const controllers: Parameters<typeof createSseController>[0][] = []
  const gateways: Provider[] = []

  if (transport === 'sse') {
    providers.push(SseTransport, SseSubscriptionHandler, RealtimePubSubSubscriber)
    providers.push({ provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport })
    controllers.push(resolved.sse.endpoint)
  } else if (transport === 'websocket') {
    assertWsPeerDeps()
    providers.push(WebSocketTransport)
    providers.push({ provide: REALTIME_TRANSPORT_TOKEN, useExisting: WebSocketTransport })
    gateways.push(RealtimeGateway)
  } else {
    // 'both'
    assertWsPeerDeps()
    providers.push(
      SseTransport,
      WebSocketTransport,
      CompositeTransport,
      SseSubscriptionHandler,
      RealtimePubSubSubscriber,
    )
    providers.push({ provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport })
    controllers.push(resolved.sse.endpoint)
    gateways.push(RealtimeGateway)
  }

  return { providers, controllers, gateways }
}

/**
 * Legacy async transport providers — registered when no synchronous `transport`
 * hint is supplied. Every transport is wired and `REALTIME_TRANSPORT_TOKEN`
 * resolves the active one at runtime from the resolved options. This path boots
 * Socket.IO and requires the WS peer deps regardless of the configured mode.
 */
function buildLegacyAsyncTransportProviders(): Provider[] {
  return [
    SseTransport,
    SseSubscriptionHandler,
    WebSocketTransport,
    CompositeTransport,
    RealtimeGateway,
    RealtimePubSubSubscriber,
    {
      provide: REALTIME_TRANSPORT_TOKEN,
      useFactory: (
        opts: BymaxRealtimeModuleOptions,
        sse: SseTransport,
        ws: WebSocketTransport,
        composite: CompositeTransport,
      ) => {
        if (opts.transport === 'sse') return sse
        if (opts.transport === 'websocket') return ws
        return composite
      },
      inject: [REALTIME_OPTIONS_TOKEN, SseTransport, WebSocketTransport, CompositeTransport],
    },
  ]
}

/**
 * Build the async-mode transport providers and SSE controllers, mirroring
 * `forRoot`'s conditional registration.
 *
 * When a synchronous `transport` hint is supplied, WebSocket providers (and the
 * gateway) are registered only for `'websocket'`/`'both'`, the SSE controller
 * only for `'sse'`/`'both'`, and the WS peer dependencies are asserted up front —
 * so an SSE-only setup never registers the gateway, never boots Socket.IO, and
 * never requires the optional WS peer deps. Without the hint, the legacy path
 * registers every transport and resolves the active one at runtime.
 */
function buildAsyncTransportProviders(mode: TransportMode | undefined): {
  providers: Provider[]
  controllers: Type<unknown>[]
} {
  if (mode === 'sse') {
    return {
      providers: [
        SseTransport,
        SseSubscriptionHandler,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      ],
      controllers: [createSseController('/events')],
    }
  }
  if (mode === 'websocket') {
    assertWsPeerDeps()
    return {
      providers: [
        WebSocketTransport,
        RealtimeGateway,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: WebSocketTransport },
      ],
      controllers: [],
    }
  }
  if (mode === 'both') {
    assertWsPeerDeps()
    return {
      providers: [
        SseTransport,
        SseSubscriptionHandler,
        WebSocketTransport,
        CompositeTransport,
        RealtimeGateway,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport },
      ],
      controllers: [createSseController('/events')],
    }
  }
  return {
    providers: buildLegacyAsyncTransportProviders(),
    controllers: [createSseController('/events')],
  }
}

/**
 * Realtime module — supports SSE, WebSocket, or both transports. Registered
 * globally so a single configuration serves the whole application.
 */
@Global()
@Module({})
export class BymaxRealtimeModule {
  private static readonly logger = new Logger(BymaxRealtimeModule.name)

  /**
   * Validate a raw async factory result, enforce the optional synchronous
   * `transport` hint, apply defaults, and log the bootstrap line.
   *
   * @throws when the factory returned nothing, the options are invalid, or the
   *   resolved transport disagrees with the synchronous hint used to gate
   *   provider registration.
   */
  private static resolveAsyncOptions(
    raw: BymaxRealtimeModuleOptions | null | undefined,
    transportHint: TransportMode | undefined,
    instanceId: string,
    source: string,
  ): ResolvedRealtimeOptions {
    if (!raw) {
      throw new Error(`${REALTIME_ERROR_CODES.INVALID_OPTIONS}: ${source} returned nothing`)
    }
    validateOptions(raw)
    if (transportHint !== undefined && raw.transport !== transportHint) {
      throw new Error(
        `${REALTIME_ERROR_CODES.INVALID_OPTIONS}: forRootAsync transport hint '${transportHint}' ` +
          `does not match the resolved transport '${raw.transport}'`,
      )
    }
    const resolved = applyDefaults(raw)
    BymaxRealtimeModule.logger.log(
      `Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`,
    )
    return resolved
  }

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

    const instanceId = randomUUID()

    if (!resolved.pubsub && process.env['NODE_ENV'] === 'production') {
      BymaxRealtimeModule.logger.warn(
        'No IRealtimePubSub provided in production — single-instance only. Provide a Redis-backed IRealtimePubSub for horizontal scaling.',
      )
    }

    const common = buildCommonProviders(resolved, instanceId)
    const {
      providers: transportProviders,
      controllers,
      gateways,
    } = buildTransportProviders(resolved)

    BymaxRealtimeModule.logger.log(
      `Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`,
    )

    return {
      module: BymaxRealtimeModule,
      controllers: controllers.map((ep) => createSseController(ep)),
      providers: [...common, ...transportProviders, ...gateways],
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
   * SSE controller to the fixed default endpoint `/events`. Consumers that need
   * a non-default endpoint with async configuration should use `forRoot` and
   * pre-resolve the options before passing them.
   *
   * Pass a synchronous `transport` hint to gate WebSocket wiring exactly as
   * `forRoot` does — an SSE-only application then never registers the gateway,
   * never boots Socket.IO, and never requires the optional WS peer deps. Without
   * the hint, every transport provider is registered and the active one is
   * resolved at runtime from the factory result.
   *
   * @example
   * ```ts
   * BymaxRealtimeModule.forRootAsync({
   *   transport: 'sse',
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
    const patterns = [
      asyncOptions.useFactory,
      asyncOptions.useClass,
      asyncOptions.useExisting,
    ].filter((pattern) => pattern !== undefined)
    if (patterns.length !== 1) {
      throw new Error(
        `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: forRootAsync requires exactly one of useFactory, useClass, or useExisting (received ${patterns.length})`,
      )
    }

    const FACTORY_TOKEN = Symbol('REALTIME_OPTIONS_FACTORY')
    const instanceId = randomUUID()

    const resolvedOptionsProvider: Provider = asyncOptions.useFactory
      ? {
          provide: REALTIME_OPTIONS_TOKEN,
          useFactory: async (...args: unknown[]) =>
            BymaxRealtimeModule.resolveAsyncOptions(
              await asyncOptions.useFactory!(...args),
              asyncOptions.transport,
              instanceId,
              'useFactory',
            ),
          inject: [...(asyncOptions.inject ?? [])],
        }
      : {
          provide: REALTIME_OPTIONS_TOKEN,
          useFactory: async (factory: BymaxRealtimeModuleOptionsFactory) =>
            BymaxRealtimeModule.resolveAsyncOptions(
              await factory.createRealtimeOptions(),
              asyncOptions.transport,
              instanceId,
              'options factory',
            ),
          inject: [asyncOptions.useClass ? FACTORY_TOKEN : asyncOptions.useExisting!],
        }

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
      useFactory: (opts: BymaxRealtimeModuleOptions) => {
        if (!opts.pubsub && process.env['NODE_ENV'] === 'production') {
          BymaxRealtimeModule.logger.warn(
            'No IRealtimePubSub provided in production — single-instance only. Provide a Redis-backed IRealtimePubSub for horizontal scaling.',
          )
        }
        return opts.pubsub ?? new InMemoryPubSub()
      },
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const hooksProvider: Provider = {
      provide: REALTIME_HOOKS_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.hooks ?? {},
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const offlineQueueProvider: Provider = {
      provide: REALTIME_OFFLINE_QUEUE_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.offlineQueue,
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    const presenceProvider: Provider = {
      provide: REALTIME_PRESENCE_TOKEN,
      useFactory: (opts: BymaxRealtimeModuleOptions) => opts.presence,
      inject: [REALTIME_OPTIONS_TOKEN],
    }

    // Transport providers (and the SSE controller) mirror forRoot's conditional
    // registration when a synchronous `transport` hint is supplied; otherwise the
    // legacy path registers every transport and resolves the active one at runtime.
    const { providers: transportProviders, controllers } = buildAsyncTransportProviders(
      asyncOptions.transport,
    )

    const providers: Provider[] = [
      ...factoryClassProvider,
      resolvedOptionsProvider,
      authenticatorProvider,
      pubsubProvider,
      hooksProvider,
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      offlineQueueProvider,
      presenceProvider,
      ConnectionRegistry,
      RoomRegistry,
      EventIdGenerator,
      EventReplayBuffer,
      HeartbeatService,
      RealtimeService,
      ReauthenticationService,
      OfflineQueueDeliveryService,
      ...transportProviders,
      ...(asyncOptions.extraProviders ?? []),
    ]

    return {
      module: BymaxRealtimeModule,
      imports: asyncOptions.imports ?? [],
      providers,
      controllers,
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
