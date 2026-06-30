/**
 * @fileoverview Cross-instance pub/sub subscriber — re-emits remote messages locally.
 * @layer infrastructure
 */
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_PUBSUB_TOKEN,
} from '../constants/injection-tokens.constants'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../interfaces/realtime-pubsub.interface'
import type { SseTransport } from '../transports/sse/sse.transport'

interface EmitUserArgs {
  userId: string
  event: string
  data: unknown
  id: string
}
interface EmitTenantArgs {
  tenantId: string
  event: string
  data: unknown
  id: string
}
interface EmitRoomArgs {
  roomId: string
  event: string
  data: unknown
  id: string
}
interface BroadcastArgs {
  event: string
  data: unknown
  id: string
}
interface DisconnectArgs {
  connectionId: string
  reason?: string
}

/**
 * Subscribes to the pub/sub bus on startup and dispatches remote messages to
 * the transport's `*Local` methods, which deliver without re-publishing.
 *
 * Messages from this instance (echo) are dropped via the `origin` guard.
 * Subscribe/unsubscribe failures are logged and swallowed so a Redis hiccup at
 * startup does not crash the application.
 */
@Injectable()
export class RealtimePubSubSubscriber implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimePubSubSubscriber.name)
  private unsubscribe: (() => Promise<void>) | null = null

  constructor(
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
    private readonly sse: SseTransport,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.pubsub.subscribe((msg) => this.handle(msg))
    } catch (err) {
      this.logger.warn(
        `Failed to subscribe to pub/sub: ${(err as Error).message}. Running in single-instance mode.`,
      )
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.unsubscribe) {
      try {
        await this.unsubscribe()
      } catch (err) {
        this.logger.warn(`Pub/sub unsubscribe failed: ${(err as Error).message}`)
      }
      this.unsubscribe = null
    }
  }

  private handle(msg: RealtimePubSubMessage): void {
    // Drop messages we originated — they were already delivered locally.
    if (msg.origin === this.instanceId) return
    try {
      switch (msg.op) {
        case 'emitToUser': {
          const a = msg.args as EmitUserArgs
          this.sse.emitToUserLocal(a.userId, a.event, a.data, a.id)
          break
        }
        case 'emitToTenant': {
          const a = msg.args as EmitTenantArgs
          this.sse.emitToTenantLocal(a.tenantId, a.event, a.data, a.id)
          break
        }
        case 'emitToRoom': {
          const a = msg.args as EmitRoomArgs
          this.sse.emitToRoomLocal(a.roomId, a.event, a.data, a.id)
          break
        }
        case 'broadcast': {
          const a = msg.args as BroadcastArgs
          this.sse.broadcastLocal(a.event, a.data, a.id)
          break
        }
        case 'disconnect': {
          const a = msg.args as DisconnectArgs
          void this.sse.disconnectLocal(a.connectionId, a.reason)
          break
        }
        default:
          this.logger.warn(`Unknown pub/sub op: ${String((msg as { op: unknown }).op)}`)
      }
    } catch (err) {
      this.logger.warn(`Pub/sub message handling failed: ${(err as Error).message}`)
    }
  }
}
