/**
 * @fileoverview Transport wiring for the WebSocket entry point.
 * @layer composition
 */
import type { TransportWiring } from '../server/composition/transport-wiring.interface'
import { REALTIME_TRANSPORT_TOKEN } from '../server/constants/injection-tokens.constants'
import { createSseController } from '../server/factories/sse-controller.factory'
import { RealtimePubSubSubscriber } from '../server/pubsub/realtime-pubsub-subscriber'
import { CompositeTransport } from '../server/transports/composite/composite.transport'
import { SseSubscriptionHandler } from '../server/transports/sse/sse-subscription.handler'
import { SseTransport } from '../server/transports/sse/sse.transport'
import { RealtimeGateway } from '../server/transports/websocket/realtime.gateway'
import { WebSocketTransport } from '../server/transports/websocket/websocket.transport'

/** The endpoint the async path binds to, since options resolve after decoration. */
const DEFAULT_ASYNC_ENDPOINT = '/events'

/**
 * Wiring for Socket.IO, and for `'both'` where SSE and WebSocket are composed.
 *
 * This module graph is the only one that imports `@nestjs/websockets` and
 * `@nestjs/platform-socket.io`, which is why they are peer dependencies of this
 * entry point rather than of the package as a whole.
 */
export const webSocketWiring: TransportWiring = {
  modes: ['websocket', 'both'],

  build(resolved) {
    if (resolved.transport === 'websocket') {
      return {
        providers: [
          WebSocketTransport,
          { provide: REALTIME_TRANSPORT_TOKEN, useExisting: WebSocketTransport },
        ],
        endpoints: [],
        gateways: [RealtimeGateway],
      }
    }
    return {
      providers: [
        SseTransport,
        WebSocketTransport,
        CompositeTransport,
        SseSubscriptionHandler,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport },
      ],
      endpoints: [resolved.sse.endpoint],
      gateways: [RealtimeGateway],
    }
  },

  buildAsync(mode) {
    if (mode === 'websocket') {
      return {
        providers: [
          WebSocketTransport,
          RealtimeGateway,
          { provide: REALTIME_TRANSPORT_TOKEN, useExisting: WebSocketTransport },
        ],
        controllers: [],
      }
    }
    return {
      providers: [
        SseTransport,
        SseSubscriptionHandler,
        WebSocketTransport,
        CompositeTransport,
        RealtimeGateway,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport },
      ],
      controllers: [createSseController(DEFAULT_ASYNC_ENDPOINT)],
    }
  },
}
