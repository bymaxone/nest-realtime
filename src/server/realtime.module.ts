/**
 * @fileoverview The dynamic NestJS module wiring the SSE transport and public API.
 * @layer composition
 */
import { randomUUID } from 'node:crypto'
import { Global, Logger, Module } from '@nestjs/common'
import type { DynamicModule, Provider } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../shared/constants/error-codes.constants'
import { applyDefaults } from './config/default-options'
import { validateOptions } from './config/validate-options'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from './constants/injection-tokens.constants'
import { createSseController } from './factories/sse-controller.factory'
import type { BymaxRealtimeModuleOptions } from './interfaces/realtime-module-options.interface'
import { InMemoryPubSub } from './pubsub/in-memory-pubsub'
import { ConnectionRegistry } from './services/connection-registry.service'
import { EventIdGenerator } from './services/event-id-generator.service'
import { RealtimeService } from './services/realtime.service'
import { ReauthenticationService } from './services/reauthentication.service'
import { RoomRegistry } from './services/room-registry.service'
import { EventReplayBuffer } from './transports/sse/event-replay-buffer'
import { HeartbeatService } from './transports/sse/heartbeat.service'
import { SseSubscriptionHandler } from './transports/sse/sse-subscription.handler'
import { SseTransport } from './transports/sse/sse.transport'

/**
 * Realtime module — SSE transport (default) with a unified, transport-agnostic
 * public API (`RealtimeService`). Registered globally so a single configuration
 * serves the whole application.
 */
@Global()
@Module({})
export class BymaxRealtimeModule {
  private static readonly logger = new Logger(BymaxRealtimeModule.name)

  /**
   * Configure the module synchronously.
   *
   * @example
   * ```ts
   * BymaxRealtimeModule.forRoot({
   *   transport: 'sse',
   *   authenticator: new MyAuthenticator(),
   * })
   * ```
   */
  static forRoot(options: BymaxRealtimeModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = applyDefaults(options)
    if (resolved.transport !== 'sse') {
      throw new Error(
        `[BymaxRealtimeModule] ${REALTIME_ERROR_CODES.INVALID_OPTIONS}: transport "${resolved.transport}" is not available; only 'sse' is supported`,
      )
    }

    const instanceId = randomUUID()
    const providers: Provider[] = [
      { provide: REALTIME_OPTIONS_TOKEN, useValue: resolved },
      { provide: REALTIME_INSTANCE_ID_TOKEN, useValue: instanceId },
      { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: resolved.authenticator },
      { provide: REALTIME_PUBSUB_TOKEN, useValue: resolved.pubsub ?? new InMemoryPubSub() },
      { provide: REALTIME_HOOKS_TOKEN, useValue: resolved.hooks ?? {} },
      { provide: REALTIME_OFFLINE_QUEUE_TOKEN, useValue: resolved.offlineQueue },
      { provide: REALTIME_PRESENCE_TOKEN, useValue: resolved.presence },
      ConnectionRegistry,
      RoomRegistry,
      EventIdGenerator,
      EventReplayBuffer,
      HeartbeatService,
      SseTransport,
      { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      SseSubscriptionHandler,
      RealtimeService,
      ReauthenticationService,
    ]

    BymaxRealtimeModule.logger.log(
      `Bootstrapped (transport=${resolved.transport}, instanceId=${instanceId})`,
    )

    return {
      module: BymaxRealtimeModule,
      controllers: [createSseController(resolved.sse.endpoint)],
      providers,
      exports: [
        RealtimeService,
        ConnectionRegistry,
        REALTIME_OPTIONS_TOKEN,
        REALTIME_INSTANCE_ID_TOKEN,
        REALTIME_AUTHENTICATOR_TOKEN,
        REALTIME_PUBSUB_TOKEN,
        REALTIME_HOOKS_TOKEN,
        REALTIME_OFFLINE_QUEUE_TOKEN,
        REALTIME_PRESENCE_TOKEN,
        REALTIME_TRANSPORT_TOKEN,
      ],
    }
  }
}
