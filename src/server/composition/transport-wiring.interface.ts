/**
 * @fileoverview The seam between module composition and transport selection.
 * @layer composition
 */
import type { Provider, Type } from '@nestjs/common'
import type { ResolvedRealtimeOptions } from '../config/default-options'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'

/** Providers and controllers a transport contributes to the dynamic module. */
export interface TransportRegistration {
  /** Injectable providers, including the `REALTIME_TRANSPORT_TOKEN` binding. */
  readonly providers: Provider[]
  /** SSE controller endpoints to register. Empty for WebSocket-only wiring. */
  readonly endpoints: string[]
  /** Gateway providers. Registered separately so the intent stays readable. */
  readonly gateways: Provider[]
}

/**
 * How a given entry point wires transports.
 *
 * This is what keeps `@nestjs/websockets` out of the root bundle. The
 * composition code never names a transport class; each entry point supplies its
 * own wiring, and only the `./websocket` entry imports the Socket.IO stack. A
 * consumer on SSE therefore never loads it — the reason the transports are
 * split across entry points at all.
 */
export interface TransportWiring {
  /** Transport modes this wiring accepts, for validating configuration. */
  readonly modes: readonly BymaxRealtimeModuleOptions['transport'][]
  /** Wire the transports for a fully resolved, synchronous configuration. */
  build(resolved: ResolvedRealtimeOptions): TransportRegistration
  /**
   * Wire the transports for the asynchronous path, where options are not known
   * at decoration time. Controllers must be registered then, so the endpoint is
   * fixed rather than read from the resolved options.
   */
  buildAsync(mode: BymaxRealtimeModuleOptions['transport']): {
    readonly providers: Provider[]
    readonly controllers: Type<unknown>[]
  }
}
