/**
 * @fileoverview The shared runtime both public entry points build on.
 * @layer composition
 *
 * NOT PUBLIC API. It is present in the `exports` map because it has to be
 * resolvable at runtime, not because consumers should import it — nothing here
 * is covered by the package's compatibility promise.
 *
 * It exists because entry points are separate bundles. Anything reached from
 * two of them by a relative path is *copied* into each, and a copied class or
 * `Symbol` is a different injection token: registering a module from one entry
 * and injecting its services from another then fails with
 * `UnknownElementException`. Owning the shared graph in one bundle that both
 * import by package specifier gives it a single identity in ESM and CommonJS
 * alike — which code splitting alone could not, since esbuild splits ESM only.
 *
 * Anything that touches `@nestjs/websockets`, `@nestjs/platform-socket.io` or
 * `socket.io` stays out: this bundle is reachable from the root, and pulling
 * them in here would put them back in an SSE-only install.
 */

// Composition — the seam each entry point supplies its wiring to.
export { composeForRoot, composeForRootAsync } from '../server/composition/realtime-module.factory'
export type {
  TransportRegistration,
  TransportWiring,
} from '../server/composition/transport-wiring.interface'
export { sseWiring } from '../server/composition/sse-wiring'
export { BymaxRealtimeModule } from '../server/realtime.module'

// Injection tokens — `Symbol`s, and therefore identity-sensitive.
export {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from '../server/constants/injection-tokens.constants'

// Services and registries — classes used as injection tokens.
export { ConnectionRegistry } from '../server/services/connection-registry.service'
export { EventIdGenerator } from '../server/services/event-id-generator.service'
export { RealtimeService } from '../server/services/realtime.service'
export { ReauthenticationService } from '../server/services/reauthentication.service'
export { RoomRegistry } from '../server/services/room-registry.service'
export { OfflineQueueDeliveryService } from '../server/offline-queue/offline-queue-delivery.service'

// SSE transport — shared because `'both'` composes it with WebSocket.
export { EventReplayBuffer } from '../server/transports/sse/event-replay-buffer'
export { HeartbeatService } from '../server/transports/sse/heartbeat.service'
export { SseSubscriptionHandler } from '../server/transports/sse/sse-subscription.handler'
export { SseTransport } from '../server/transports/sse/sse.transport'
export { createSseController } from '../server/factories/sse-controller.factory'

// Pub/sub.
export { InMemoryPubSub } from '../server/pubsub/in-memory-pubsub'
export { RealtimePubSubSubscriber } from '../server/pubsub/realtime-pubsub-subscriber'
export { RedisRealtimePubSub } from '../server/pubsub/redis-realtime-pubsub'
export type { RedisRealtimePubSubOptions } from '../server/pubsub/redis-realtime-pubsub'

// Offline queue.
export { RedisOfflineQueue } from '../server/offline-queue/redis-offline-queue'
export type { RedisOfflineQueueOptions } from '../server/offline-queue/redis-offline-queue'

// Utilities and contracts.
export { composeRoomId } from '../server/utils/compose-room-id'
export { parseCookieHeader } from '../server/utils/parse-cookie-header'
export * from '../server/interfaces'
export { ROOM_PREFIXES, RESERVED_EVENT_NAMES, REALTIME_ERROR_CODES } from '../shared'
export type {
  PublicConnectionMeta,
  RealtimeErrorCode,
  RealtimeEvent,
  ReservedEventName,
  RoomPrefix,
  TransportMode,
} from '../shared'
