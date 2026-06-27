/**
 * @fileoverview Unit tests for bootstrap option validation.
 * @layer composition
 */
import { validateOptions } from './validate-options'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'

const authenticator = { authenticate: async () => null }

function asOptions(value: unknown): BymaxRealtimeModuleOptions {
  return value as BymaxRealtimeModuleOptions
}

describe('validateOptions', () => {
  // Minimal valid options pass validation.
  it('accepts minimal valid options', () => {
    expect(() => validateOptions({ transport: 'sse', authenticator })).not.toThrow()
  })

  // A full, valid SSE option block passes (covers the non-throwing numeric paths).
  it('accepts valid sse options', () => {
    expect(() =>
      validateOptions({
        transport: 'sse',
        authenticator,
        sse: { heartbeatMs: 1_000, replayBufferSize: 0, maxConnectionsPerUser: 5 },
      }),
    ).not.toThrow()
  })

  // A missing transport is rejected.
  it('throws when transport is missing', () => {
    expect(() => validateOptions(asOptions({ authenticator }))).toThrow(/transport/i)
  })

  // An invalid transport value is rejected.
  it('throws when transport is invalid', () => {
    expect(() => validateOptions(asOptions({ transport: 'carrier-pigeon', authenticator }))).toThrow(
      /transport/i,
    )
  })

  // A missing authenticator is rejected (auth inversion makes it mandatory).
  it('throws when authenticator is missing', () => {
    expect(() => validateOptions(asOptions({ transport: 'sse' }))).toThrow(/authenticator is required/)
  })

  // An authenticator without an authenticate() method is rejected.
  it('throws when authenticator lacks authenticate()', () => {
    expect(() => validateOptions(asOptions({ transport: 'sse', authenticator: {} }))).toThrow(
      /authenticate/,
    )
  })

  // A non-positive heartbeat interval is rejected.
  it('throws when sse.heartbeatMs <= 0', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { heartbeatMs: 0 } }),
    ).toThrow(/heartbeatMs/)
  })

  // A negative replay buffer size is rejected.
  it('throws when sse.replayBufferSize < 0', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { replayBufferSize: -1 } }),
    ).toThrow(/replayBufferSize/)
  })

  // A non-positive per-user connection cap is rejected.
  it('throws when sse.maxConnectionsPerUser <= 0', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { maxConnectionsPerUser: 0 } }),
    ).toThrow(/maxConnectionsPerUser/)
  })
})
