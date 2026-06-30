/**
 * @fileoverview Unit tests for bootstrap option validation.
 * @layer composition
 */
import { Logger } from '@nestjs/common'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { validateOptions } from './validate-options'

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
    expect(() =>
      validateOptions(asOptions({ transport: 'carrier-pigeon', authenticator })),
    ).toThrow(/transport/i)
  })

  // A missing authenticator is rejected (auth inversion makes it mandatory).
  it('throws when authenticator is missing', () => {
    expect(() => validateOptions(asOptions({ transport: 'sse' }))).toThrow(
      /authenticator is required/,
    )
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

  // A negative per-user connection cap is rejected.
  it('throws when sse.maxConnectionsPerUser < 0', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { maxConnectionsPerUser: -1 } }),
    ).toThrow(/maxConnectionsPerUser/)
  })

  // maxConnectionsPerUser = 0 is valid and disables the per-user cap (matches the
  // transport, which treats <= 0 as "no eviction").
  it('accepts sse.maxConnectionsPerUser = 0 (cap disabled)', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { maxConnectionsPerUser: 0 } }),
    ).not.toThrow()
  })

  // cacheTtlMs > intervalSeconds*1000 → Logger.warn (every cycle is a cache miss).
  it('warns when cacheTtlMs exceeds intervalSeconds*1000', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 60, cacheTtlMs: 120_000 },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cacheTtlMs'),
      'BymaxRealtimeModule',
    )
    warnSpy.mockRestore()
  })

  // cacheTtlMs === intervalSeconds*1000 → no warning (equal is not greater-than).
  it('does not warn when cacheTtlMs equals intervalSeconds*1000', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 60, cacheTtlMs: 60_000 },
    })
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // Only one of cacheTtlMs / intervalSeconds set → no warning (both are required to compare).
  it('does not warn when only cacheTtlMs is set (intervalSeconds absent)', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { cacheTtlMs: 120_000 },
    })
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // cacheTtlMs barely over intervalSeconds*1000 must warn — distinguishes ×1000 from ×1001.
  it('warns when cacheTtlMs is 1 ms over intervalSeconds*1000', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 1, cacheTtlMs: 1001 },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cacheTtlMs'),
      'BymaxRealtimeModule',
    )
    warnSpy.mockRestore()
  })

  // cacheTtlMs exactly at intervalSeconds*1000 → no warning (boundary check for ×1000).
  it('does not warn when cacheTtlMs equals 1*1000 (interval 1 second)', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 1, cacheTtlMs: 1000 },
    })
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
  // cacheTtlMs=1 with intervalSeconds=60 must NOT warn — 1 < 60*1000=60000.
  // With the mutation intervalSeconds/1000 = 0.06, 1 > 0.06 → warns (wrong).
  it('does not warn when cacheTtlMs is well below intervalSeconds*1000', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 60, cacheTtlMs: 1 },
    })
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
