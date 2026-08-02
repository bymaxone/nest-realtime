/**
 * @fileoverview Transport-agnostic composition shared by every entry point.
 * @layer composition
 */
import { randomUUID } from 'node:crypto'
import type { DynamicModule, Logger, Provider, Type } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { applyDefaults } from '../config/default-options'
import type { ResolvedRealtimeOptions } from '../config/default-options'
import { validateOptions } from '../config/validate-options'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from '../constants/injection-tokens.constants'
import { createSseController } from '../factories/sse-controller.factory'
import type {
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptions,
} from '../interfaces/realtime-module-options.interface'
import { OfflineQueueDeliveryService } from '../offline-queue/offline-queue-delivery.service'
import { InMemoryPubSub } from '../pubsub/in-memory-pubsub'
import { ConnectionRegistry } from '../services/connection-registry.service'
import { EventIdGenerator } from '../services/event-id-generator.service'
import { RealtimeService } from '../services/realtime.service'
import { ReauthenticationService } from '../services/reauthentication.service'
import { RoomRegistry } from '../services/room-registry.service'
import { EventReplayBuffer } from '../transports/sse/event-replay-buffer'
import { HeartbeatService } from '../transports/sse/heartbeat.service'
import type { TransportWiring } from './transport-wiring.interface'

/** The provider tokens every entry point re-exports to the consuming module. */
const EXPORTED_TOKENS = [
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
]

/** Services shared by every transport mode, independent of the wiring. */
const SHARED_SERVICES = [
  ConnectionRegistry,
  RoomRegistry,
  EventIdGenerator,
  EventReplayBuffer,
  HeartbeatService,
  RealtimeService,
  ReauthenticationService,
  OfflineQueueDeliveryService,
]

/**
 * Reject a transport the entry point cannot serve, naming the one that can.
 *
 * The check exists because the entry points are the mechanism that keeps the
 * Socket.IO stack out of an SSE-only install: a consumer who asks the root
 * module for `'websocket'` is not making a typo, they are on the wrong import,
 * and the message has to say so rather than fail later on a missing provider.
 */
function assertModeSupported(
  wiring: TransportWiring,
  mode: BymaxRealtimeModuleOptions['transport'],
  moduleName: string,
): void {
  if (wiring.modes.includes(mode)) return
  const alternative =
    mode === 'sse'
      ? "'BymaxRealtimeModule' from '@bymax-one/nest-realtime'"
      : "'BymaxRealtimeWebSocketModule' from '@bymax-one/nest-realtime/websocket'"
  throw new Error(
    `[${moduleName}] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: transport '${mode}' is not served ` +
      `by this module (it serves ${wiring.modes.map((m) => `'${m}'`).join(', ')}). Use ${alternative}.`,
  )
}

/**
 * Warn once when a production process would be limited to a single instance.
 *
 * Only for transports that carry SSE. `IRealtimePubSub` is read by the SSE
 * transport and its subscriber and by nothing else — a WebSocket-only
 * application scales horizontally through `websocket.redisAdapter`, so telling
 * it to provide a pub/sub would point at the wrong mechanism entirely.
 */
function warnIfSingleInstance(
  pubsub: unknown,
  transport: BymaxRealtimeModuleOptions['transport'],
  logger: Logger,
): void {
  if (transport === 'websocket') return
  if (!pubsub && process.env['NODE_ENV'] === 'production') {
    logger.warn(
      'No IRealtimePubSub provided in production — single-instance only. Provide a Redis-backed IRealtimePubSub for horizontal scaling.',
    )
  }
}

/** Providers whose values come straight from a resolved, synchronous config. */
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
    ...SHARED_SERVICES,
  ]
}

/**
 * Compose the synchronous dynamic module for an entry point.
 *
 * @throws when the options are invalid or name a transport this entry point
 *   does not serve.
 */
export function composeForRoot(
  moduleClass: Type<unknown>,
  wiring: TransportWiring,
  logger: Logger,
  options: BymaxRealtimeModuleOptions,
): DynamicModule {
  validateOptions(options)
  assertModeSupported(wiring, options.transport, moduleClass.name)
  const resolved: ResolvedRealtimeOptions = applyDefaults(options)
  const instanceId = randomUUID()

  warnIfSingleInstance(resolved.pubsub, resolved.transport, logger)

  const { providers, endpoints, gateways } = wiring.build(resolved)
  logger.log(`Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`)

  return {
    module: moduleClass,
    controllers: endpoints.map((endpoint) => createSseController(endpoint)),
    providers: [...buildCommonProviders(resolved, instanceId), ...providers, ...gateways],
    exports: EXPORTED_TOKENS,
  }
}

