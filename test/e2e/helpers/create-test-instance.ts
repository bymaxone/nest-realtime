/**
 * @fileoverview Helper for cross-instance e2e tests — wires two in-process transport instances.
 * @layer e2e
 */
import { Subject } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { ConnectionRegistry } from '../../../src/server/services/connection-registry.service'
import { RoomRegistry } from '../../../src/server/services/room-registry.service'
import { EventIdGenerator } from '../../../src/server/services/event-id-generator.service'
import { EventReplayBuffer } from '../../../src/server/transports/sse/event-replay-buffer'
import { HeartbeatService } from '../../../src/server/transports/sse/heartbeat.service'
import { SseTransport } from '../../../src/server/transports/sse/sse.transport'
import { RealtimePubSubSubscriber } from '../../../src/server/pubsub/realtime-pubsub-subscriber'
import { InMemoryPubSub } from '../../../src/server/pubsub/in-memory-pubsub'
import type { IRealtimePubSub } from '../../../src/server/interfaces/realtime-pubsub.interface'
import type { IConnectionAuthenticator } from '../../../src/server/interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../../../src/server/interfaces/realtime-module-options.interface'

/** A wired SSE instance for cross-instance testing. */
export interface TestInstance {
  readonly instanceId: string
  readonly transport: SseTransport
  readonly subscriber: RealtimePubSubSubscriber
  /** Register a fake connection and return the received events array. */
  addConnection(connectionId: string, userId: string, tenantId?: string): MessageEvent[]
  /** Tear down the subscriber and all connections. */
  shutdown(): Promise<void>
}

/**
 * Build fully-wired SSE transport instances sharing one InMemoryPubSub bus, or one bus each
 * when `busFor` is given.
 *
 * Use this in cross-instance e2e specs to verify that emits on one instance
 * fan-out to connections on the other.
 */
export function createTestInstances(
  count: number,
  busFor?: () => IRealtimePubSub,
): {
  instances: TestInstance[]
  pubsub: InMemoryPubSub
} {
  const pubsub = new InMemoryPubSub()

  const instances: TestInstance[] = Array.from({ length: count }, () => {
    // One bus per instance when the caller supplies them, as in a real deployment.
    const bus = busFor ? busFor() : pubsub
    const instanceId = randomUUID()
    const connections = new ConnectionRegistry()
    const rooms = new RoomRegistry()
    const options: BymaxRealtimeModuleOptions = {
      transport: 'sse',
      authenticator: { authenticate: async () => null } as IConnectionAuthenticator,
    }
    const replay = new EventReplayBuffer(options)
    const idGen = new EventIdGenerator()
    const heartbeat = new HeartbeatService()
    const auth = { authenticate: async () => null } as unknown as IConnectionAuthenticator

    const transport = new SseTransport(
      connections,
      rooms,
      replay,
      idGen,
      heartbeat,
      auth,
      bus,
      {},
      options,
      instanceId,
    )

    const subscriber = new RealtimePubSubSubscriber(bus, instanceId, transport)

    function addConnection(
      connectionId: string,
      userId: string,
      tenantId?: string,
    ): MessageEvent[] {
      const received: MessageEvent[] = []
      const subject = new Subject<MessageEvent>()
      const close$ = new Subject<void>()
      subject.subscribe((m) => received.push(m))
      connections.register({
        connectionId,
        userId,
        tenantId,
        transport: 'sse',
        ip: '127.0.0.1',
        userAgent: undefined,
        connectedAt: new Date(),
        subject,
        close$,
        originalAuth: { userId, tenantId, roles: undefined },
      })
      return received
    }

    async function shutdown(): Promise<void> {
      await subscriber.onApplicationShutdown()
      await transport.onApplicationShutdown()
    }

    return { instanceId, transport, subscriber, addConnection, shutdown }
  })

  return { instances, pubsub }
}
