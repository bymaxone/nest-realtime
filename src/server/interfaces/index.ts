/**
 * @fileoverview Barrel for the public server-side contracts.
 * @layer contracts
 */
export type { ITransport } from './transport.interface'
export type {
  IConnectionAuthenticator,
  AuthenticationResult,
  ConnectionAuthContext,
} from './connection-authenticator.interface'
export type {
  IConnectionLifecycleHooks,
  ConnectionEventMeta,
} from './connection-lifecycle-hooks.interface'
export type { IRealtimePubSub, RealtimePubSubMessage } from './realtime-pubsub.interface'
export type { IOfflineQueueStorage, OfflineQueuedEvent } from './offline-queue-storage.interface'
export type { IPresenceStorage } from './presence-storage.interface'
export type {
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleOptionsFactory,
  CorsConfig,
  ReauthenticationPolicy,
  SseOptions,
  SseRealtimeModuleAsyncOptions,
  SseRealtimeModuleOptions,
  WebSocketOptions,
  WebSocketRealtimeModuleAsyncOptions,
  WebSocketRealtimeModuleOptions,
} from './realtime-module-options.interface'