/**
 * Validate an async factory result and enforce the declared transport.
 *
 * @throws when the factory returned nothing, the options are invalid, or the
 *   resolved transport disagrees with the one the module was registered for.
 */
function resolveAsyncOptions(
  raw: BymaxRealtimeModuleOptions | null | undefined,
  declaredMode: BymaxRealtimeModuleOptions['transport'],
  instanceId: string,
  source: string,
  logger: Logger,
  moduleName: string,
): ResolvedRealtimeOptions {
  if (!raw) {
    throw new Error(`${REALTIME_ERROR_CODES.INVALID_OPTIONS}: ${source} returned nothing`)
  }
  validateOptions(raw)
  if (raw.transport !== declaredMode) {
    throw new Error(
      `[${moduleName}] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: forRootAsync was registered for ` +
        `transport '${declaredMode}' but the factory resolved '${raw.transport}'`,
    )
  }
  const resolved = applyDefaults(raw)
  logger.log(`Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`)
  return resolved
}

/**
 * Compose the asynchronous dynamic module for an entry point.
 *
 * `transport` is required here, unlike a hint that could be omitted: providers
 * and controllers are fixed at decoration time, long before a factory runs, so
 * the module cannot discover its own transport later. Declaring it is what lets
 * an SSE application register no gateway at all.
 *
 * @throws when the registration names no factory pattern, names more than one,
 *   or names a transport this entry point does not serve.
 */
export function composeForRootAsync(
  moduleClass: Type<unknown>,
  wiring: TransportWiring,
  logger: Logger,
  asyncOptions: BymaxRealtimeModuleAsyncOptions,
): DynamicModule {
  const moduleName = moduleClass.name
  const patterns = [
    asyncOptions.useFactory,
    asyncOptions.useClass,
    asyncOptions.useExisting,
  ].filter((pattern) => pattern !== undefined)
  if (patterns.length !== 1) {
    throw new Error(
      `[${moduleName}] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: forRootAsync requires exactly one of useFactory, useClass, or useExisting (received ${patterns.length})`,
    )
  }
  assertModeSupported(wiring, asyncOptions.transport, moduleName)

  const FACTORY_TOKEN = Symbol('REALTIME_OPTIONS_FACTORY')
  const instanceId = randomUUID()
  const resolve = (
    raw: BymaxRealtimeModuleOptions | null | undefined,
    source: string,
  ): ResolvedRealtimeOptions =>
    resolveAsyncOptions(raw, asyncOptions.transport, instanceId, source, logger, moduleName)

  const resolvedOptionsProvider: Provider = asyncOptions.useFactory
    ? {
        provide: REALTIME_OPTIONS_TOKEN,
        useFactory: async (...args: unknown[]) =>
          resolve(await asyncOptions.useFactory!(...args), 'useFactory'),
        inject: [...(asyncOptions.inject ?? [])],
      }
    : {
        provide: REALTIME_OPTIONS_TOKEN,
        useFactory: async (factory: { createRealtimeOptions: () => unknown }) =>
          resolve(
            (await factory.createRealtimeOptions()) as BymaxRealtimeModuleOptions,
            'createRealtimeOptions',
          ),
        inject: [asyncOptions.useExisting ?? FACTORY_TOKEN],
      }

  const factoryClassProvider: Provider[] = asyncOptions.useClass
    ? [{ provide: FACTORY_TOKEN, useClass: asyncOptions.useClass }]
    : []

  const fromOptions = (
    token: symbol,
    read: (opts: BymaxRealtimeModuleOptions) => unknown,
  ): Provider => ({ provide: token, useFactory: read, inject: [REALTIME_OPTIONS_TOKEN] })

  const { providers: transportProviders, controllers } = wiring.buildAsync(asyncOptions.transport)

  return {
    module: moduleClass,
    imports: asyncOptions.imports ?? [],
    controllers,
    providers: [
      ...factoryClassProvider,
      resolvedOptionsProvider,
      fromOptions(REALTIME_AUTHENTICATOR_TOKEN, (opts) => opts.authenticator),
      fromOptions(REALTIME_PUBSUB_TOKEN, (opts) => {
        warnIfSingleInstance(opts.pubsub, opts.transport, logger)
        return opts.pubsub ?? new InMemoryPubSub()
      }),
      fromOptions(REALTIME_HOOKS_TOKEN, (opts) => opts.hooks ?? {}),
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      fromOptions(REALTIME_OFFLINE_QUEUE_TOKEN, (opts) => opts.offlineQueue),
      fromOptions(REALTIME_PRESENCE_TOKEN, (opts) => opts.presence),
      ...SHARED_SERVICES,
      ...transportProviders,
      ...(asyncOptions.extraProviders ?? []),
    ],
    exports: EXPORTED_TOKENS,
  }
}
