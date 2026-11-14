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

describe('validateOptions error codes', () => {
  // The code a caller branches on is a property of the error, not only text in its message.
  it.each([
    [
      'an unknown transport',
      { transport: 'carrier-pigeon' as never, authenticator },
      'REALTIME_INVALID_OPTIONS',
    ],
    ['a missing authenticator', { transport: 'sse' as const }, 'REALTIME_NO_AUTHENTICATOR'],
  ])('carries the code of %s', (_label, options, code) => {
    let thrown: unknown
    try {
      validateOptions(options as never)
    } catch (error) {
      thrown = error
    }
    expect((thrown as { code?: unknown }).code).toBe(code)
  })
})

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
        sse: { heartbeatMs: 5_000, replayBufferSize: 0, maxConnectionsPerUser: 5 },
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

  // The interval is checked at boot against the range the heartbeat service enforces for every
  // connection, so a value outside it stops the application starting and does not answer each
  // connection with a 500 later. A number that is not finite, and anything that is not a number,
  // is outside the range.
  it.each([4_999, 1_000, 1, 0, -1, 90_001, Number.NaN, Infinity, -Infinity, '5000', null])(
    'rejects sse.heartbeatMs %p at boot, naming the range',
    (value) => {
      expect(() =>
        validateOptions(
          asOptions({ transport: 'sse', authenticator, sse: { heartbeatMs: value } }),
        ),
      ).toThrow(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.sse.heartbeatMs must be between 5000 and 90000 ms (got ${String(value)})`,
      )
    },
  )

  // The ends of the range, and the default, are accepted; so is leaving the option out.
  it.each([5_000, 30_000, 90_000])('accepts sse.heartbeatMs %p', (value) => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { heartbeatMs: value } }),
    ).not.toThrow()
  })

  // An sse block without the option is accepted: the default applies.
  it('accepts an sse block without heartbeatMs', () => {
    expect(() =>
      validateOptions({ transport: 'sse', authenticator, sse: { replayBufferSize: 10 } }),
    ).not.toThrow()
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

  // A timer cannot run longer than 2,147,483,647 ms: Node treats a longer delay as 1 ms, so an option
  // that feeds one has to stop there.
  it('rejects a hookTimeoutMs that is not an integer from 1 to 2147483647, and accepts both ends', () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Infinity,
      '5000',
      null,
      2_147_483_648,
      3_000_000_000,
      2 ** 53 - 1,
    ]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, hookTimeoutMs: bad as never }),
      ).toThrow(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.hookTimeoutMs must be an integer >= 1 and <= 2147483647, got ${String(bad)}`,
      )
    }
    for (const good of [1, 5_000, 60_000, 2_147_483_647]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, hookTimeoutMs: good }),
      ).not.toThrow()
    }
  })

  // `authenticateTimeoutMs` feeds a timer; `maxPendingHandshakes` is a count, so it has no ceiling.
  it('rejects an authenticateTimeoutMs that is not an integer from 1 to 2147483647, and accepts both ends', () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Infinity,
      '10000',
      null,
      2_147_483_648,
      2 ** 53 - 1,
    ]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, authenticateTimeoutMs: bad as never }),
      ).toThrow(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.authenticateTimeoutMs must be an integer >= 1 and <= 2147483647, got ${String(bad)}`,
      )
    }
    for (const good of [1, 10_000, 2_147_483_647]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, authenticateTimeoutMs: good }),
      ).not.toThrow()
    }
  })

  it('rejects a maxPendingHandshakes that is not an integer >= 1, and accepts 1 and more', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, '1000', null]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, maxPendingHandshakes: bad as never }),
      ).toThrow(
        `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.maxPendingHandshakes must be an integer >= 1, got ${String(bad)}`,
      )
    }
    for (const good of [1, 1_000, 2 ** 53 - 1]) {
      expect(() =>
        validateOptions({ transport: 'sse', authenticator, maxPendingHandshakes: good }),
      ).not.toThrow()
    }
  })

  // Socket.IO runs these as timers, so they stop where Node's timers do.
  it.each(['pingIntervalMs', 'pingTimeoutMs'] as const)(
    'rejects a websocket.%s that is not an integer from 1 to 2147483647, and accepts both ends',
    (name) => {
      for (const bad of [
        0,
        -1,
        1.5,
        Number.NaN,
        Infinity,
        '25000',
        null,
        2_147_483_648,
        2 ** 53 - 1,
      ]) {
        expect(() =>
          validateOptions({
            transport: 'websocket',
            authenticator,
            websocket: { [name]: bad } as never,
          }),
        ).toThrow(
          `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.websocket.${name} must be an integer >= 1 and <= 2147483647, got ${String(bad)}`,
        )
      }
      for (const good of [1, 25_000, 2_147_483_647]) {
        expect(() =>
          validateOptions({
            transport: 'websocket',
            authenticator,
            websocket: { [name]: good },
          }),
        ).not.toThrow()
      }
    },
  )

  it.each(['maxQueuedBytes', 'maxQueuedEvents', 'stallHeartbeats'] as const)(
    'rejects a sse.%s that is not an integer >= 0, and accepts 0 and a positive integer',
    (name) => {
      for (const bad of [-1, 1.5, Number.NaN, Infinity, '5', null]) {
        expect(() =>
          validateOptions({ transport: 'sse', authenticator, sse: { [name]: bad } as never }),
        ).toThrow(
          `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.sse.${name} must be an integer >= 0 (0 switches the bound off), got ${String(bad)}`,
        )
      }
      for (const good of [0, 1, 4096]) {
        expect(() =>
          validateOptions({ transport: 'sse', authenticator, sse: { [name]: good } }),
        ).not.toThrow()
      }
    },
  )

  // The interval, the timeout and the concurrency are positive whole numbers, and the cache window
  // a non-negative one: a timer cannot run at 0 or at a fraction, nothing runs 0.5 at a time, and a
  // timer option stops where Node's timers do.
  it.each([
    ['intervalSeconds', 1, 2_147_483],
    ['cacheTtlMs', 0, undefined],
    ['revalidateTimeoutMs', 1, 2_147_483_647],
    ['concurrency', 1, undefined],
  ] as const)(
    'rejects a reauthenticationPolicy.%s outside its range, and accepts both ends',
    (name, least, most) => {
      const range = `>= ${least}${most === undefined ? '' : ` and <= ${most}`}`
      const outside = [least - 1, least + 0.5, Number.NaN, Infinity, '5', null]
      if (most !== undefined) outside.push(most + 1, 2 ** 53 - 1)
      for (const bad of outside) {
        expect(() =>
          validateOptions({
            transport: 'sse',
            authenticator,
            reauthenticationPolicy: { [name]: bad } as never,
          }),
        ).toThrow(
          `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.reauthenticationPolicy.${name} must be an integer ${range}, got ${String(bad)}`,
        )
      }
      for (const good of [least, least + 1, 300, ...(most === undefined ? [] : [most])]) {
        expect(() =>
          validateOptions({
            transport: 'sse',
            authenticator,
            reauthenticationPolicy: { [name]: good },
          }),
        ).not.toThrow()
      }
    },
  )

  it("rejects an onFailure other than 'disconnect' or 'event'", () => {
    expect(() =>
      validateOptions({
        transport: 'sse',
        authenticator,
        reauthenticationPolicy: { onFailure: 'ignore' } as never,
      }),
    ).toThrow(
      "[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.reauthenticationPolicy.onFailure must be 'disconnect' or 'event', got ignore",
    )
    for (const good of ['disconnect', 'event'] as const) {
      expect(() =>
        validateOptions({
          transport: 'sse',
          authenticator,
          reauthenticationPolicy: { onFailure: good },
        }),
      ).not.toThrow()
    }
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

  // Kills L48 ArithmeticOperator mutation (* 1000 → / 1000 | + 1000 | - 1000) in message.
  // The condition guard uses intervalSeconds*1000 correctly (separate expression), but the
  // warning MESSAGE template must also embed the product — not quotient/sum/difference.
  // With intervalSeconds=60: original → "60000"; / → "0.06"; + → "1060"; - → "-940".
  it('includes intervalSeconds*1000 (not a different arithmetic) in the warning message', () => {
    const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    validateOptions({
      transport: 'sse',
      authenticator,
      reauthenticationPolicy: { intervalSeconds: 60, cacheTtlMs: 120_000 },
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('60000'), 'BymaxRealtimeModule')
    warnSpy.mockRestore()
  })
})
