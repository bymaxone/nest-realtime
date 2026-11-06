/**
 * @fileoverview The exact message and code of each configuration error the module raises.
 * @layer composition
 */
import { Test } from '@nestjs/testing'
import { validateOptions } from './config/validate-options'
import { BymaxRealtimeModule } from './realtime.module'
import { HeartbeatService } from './transports/sse/heartbeat.service'

const authenticator = { authenticate: async () => null }

/** The error a synchronous call raises, or undefined when it raises none. */
function raised(call: () => unknown): (Error & { code?: unknown }) | undefined {
  try {
    call()
  } catch (error) {
    return error as Error & { code?: unknown }
  }
  return undefined
}

// Each case pins the whole message, the raiser's name wherever the message has one, and the code
// as a property. The message is what an operator reads at start-up and the code is what tooling
// branches on; a test that matched only a fragment would let either lose its raiser or its text
// unnoticed.
describe('configuration errors carry their exact message and their code', () => {
  const module = 'BymaxRealtimeModule'
  it.each([
    [
      'an unknown transport',
      () => validateOptions({ transport: 'carrier-pigeon', authenticator } as never),
      'REALTIME_INVALID_OPTIONS',
      `[${module}] REALTIME_INVALID_OPTIONS: options.transport must be one of 'sse' | 'websocket' | 'both' (got: carrier-pigeon)`,
    ],
    [
      'a missing authenticator',
      () => validateOptions({ transport: 'sse' } as never),
      'REALTIME_NO_AUTHENTICATOR',
      `[${module}] REALTIME_NO_AUTHENTICATOR: options.authenticator is required — the library never ships a default authenticator`,
    ],
    [
      'an authenticator with no authenticate()',
      () => validateOptions({ transport: 'sse', authenticator: {} } as never),
      'REALTIME_NO_AUTHENTICATOR',
      `[${module}] REALTIME_NO_AUTHENTICATOR: options.authenticator must implement IConnectionAuthenticator.authenticate(context)`,
    ],
    [
      'a negative replay buffer',
      () =>
        validateOptions({
          transport: 'sse',
          authenticator,
          sse: { replayBufferSize: -1 },
        } as never),
      'REALTIME_INVALID_OPTIONS',
      `[${module}] REALTIME_INVALID_OPTIONS: options.sse.replayBufferSize must be >= 0`,
    ],
    [
      'a negative per-user connection cap',
      () =>
        validateOptions({
          transport: 'sse',
          authenticator,
          sse: { maxConnectionsPerUser: -1 },
        } as never),
      'REALTIME_INVALID_OPTIONS',
      `[${module}] REALTIME_INVALID_OPTIONS: options.sse.maxConnectionsPerUser must be >= 0 (0 disables the per-user connection cap)`,
    ],
    [
      'a transport the module does not serve',
      () => BymaxRealtimeModule.forRoot({ transport: 'both', authenticator } as never),
      'REALTIME_INVALID_OPTIONS',
      `[${module}] REALTIME_INVALID_OPTIONS: transport 'both' is not served by this module (it serves 'sse'). Use 'BymaxRealtimeWebSocketModule' from '@bymax-one/nest-realtime/websocket'.`,
    ],
    [
      'no async-options pattern',
      () => BymaxRealtimeModule.forRootAsync({ transport: 'sse' } as never),
      'REALTIME_INVALID_OPTIONS',
      `[${module}] REALTIME_INVALID_OPTIONS: forRootAsync requires exactly one of useFactory, useClass, or useExisting (received 0)`,
    ],
    [
      'a heartbeat interval outside the range',
      () => new HeartbeatService().start('c1', { write: () => true } as never, 1_000),
      'REALTIME_INVALID_OPTIONS',
      'REALTIME_INVALID_OPTIONS: heartbeatMs must be between 5000 and 90000 ms (got 1000)',
    ],
  ])('%s', (_label, call, code, message) => {
    const error = raised(call)

    expect(error?.message).toBe(message)
    expect(error?.code).toBe(code)
  })

  // The same, for the error that only appears once the factory has run.
  it('a factory that resolves another transport than the one registered', async () => {
    const testModule = Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRootAsync({
          transport: 'sse',
          useFactory: async () => ({ transport: 'websocket', authenticator }) as never,
        }),
      ],
    })

    const error = await testModule.compile().then(
      () => undefined,
      (failure: Error & { code?: unknown }) => failure,
    )

    expect(error?.message).toBe(
      `[${module}] REALTIME_INVALID_OPTIONS: forRootAsync was registered for transport 'sse' but the factory resolved 'websocket'`,
    )
    expect(error?.code).toBe('REALTIME_INVALID_OPTIONS')
  })
})
