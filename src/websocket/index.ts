/**
 * @fileoverview Public surface of the WebSocket entry point.
 * @layer composition
 *
 * Everything that depends on `@nestjs/websockets`, `@nestjs/platform-socket.io`
 * and `socket.io` is reachable only from here. The package root stays free of
 * them, so an application on SSE never installs the Socket.IO stack.
 */
export { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
export { WebSocketTransport } from './transports/websocket/websocket.transport'
export { RealtimeGateway } from './transports/websocket/realtime.gateway'
export { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'
export { CompositeTransport } from './transports/composite/composite.transport'
export type {
  WebSocketRealtimeModuleAsyncOptions,
  WebSocketRealtimeModuleOptions,
} from '@bymax-one/nest-realtime/internal'
