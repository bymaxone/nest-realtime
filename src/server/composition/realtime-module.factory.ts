/**
 * @fileoverview Transport-agnostic composition shared by every entry point.
 * @layer composition
 */
import { randomUUID } from 'node:crypto'
import type { DynamicModule, Logger, Provider, Type } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { applyDefaults } from '../config/default-options'
import { dropUnset } from '../config/drop-unset'
import { awaitHostResult, guardHostReads } from '../config/guard-host-reads'
import type { ResolvedRealtimeOptions } from '../config/default-options'
import { validateOptions } from '../config/validate-options'
import {
  assertExtraProviders,
  assertOptionsObject,
  assertSseEndpoint,
} from '../config/validate-shapes'
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
import type { IConnectionLifecycleHooks } from '../interfaces/connection-lifecycle-hooks.interface'
import type {
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptions,
} from '../interfaces/realtime-module-options.interface'
import { RealtimeMetricsTally } from '../observability/realtime-metrics-tally'
import { RealtimeTracing } from '../observability/realtime-tracing'
import { OfflineQueueDeliveryService } from '../offline-queue/offline-queue-delivery.service'
import { InMemoryPubSub } from '../pubsub/in-memory-pubsub'
import { ConnectionRegistry } from '../services/connection-registry.service'
import { EventIdGenerator } from '../services/event-id-generator.service'
import { RealtimeService } from '../services/realtime.service'
import { AuthenticationGate } from '../services/authentication-gate.service'
import { ConnectionAdmission } from '../services/connection-admission.service'
import { ReauthenticationService } from '../services/reauthentication.service'
import { RoomRegistry } from '../services/room-registry.service'
import { EventReplayBuffer } from '../transports/sse/event-replay-buffer'
import { HeartbeatService } from '../transports/sse/heartbeat.service'
import { logEvent } from '../utils/log-event'
import { normalizeEndpointPath } from '../utils/normalize-endpoint-path'
import { hostMethod, readHostKey } from '../utils/read-host-key'
import { realtimeError } from '../utils/realtime-error'
import type { TransportWiring } from './transport-wiring.interface'

/**
 * The route the async path binds the SSE controller to when the registration
 * names none. Deliberately not `DEFAULT_SSE.endpoint`: changing it would move
 * the route of every application already registered through `forRootAsync`.
 */
const DEFAULT_ASYNC_SSE_ENDPOINT = '/events'

/** The provider tokens every entry point re-exports to the consuming module. */
const EXPORTED_TOKENS = [
  RealtimeService,
  ConnectionRegistry,
  RealtimeMetricsTally,
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
  AuthenticationGate,
  ConnectionAdmission,
  RealtimeMetricsTally,
  RealtimeTracing,
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
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `transport '${mode}' is not served ` +
      `by this module (it serves ${wiring.modes.map((m) => `'${m}'`).join(', ')}). Use ${alternative}.`,
    { who: moduleName },
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
    logEvent(
      logger,
      'warn',
      'REALTIME_PUBSUB_NOT_PROVIDED',
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
    { provide: REALTIME_HOOKS_TOKEN, useValue: resolved.hooks ?? NO_HOOKS },
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
  raw: BymaxRealtimeModuleOptions,
): DynamicModule {
  assertOptionsObject(raw, moduleClass.name)
  // Read once: what is validated is the plain copy that is resolved, whatever a getter would answer next.
  const options = guardHostReads('the options', () => dropUnset(raw))
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
 * Reject an `sseEndpoint` on a registration that serves no SSE route.
 *
 * A `'websocket'` registration builds no controller, so the option could only
 * ever be decorative — which is the failure mode the option exists to remove.
 *
 * @throws when `sseEndpoint` is set alongside `transport: 'websocket'`.
 */
function assertSseEndpointApplies(
  asyncOptions: BymaxRealtimeModuleAsyncOptions,
  moduleName: string,
): void {
  if (asyncOptions.sseEndpoint === undefined || asyncOptions.transport !== 'websocket') return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `sseEndpoint was set but transport 'websocket' registers no SSE controller — use 'both' to serve SSE too`,
    { who: moduleName },
  )
}

/**
 * Make the resolved options name the route the controller was actually bound to.
 *
 * Without this the options object handed to `REALTIME_OPTIONS_TOKEN` would carry
 * the `sse.endpoint` default while the route lived elsewhere, so anything
 * reading the configuration back — a health check, an OpenAPI document — would
 * be told the wrong path.
 *
 * @throws when the factory resolved an endpoint the async path cannot bind to.
 */
function bindSseEndpoint(
  resolved: ResolvedRealtimeOptions,
  declared: string | undefined,
  bound: string,
  moduleName: string,
): ResolvedRealtimeOptions {
  if (declared !== undefined && normalizeEndpointPath(declared) !== normalizeEndpointPath(bound)) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `the factory resolved an sse.endpoint that differs from the SSE route forRootAsync bound — ` +
        `controllers are registered before the factory runs, so declare the path as 'sseEndpoint' on the ` +
        `forRootAsync registration itself`,
      { who: moduleName },
    )
  }
  return Object.freeze({
    __proto__: null,
    ...resolved,
    sse: { __proto__: null, ...resolved.sse, endpoint: bound },
  })
}

