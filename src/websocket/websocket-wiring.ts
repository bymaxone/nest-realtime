/**
 * @fileoverview Transport wiring for the WebSocket entry point.
 * @layer composition
 */
import {
  REALTIME_TRANSPORT_TOKEN,
  createSseController,
  RealtimePubSubSubscriber,
  SseSubscriptionHandler,
  SseTransport,
} from '@bymax-one/nest-realtime/internal'
import type { TransportWiring } from '@bymax-one/nest-realtime/internal'
import { CompositeTransport } from './transports/composite/composite.transport'
import { gatewayBoundToNamespace } from './transports/websocket/gateway-binding'
import { RealtimeGateway } from './transports/websocket/realtime.gateway'
import { WebSocketTransport } from './transports/websocket/websocket.transport'

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
        gateways: [{ provide: RealtimeGateway, useClass: gatewayBoundToNamespace() }],
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
      gateways: [{ provide: RealtimeGateway, useClass: gatewayBoundToNamespace() }],
    }
  },

  buildAsync({ mode, sseEndpoint }) {
    if (mode === 'websocket') {
      return {
        providers: [
          WebSocketTransport,
          { provide: RealtimeGateway, useClass: gatewayBoundToNamespace() },
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
        { provide: RealtimeGateway, useClass: gatewayBoundToNamespace() },
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: CompositeTransport },
      ],
      controllers: [createSseController(sseEndpoint)],
    }
  },
}
