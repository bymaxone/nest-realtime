/**
 * @fileoverview Transport wiring for the SSE-only entry point.
 * @layer composition
 */
import { REALTIME_TRANSPORT_TOKEN } from '../constants/injection-tokens.constants'
import { createSseController } from '../factories/sse-controller.factory'
import { RealtimePubSubSubscriber } from '../pubsub/realtime-pubsub-subscriber'
import { SseSubscriptionHandler } from '../transports/sse/sse-subscription.handler'
import { SseTransport } from '../transports/sse/sse.transport'
import type { TransportWiring } from './transport-wiring.interface'

/** The endpoint the async path binds to, since options resolve after decoration. */
const DEFAULT_ASYNC_ENDPOINT = '/events'

/**
 * Wiring for Server-Sent Events, and the reason the root entry point carries no
 * Socket.IO. Nothing reachable from here imports `@nestjs/websockets`, so an SSE
 * application installs neither it nor `socket.io`.
 */
export const sseWiring: TransportWiring = {
  modes: ['sse'],

  build(resolved) {
    return {
      providers: [
        SseTransport,
        SseSubscriptionHandler,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      ],
      endpoints: [resolved.sse.endpoint],
      gateways: [],
    }
  },

  buildAsync() {
    return {
      providers: [
        SseTransport,
        SseSubscriptionHandler,
        RealtimePubSubSubscriber,
        { provide: REALTIME_TRANSPORT_TOKEN, useExisting: SseTransport },
      ],
      controllers: [createSseController(DEFAULT_ASYNC_ENDPOINT)],
    }
  },
}