/**
 * Validate an async factory result and enforce the declared transport.
 *
 * @returns The resolved options and the `sse.endpoint` the factory itself declared, read from the same
 *   plain copy that was validated.
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
): { resolved: ResolvedRealtimeOptions; declaredEndpoint: string | undefined } {
  if (raw === undefined || raw === null) {
    throw realtimeError(REALTIME_ERROR_CODES.INVALID_OPTIONS, `${source} returned nothing`)
  }
  assertOptionsObject(raw, moduleName)
  // Read once: what is validated is the plain copy that is resolved, whatever a getter would answer next.
  const options = guardHostReads('the options', () => dropUnset(raw))
  validateOptions(options)
  if (options.transport !== declaredMode) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `forRootAsync was registered for ` +
        `transport '${declaredMode}' but the factory resolved '${options.transport}'`,
      { who: moduleName },
    )
  }
  const resolved = applyDefaults(options)
  logger.log(`Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`)
  return { resolved, declaredEndpoint: options.sse?.endpoint }
}

/**
 * Whether a factory pattern is named: `undefined` and `null` both mean it is not. Counting the patterns and
 * choosing the provider have to use this one test, or a `null` is counted as the pattern in use and then
 * skipped when the provider is built.
 */
function isSet<T>(pattern: T | null | undefined): pattern is T {
  return pattern !== undefined && pattern !== null
}

/**
 * Refuse a registration that names no factory pattern or more than one.
 *
 * @throws when the number of `useFactory`, `useClass` and `useExisting` given is not exactly one.
 */
function assertOneFactoryPattern(
  asyncOptions: BymaxRealtimeModuleAsyncOptions,
  moduleName: string,
): void {
  const patterns = [
    asyncOptions.useFactory,
    asyncOptions.useClass,
    asyncOptions.useExisting,
  ].filter(isSet)
  if (patterns.length === 1) return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `forRootAsync requires exactly one of useFactory, useClass, or useExisting (received ${patterns.length})`,
    { who: moduleName },
  )
}

/** The provider of the resolved options, fed by whichever factory pattern the registration used. */
function buildOptionsProvider(
  asyncOptions: BymaxRealtimeModuleAsyncOptions,
  resolve: (
    raw: BymaxRealtimeModuleOptions | null | undefined,
    source: string,
  ) => ResolvedRealtimeOptions,
  factoryToken: symbol,
): Provider {
  if (isSet(asyncOptions.useFactory)) {
    return {
      provide: REALTIME_OPTIONS_TOKEN,
      useFactory: async (...args: unknown[]) =>
        resolve((await awaitHostResult(asyncOptions.useFactory!(...args))).value, 'useFactory'),
      inject: [...(asyncOptions.inject ?? [])],
    }
  }
  return {
    provide: REALTIME_OPTIONS_TOKEN,
    useFactory: async (factory: { createRealtimeOptions?: () => unknown } | null | undefined) => {
      const create = guardHostReads('the provider named by useExisting or useClass', () =>
        hostMethod(factory, 'createRealtimeOptions'),
      )
      if (typeof create !== 'function') {
        throw realtimeError(
          REALTIME_ERROR_CODES.INVALID_OPTIONS,
          'the provider named by useExisting or useClass must implement createRealtimeOptions',
        )
      }
      return resolve(
        (await awaitHostResult(create.call(factory))).value as BymaxRealtimeModuleOptions,
        'createRealtimeOptions',
      )
    },
    inject: [asyncOptions.useExisting ?? factoryToken],
  }
}

/** A provider that reads one value off the resolved options. */
function fromOptions(token: symbol, read: (opts: BymaxRealtimeModuleOptions) => unknown): Provider {
  return { provide: token, useFactory: read, inject: [REALTIME_OPTIONS_TOKEN] }
}

