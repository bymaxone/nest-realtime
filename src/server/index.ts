/**
 * @fileoverview Public barrel for the server subpath (`.`).
 * @layer composition
 */

// Module
export { BymaxRealtimeModule } from './realtime.module'

// Public services
export { RealtimeService } from './services/realtime.service'
export { ConnectionRegistry } from './services/connection-registry.service'

// Default pub/sub (useful for tests; consumers rarely instantiate it directly)
export { InMemoryPubSub } from './pubsub/in-memory-pubsub'

// Optional Redis-backed implementations (require ioredis peer)
export { RedisRealtimePubSub } from './pubsub/redis-realtime-pubsub'
export type { RedisRealtimePubSubOptions } from './pubsub/redis-realtime-pubsub'
export { RedisOfflineQueue } from './offline-queue/redis-offline-queue'
export type { RedisOfflineQueueOptions } from './offline-queue/redis-offline-queue'

// Contracts
export type {
  ITransport,
  IConnectionAuthenticator,
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionLifecycleHooks,
  ConnectionEventMeta,
  IRealtimePubSub,
  RealtimePubSubMessage,
  IOfflineQueueStorage,
  OfflineQueuedEvent,
  IPresenceStorage,
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptionsFactory,
  SseOptions,
  WebSocketOptions,
  CorsConfig,
  ReauthenticationPolicy,
} from './interfaces'

// DI tokens
export {
  REALTIME_OPTIONS_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
} from './constants/injection-tokens.constants'

// Room helpers
export { composeRoomId } from './utils/compose-room-id'

// Convenience re-exports from the shared subpath
export type {
  TransportMode,
  RealtimeEvent,
  PublicConnectionMeta,
  RoomPrefix,
  ReservedEventName,
  RealtimeErrorCode,
} from '../shared'
export { ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES } from '../shared'
