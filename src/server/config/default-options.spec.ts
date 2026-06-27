/**
 * @fileoverview Unit tests for option defaulting.
 * @layer composition
 */
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { applyDefaults, DEFAULT_SSE } from './default-options'

const authenticator = { authenticate: async () => null }

describe('applyDefaults', () => {
  // With no sse block, every default SSE value is applied.
  it('fills all SSE defaults when none are provided', () => {
    const resolved = applyDefaults({ transport: 'sse', authenticator })
    expect(resolved.sse).toEqual(DEFAULT_SSE)
  })

  // Provided SSE values override defaults; unspecified ones keep the default.
  it('merges provided SSE values over defaults', () => {
    const options: BymaxRealtimeModuleOptions = {
      transport: 'sse',
      authenticator,
      sse: { heartbeatMs: 5_000, endpoint: '/stream' },
    }
    const resolved = applyDefaults(options)
    expect(resolved.sse.heartbeatMs).toBe(5_000)
    expect(resolved.sse.endpoint).toBe('/stream')
    expect(resolved.sse.replayBufferSize).toBe(DEFAULT_SSE.replayBufferSize)
  })

  // The returned options object is frozen against mutation.
  it('returns a frozen object', () => {
    const resolved = applyDefaults({ transport: 'sse', authenticator })
    expect(Object.isFrozen(resolved)).toBe(true)
  })
})
