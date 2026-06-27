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
 * `publish` synchronously invokes every registered handler in-process; the
 * transport's `origin` self-filter discards the instance's own messages, so a
 * single instance never double-delivers. Multi-instance deployments replace this
 * with a Redis-backed `IRealtimePubSub` so events cross between instances.
 */
@Injectable()
export class InMemoryPubSub implements IRealtimePubSub {
  private readonly handlers = new Set<(message: RealtimePubSubMessage) => void>()

  async publish(message: RealtimePubSubMessage): Promise<void> {
    for (const handler of this.handlers) handler(message)
  }

  async subscribe(handler: (message: RealtimePubSubMessage) => void): Promise<() => Promise<void>> {
    this.handlers.add(handler)
    return async () => {
      this.handlers.delete(handler)
    }
  }
}
