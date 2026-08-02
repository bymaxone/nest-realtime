/**
 * @fileoverview Public barrel for the server subpath (`.`).
 * @layer composition
 *
 * The names come from the shared runtime rather than from the modules that
 * define them, and by package specifier rather than by relative path. That is
 * what makes them the *same* objects the `./websocket` entry point registers:
 * each entry is a separate bundle, and a class or `Symbol` copied into two of
 * them is two different injection tokens.
 *
 * This barrel decides what is public. `./internal` resolves at runtime but
 * promises nothing, so an export missing here is not part of the API.
 */
export {
  BymaxRealtimeModule,
  composeRoomId,
  ConnectionRegistry,
  InMemoryPubSub,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_ERROR_CODES,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
  RealtimeService,
  RedisOfflineQueue,
  RedisRealtimePubSub,
  RESERVED_EVENT_NAMES,
  ROOM_PREFIXES,
} from '@bymax-one/nest-realtime/internal'

export type {
  AuthenticationResult,
  BymaxRealtimeModuleAsyncOptions,
  BymaxRealtimeModuleOptions,
  BymaxRealtimeModuleOptionsFactory,
  ConnectionAuthContext,
  ConnectionEventMeta,
  CorsConfig,
  IConnectionAuthenticator,
  IConnectionLifecycleHooks,
  IOfflineQueueStorage,
  IPresenceStorage,
  IRealtimePubSub,
  ITransport,
  OfflineQueuedEvent,
  PublicConnectionMeta,
  RealtimeErrorCode,
  RealtimeEvent,
  RealtimePubSubMessage,
  ReauthenticationPolicy,
  RedisOfflineQueueOptions,
  RedisRealtimePubSubOptions,
  ReservedEventName,
  RoomPrefix,
  SseOptions,
  SseRealtimeModuleAsyncOptions,
  SseRealtimeModuleOptions,
  TransportMode,
  WebSocketOptions,
} from '@bymax-one/nest-realtime/internal'
