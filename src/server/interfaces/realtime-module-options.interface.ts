/**
 * @fileoverview Module configuration contracts (sync + async dynamic module).
 * @layer contracts
 */
import type { Abstract, ModuleMetadata, Provider, Type } from '@nestjs/common'
import type { TransportMode } from '../../shared/types/transport-mode.type'
import type {
  IConnectionAuthenticator,
  AuthenticationResult,
} from './connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from './connection-lifecycle-hooks.interface'
import type { IRealtimePubSub } from './realtime-pubsub.interface'
import type { IOfflineQueueStorage } from './offline-queue-storage.interface'
import type { IPresenceStorage } from './presence-storage.interface'

/** CORS configuration shared by the SSE and WebSocket transports. */
export interface CorsConfig {
  origin?: string | readonly string[] | boolean
  credentials?: boolean
  methods?: readonly string[]
}

/**
 * SSE-transport-specific options.
 *
 * CORS for the SSE endpoint is intentionally not configured here: the endpoint is a
 * standard HTTP GET, so cross-origin access is controlled at the NestJS application
 * level (`app.enableCors(...)`). `CorsConfig` applies to the WebSocket transport.
 */
export interface SseOptions {
  endpoint?: string
  heartbeatMs?: number
  replayBufferSize?: number
  maxConnectionsPerUser?: number
  emitConnectionEvent?: boolean
}

/** WebSocket-transport-specific options. */
export interface WebSocketOptions {
  namespace?: string
  cors?: CorsConfig
  maxHttpBufferSize?: number
  pingIntervalMs?: number
  pingTimeoutMs?: number
  maxConnectionsPerUser?: number
  /**
   * Emit a `connection:established` event to the client immediately after a
   * successful WebSocket handshake. Defaults to `true`.
   *
   * Transport-neutral for WebSocket and independent of `sse.emitConnectionEvent`,
   * so toggling the SSE flag never changes WebSocket behavior.
   */
  emitConnectionEvent?: boolean
  redisAdapter?: {
    /**
     * The ioredis client used by `@socket.io/redis-adapter`. Typed `unknown` so
     * the library never imports `ioredis`; the consumer passes a concrete client
     * and the WebSocket transport calls `.duplicate()` for the subscriber.
     */
    pubClient: unknown
  }
}

/** Periodic re-authentication policy for long-lived connections. */
export interface ReauthenticationPolicy {
  intervalSeconds?: number
  onFailure?: 'disconnect' | 'event'
  cacheTtlMs?: number
}

/** Synchronous module configuration. */
export interface BymaxRealtimeModuleOptions {
  transport: TransportMode
  service?: { name: string; version: string }
  authenticator: IConnectionAuthenticator
  tenantResolver?: (auth: AuthenticationResult) => string | undefined
  hooks?: IConnectionLifecycleHooks
  pubsub?: IRealtimePubSub
  offlineQueue?: IOfflineQueueStorage
  presence?: IPresenceStorage
  sse?: SseOptions
  websocket?: WebSocketOptions
  reauthenticationPolicy?: ReauthenticationPolicy
}

/**
 * Synchronous configuration for `BymaxRealtimeModule`, which serves SSE only.
 *
 * `transport` is narrowed rather than validated at runtime: WebSocket lives
 * behind `@bymax-one/nest-realtime/websocket`, so asking this module for it is
 * a mistake the compiler can catch.
 */
export type SseRealtimeModuleOptions = Omit<BymaxRealtimeModuleOptions, 'transport'> & {
  transport: 'sse'
}

/**
 * Synchronous configuration for `BymaxRealtimeWebSocketModule`, which serves
 * `'websocket'` and `'both'`. An SSE-only application wants the root module.
 */
export type WebSocketRealtimeModuleOptions = Omit<BymaxRealtimeModuleOptions, 'transport'> & {
  transport: 'websocket' | 'both'
}

/** A factory that builds module options (async dynamic-module pattern). */
export interface BymaxRealtimeModuleOptionsFactory {
  createRealtimeOptions(): BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
}

/** Asynchronous module configuration — the standard NestJS dynamic-module pattern. */
export interface BymaxRealtimeModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * The transport this registration wires. Required, not a hint: providers and
   * controllers are fixed at decoration time, long before a factory runs, so the
   * module cannot discover its own transport later. It MUST equal the
   * `transport` the factory resolves; a mismatch fails fast at bootstrap.
   */
  transport: TransportMode
  /**
   * Factory producing the options, receiving whatever `inject` resolves.
   *
   * Declared in method shorthand on purpose: that signature is bivariant, so a
   * consumer can annotate the parameters with the real provider types
   * (`(cfg: ConfigService) => ...`) instead of `unknown`. An arrow-property
   * signature would be checked contravariantly under `strictFunctionTypes` and
   * reject every typed factory, which is the whole point of `inject`.
   */
  useFactory?(...args: unknown[]): BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
  /**
   * Providers to resolve and pass to `useFactory`, positionally.
   *
   * `Abstract<unknown>` is included because Nest's own injectable tokens are
   * abstract classes — `ModuleRef` among them — and `Type<unknown>` alone is a
   * non-abstract constructor type that excludes them.
   */
  inject?: readonly (string | symbol | Type<unknown> | Abstract<unknown>)[]
  useExisting?: Type<BymaxRealtimeModuleOptionsFactory>
  useClass?: Type<BymaxRealtimeModuleOptionsFactory>
  /**
   * Additional providers to register alongside the module (e.g. the authenticator
   * class when it is a NestJS-managed injectable).
   */
  extraProviders?: Provider[]
}

/** Asynchronous configuration for `BymaxRealtimeModule` (SSE only). */
export type SseRealtimeModuleAsyncOptions = Omit<BymaxRealtimeModuleAsyncOptions, 'transport'> & {
  transport: 'sse'
}

/** Asynchronous configuration for `BymaxRealtimeWebSocketModule`. */
export type WebSocketRealtimeModuleAsyncOptions = Omit<
  BymaxRealtimeModuleAsyncOptions,
  'transport'
> & { transport: 'websocket' | 'both' }
