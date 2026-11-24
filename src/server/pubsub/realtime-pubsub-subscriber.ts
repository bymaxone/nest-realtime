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
import { SseTransport } from '../transports/sse/sse.transport'
import { logEvent } from '../utils/log-event'
import { shielded } from '../utils/within-deadline'
import { windowedReport } from '../utils/windowed-report'

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
 * A subscribe that fails fails the boot: an instance that cannot hear the others would
 * miss every revocation. A bus that merely cannot be reached yet resolves its subscribe and
 * reports itself through `isSubscribed()` instead. An unsubscribe failure is logged.
 */
@Injectable()
export class RealtimePubSubSubscriber implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimePubSubSubscriber.name)
  private unsubscribe: (() => Promise<void>) | null = null

  constructor(
    @Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub,
    @Inject(REALTIME_INSTANCE_ID_TOKEN) private readonly instanceId: string,
    // Explicit @Inject: esbuild/tsup emits no `design:paramtypes` metadata, so
    // this param must be resolved by its provider token rather than reflected type.
    @Inject(SseTransport) private readonly sse: SseTransport,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = await this.pubsub.subscribe((msg) => this.handle(msg))
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.unsubscribe) {
      try {
        await shielded(this.unsubscribe())
      } catch (err) {
        logEvent(
          this.logger,
          'warn',
          'REALTIME_PUBSUB_UNSUBSCRIBE_FAILED',
          `Pub/sub unsubscribe failed`,
          {},
          err,
        )
      }
      this.unsubscribe = null
    }
  }

  /**
   * Messages the subscriber cannot act on, counted and reported once for each window. The line
   * carries the count and the reason in a fixed vocabulary: an unknown op, or the class of the last
   * failure. The op and the failure's message can echo what whoever publishes to the channel
   * wrote, so neither is ever written.
   */
  private readonly dropped = windowedReport(
    // Stryker disable next-line StringLiteral: equivalent — a report is only written after a drop, and every drop sets `last` first
    () => ({ count: 0, last: 'none' }),
    ({ count, last }) => {
      logEvent(
        this.logger,
        'warn',
        'REALTIME_PUBSUB_DROPPED',
        `Pub/sub dropped ${count} message(s) it could not act on since the last report (last: ${last})`,
        { count, last },
      )
    },
  )

  private handle(msg: RealtimePubSubMessage): void {
    try {
      // Drop messages we originated — they were already delivered locally.
      if (msg.origin === this.instanceId) return
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
        case 'disconnect':
          this.closeLocal(msg.args as DisconnectArgs)
          break
        default: {
          msg.op satisfies never
          this.drop('unknown op')
        }
      }
    } catch (err) {
      this.drop(String(Object(err).constructor?.name ?? 'Error'))
    }
  }

  /** Close a connection another instance asked this one to close; the handler is synchronous, so a rejection is handled here. */
  private closeLocal(a: DisconnectArgs): void {
    Promise.resolve(this.sse.disconnectLocal(a.connectionId, a.reason)).catch((err: unknown) => {
      logEvent(
        this.logger,
        'warn',
        'REALTIME_DISCONNECT_FAILED',
        'Remote disconnect failed',
        { connectionId: a.connectionId },
        err,
      )
    })
  }

  private drop(last: string): void {
    this.dropped(({ count }) => ({ count: count + 1, last }))
  }
}
