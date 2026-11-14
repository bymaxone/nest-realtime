/**
 * @fileoverview Merge consumer options with library defaults (SSE transport).
 * @layer composition
 */
import type {
  BymaxRealtimeModuleOptions,
  SseOptions,
} from '../interfaces/realtime-module-options.interface'

/** Library defaults for the SSE transport. */
export const DEFAULT_SSE: Required<SseOptions> = {
  endpoint: '/realtime/sse',
  heartbeatMs: 30_000,
  replayBufferSize: 100,
  replayTtlMs: 300_000,
  replayMaxIdleUsers: 1_000,
  maxConnectionsPerUser: 5,
  emitConnectionEvent: true,
  maxQueuedBytes: 2 * 1024 * 1024,
  maxQueuedEvents: 1000,
  stallHeartbeats: 3,
}

/** Module options with every SSE field resolved to a concrete value. */
export type ResolvedRealtimeOptions = Readonly<
  BymaxRealtimeModuleOptions & { sse: Required<SseOptions> }
>

/**
 * Merge consumer options with the library's SSE defaults.
 *
 * Returns a frozen object whose `sse` is fully populated — callers must not mutate
 * it. Only SSE defaults are filled because SSE is the transport this module wires.
 */
export function applyDefaults(options: BymaxRealtimeModuleOptions): ResolvedRealtimeOptions {
  return Object.freeze({
    ...options,
    sse: { ...DEFAULT_SSE, ...(options.sse ?? {}) },
  })
}
