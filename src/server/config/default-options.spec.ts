/**
 * @fileoverview Unit tests for option defaulting.
 * @layer composition
 */
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { applyDefaults, DEFAULT_SSE } from './default-options'

const authenticator = { authenticate: async () => null }

describe('DEFAULT_SSE', () => {
  // Each constant must equal the exact canonical value so numeric/boolean/string mutations
  // to the constant are caught — toEqual(DEFAULT_SSE) in applyDefaults tests cannot kill
  // those because both sides mutate together.
  it('has the exact canonical endpoint', () => {
    expect(DEFAULT_SSE.endpoint).toBe('/realtime/sse')
  })

  it('has the exact canonical heartbeatMs', () => {
    expect(DEFAULT_SSE.heartbeatMs).toBe(30_000)
  })

  it('has the exact canonical replayBufferSize', () => {
    expect(DEFAULT_SSE.replayBufferSize).toBe(100)
  })

  it('has the exact canonical maxConnectionsPerUser', () => {
    expect(DEFAULT_SSE.maxConnectionsPerUser).toBe(5)
  })

  it('has emitConnectionEvent defaulting to true', () => {
    expect(DEFAULT_SSE.emitConnectionEvent).toBe(true)
  })
})

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

  // Non-sse fields from the input are preserved — kills mutations that drop the ...options spread.
  it('preserves non-sse fields from the input options', () => {
    const resolved = applyDefaults({ transport: 'sse', authenticator })
    expect(resolved.transport).toBe('sse')
    expect(resolved.authenticator).toBe(authenticator)
  })

  // A fully-specified sse block overrides all defaults; every supplied value is present in output.
  it('overrides all SSE defaults when every field is supplied', () => {
    const resolved = applyDefaults({
      transport: 'sse',
      authenticator,
      sse: {
        endpoint: '/custom',
        heartbeatMs: 10_000,
        replayBufferSize: 50,
        maxConnectionsPerUser: 3,
        emitConnectionEvent: false,
      },
    })
    expect(resolved.sse.endpoint).toBe('/custom')
    expect(resolved.sse.heartbeatMs).toBe(10_000)
    expect(resolved.sse.replayBufferSize).toBe(50)
    expect(resolved.sse.maxConnectionsPerUser).toBe(3)
    expect(resolved.sse.emitConnectionEvent).toBe(false)
  })
})