/** The providers each read off the resolved options, and the instance id the module was composed with. */
function buildOptionDerivedProviders(logger: Logger, instanceId: string): Provider[] {
  return [
    fromOptions(REALTIME_AUTHENTICATOR_TOKEN, (opts) => opts.authenticator),
    fromOptions(REALTIME_PUBSUB_TOKEN, (opts) => {
      warnIfSingleInstance(opts.pubsub, opts.transport, logger)
      return opts.pubsub ?? new InMemoryPubSub()
    }),
    fromOptions(REALTIME_HOOKS_TOKEN, (opts) => opts.hooks ?? NO_HOOKS),
    { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
    fromOptions(REALTIME_OFFLINE_QUEUE_TOKEN, (opts) => opts.offlineQueue),
    fromOptions(REALTIME_PRESENCE_TOKEN, (opts) => opts.presence),
  ]
}

/** Resolve what a factory returned: validate it, then name the route the controller was bound to. */
function buildResolver(
  asyncOptions: BymaxRealtimeModuleAsyncOptions,
  instanceId: string,
  boundSseEndpoint: string,
  logger: Logger,
  moduleName: string,
): (raw: BymaxRealtimeModuleOptions | null | undefined, source: string) => ResolvedRealtimeOptions {
  return (raw, source) => {
    const { resolved, declaredEndpoint } = resolveAsyncOptions(
      raw,
      asyncOptions.transport,
      instanceId,
      source,
      logger,
      moduleName,
    )
    if (asyncOptions.transport === 'websocket') return resolved
    return bindSseEndpoint(resolved, declaredEndpoint, boundSseEndpoint, moduleName)
  }
}

/** The hook table of a host that gave none: it holds no hook and has no prototype to inherit one from. */
const NO_HOOKS = { __proto__: null } as IConnectionLifecycleHooks

/** A host array copied, or the value as it is when it is not an array, so the checks that follow can refuse it. */
const copied = (value: unknown): unknown =>
  Array.isArray(value) ? [...(value as unknown[])] : value

/**
 * The keys of a `forRootAsync` registration the module reads, each read once and under the guard, as one plain object.
 * Every later read is of that object, so a getter or a proxy on the registration is asked once per key and a throw is
 * refused with the library's code and the host's error as its cause.
 */
function readRegistration(
  registration: BymaxRealtimeModuleAsyncOptions,
): BymaxRealtimeModuleAsyncOptions {
  return guardHostReads('the registration', () => ({
    __proto__: null,
    transport: readHostKey(registration, 'transport'),
    sseEndpoint: readHostKey(registration, 'sseEndpoint'),
    useFactory: readHostKey(registration, 'useFactory'),
    useClass: readHostKey(registration, 'useClass'),
    useExisting: readHostKey(registration, 'useExisting'),
    inject: copied(readHostKey(registration, 'inject')),
    imports: copied(readHostKey(registration, 'imports')),
    extraProviders: copied(readHostKey(registration, 'extraProviders')),
  })) as BymaxRealtimeModuleAsyncOptions
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
  assertOptionsObject(asyncOptions, moduleName)
  const registration = readRegistration(asyncOptions)
  assertOneFactoryPattern(registration, moduleName)
  assertModeSupported(wiring, registration.transport, moduleName)
  assertSseEndpoint('sseEndpoint', registration.sseEndpoint)
  assertSseEndpointApplies(registration, moduleName)
  guardHostReads('the registration', () => assertExtraProviders(registration.extraProviders))

  const FACTORY_TOKEN = Symbol('REALTIME_OPTIONS_FACTORY')
  const instanceId = randomUUID()
  const boundSseEndpoint = registration.sseEndpoint ?? DEFAULT_ASYNC_SSE_ENDPOINT
  const resolve = buildResolver(registration, instanceId, boundSseEndpoint, logger, moduleName)

  const factoryClassProvider: Provider[] = isSet(registration.useClass)
    ? [{ provide: FACTORY_TOKEN, useClass: registration.useClass }]
    : []

  const { providers: transportProviders, controllers } = wiring.buildAsync({
    mode: registration.transport,
    sseEndpoint: boundSseEndpoint,
  })

  return {
    module: moduleClass,
    imports: registration.imports ?? [],
    controllers,
    providers: [
      ...factoryClassProvider,
      buildOptionsProvider(registration, resolve, FACTORY_TOKEN),
      ...buildOptionDerivedProviders(logger, instanceId),
      ...SHARED_SERVICES,
      ...transportProviders,
      ...(registration.extraProviders ?? []),
    ],
    exports: EXPORTED_TOKENS,
  }
}
