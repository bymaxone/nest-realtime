/**
 * @fileoverview Module configuration contracts (sync + async dynamic module).
 * @layer contracts
 */
import type { ModuleMetadata, Provider, Type } from '@nestjs/common'
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

/** A factory that builds module options (async dynamic-module pattern). */
export interface BymaxRealtimeModuleOptionsFactory {
  createRealtimeOptions(): BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
}

/** Asynchronous module configuration — the standard NestJS dynamic-module pattern. */
export interface BymaxRealtimeModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (
    ...args: unknown[]
  ) => BymaxRealtimeModuleOptions | Promise<BymaxRealtimeModuleOptions>
  inject?: readonly (string | symbol | Type<unknown>)[]
  useExisting?: Type<BymaxRealtimeModuleOptionsFactory>
  useClass?: Type<BymaxRealtimeModuleOptionsFactory>
  /**
   * Additional providers to register alongside the module (e.g. the authenticator
   * class when it is a NestJS-managed injectable).
   */
  extraProviders?: Provider[]
}
