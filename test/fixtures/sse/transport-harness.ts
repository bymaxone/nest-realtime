/**
 * @fileoverview Shared doubles for the SseTransport specs: the options, a transport wired to real
 * registries with a stubbed bus, and a connection added straight to the registry.
 * @layer test
 */
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import type { IOfflineQueueStorage } from '../../../src/server/interfaces/offline-queue-storage.interface'
import { ConnectionRegistry } from '../../../src/server/services/connection-registry.service'
import type { ConnectionRecord } from '../../../src/server/services/connection-registry.service'
import { EventIdGenerator } from '../../../src/server/services/event-id-generator.service'
import { RoomRegistry } from '../../../src/server/services/room-registry.service'
import type { IConnectionAuthenticator } from '../../../src/server/interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../../src/server/interfaces/connection-lifecycle-hooks.interface'
import type { IRealtimePubSub } from '../../../src/server/interfaces/realtime-pubsub.interface'
import type {
  BymaxRealtimeModuleOptions,
  SseOptions,
} from '../../../src/server/interfaces/realtime-module-options.interface'
import { AuthenticationGate } from '../../../src/server/services/authentication-gate.service'
import type { ConnectionAdmission } from '../../../src/server/services/connection-admission.service'
import { HeartbeatService } from '../../../src/server/transports/sse/heartbeat.service'
import { EventReplayBuffer } from '../../../src/server/transports/sse/event-replay-buffer'
import { SseTransport } from '../../../src/server/transports/sse/sse.transport'

function makeOptions(sse?: SseOptions, hookTimeoutMs?: number): BymaxRealtimeModuleOptions {
  return {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    ...(sse ? { sse } : {}),
    ...(hookTimeoutMs !== undefined ? { hookTimeoutMs } : {}),
  }
}

/** An `SseTransport` over real collaborators; `opts` overrides the options, hooks and instance id. */
export function build(opts?: {
  sse?: SseOptions
  hooks?: IConnectionLifecycleHooks
  instanceId?: string
  offlineQueue?: IOfflineQueueStorage
  hookTimeoutMs?: number
  admission?: ConnectionAdmission
}) {
  const connections = new ConnectionRegistry()
  const rooms = new RoomRegistry()
  const options = makeOptions(opts?.sse, opts?.hookTimeoutMs)
  const replay = new EventReplayBuffer(options)
  const idGen = new EventIdGenerator()
  const heartbeat = new HeartbeatService()
  const authenticate = jest.fn()
  const auth = { authenticate } as unknown as IConnectionAuthenticator
  const publish = jest.fn().mockResolvedValue(undefined)
  const unsubscribe = jest.fn().mockResolvedValue(undefined)
  const subscribe = jest.fn().mockResolvedValue(unsubscribe)
  const pubsub = { publish, subscribe } as unknown as IRealtimePubSub
  const hooks = opts?.hooks ?? {}
  const transport = new SseTransport(
    connections,
    rooms,
    replay,
    idGen,
    heartbeat,
    new AuthenticationGate(options, auth),
    pubsub,
    hooks,
    options,
    opts?.instanceId ?? 'inst-1',
    opts?.offlineQueue,
    opts?.admission,
  )
  return {
    transport,
    connections,
    rooms,
    replay,
    heartbeat,
    authenticate,
    publish,
    subscribe,
    unsubscribe,
  }
}

/** Registers a connection and returns the events it receives and the subject that closes it. */
export function addConn(
  connections: ConnectionRegistry,
  params: {
    connectionId: string
    userId: string
    tenantId?: string
    transport?: 'sse' | 'websocket'
    roles?: readonly string[]
    metadata?: Record<string, unknown>
  },
): { received: MessageEvent[]; close$: Subject<void> } {
  const received: MessageEvent[] = []
  const transport = params.transport ?? 'sse'
  const subject = new Subject<MessageEvent>()
  const close$ = new Subject<void>()
  subject.subscribe((m) => received.push(m))
  const record: ConnectionRecord = {
    connectionId: params.connectionId,
    userId: params.userId,
    tenantId: params.tenantId,
    transport,
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: new Date(),
    subject: transport === 'sse' ? subject : null,
    close$: transport === 'sse' ? close$ : null,
    originalAuth: {
      userId: params.userId,
      tenantId: params.tenantId,
      roles: params.roles,
      metadata: params.metadata,
    },
  }
  connections.register(record)
  return { received, close$ }
}
