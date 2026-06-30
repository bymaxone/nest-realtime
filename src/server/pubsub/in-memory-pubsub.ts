/**
 * @fileoverview Default in-process pub/sub for single-instance deployments.
 * @layer infrastructure
 */
import { Injectable } from '@nestjs/common'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../interfaces/realtime-pubsub.interface'

/**
 * Default single-instance pub/sub.
 *
 * `publish` defers delivery one microtask (`await Promise.resolve()`) before
 * iterating handlers, matching Redis async-callback semantics. A handler that
 * throws is caught internally so the remaining handlers still receive the message.
 * Multi-instance deployments replace this with a Redis-backed `IRealtimePubSub`.
 */
@Injectable()
export class InMemoryPubSub implements IRealtimePubSub {
  private readonly handlers = new Set<(message: RealtimePubSubMessage) => void>()

  /**
   * Publish a message to all subscribed handlers.
   *
   * Delivery is deferred one microtask so a handler that enqueues further publishes
   * does not deepen the current call stack. One handler's failure does not block others.
   *
   * @param message - The pub/sub message to fan out.
   */
  async publish(message: RealtimePubSubMessage): Promise<void> {
    // Defer one microtask to match Redis async-callback semantics.
    await Promise.resolve()
    for (const handler of this.handlers) {
      try {
        handler(message)
      } catch {
        // Best-effort fan-out — one handler's failure must not block the others.
      }
    }
  }

  /**
   * Subscribe to pub/sub messages.
   *
   * @param handler - Called for every published message.
   * @returns An async unsubscribe function that removes this handler.
   */
  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
    }
  }
}
