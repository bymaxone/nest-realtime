/**
 * @fileoverview Cross-instance message bus contract for SSE horizontal scaling.
 * @layer contracts
 */

/** A single cross-instance fan-out message. */
export interface RealtimePubSubMessage {
  /** Operation type. */
  readonly op: 'emitToUser' | 'emitToTenant' | 'emitToRoom' | 'broadcast' | 'disconnect'
  /** Operation arguments — the concrete shape is narrowed per `op` at the call site. */
  readonly args: unknown
  /** Instance id that originated the message (used to avoid echo). */
  readonly origin: string
}

/**
 * Cross-instance message bus.
 *
 * The library provides `InMemoryPubSub` (the single-instance default) and ships a
 * reference Redis-backed implementation (`RedisRealtimePubSub`) for multi-instance
 * deployments. For WebSocket-only deployments, `@socket.io/redis-adapter` is the
 * recommended scaling primitive and `IRealtimePubSub` is not required.
 */
export interface IRealtimePubSub {
  /** Publish a message to all subscribers (the other instances). */
  publish(message: RealtimePubSubMessage): Promise<void>

  /** Subscribe to messages. Resolves to an async unsubscribe handle. */
  subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>>
}
