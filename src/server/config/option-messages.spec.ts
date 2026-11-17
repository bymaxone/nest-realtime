/**
 * @fileoverview A refused option names the option and the type of what it received, and echoes nothing else.
 * @layer composition
 *
 * What a host passes can be a secret (a token pasted into the wrong field) or the source of a
 * function, and an error message ends up in logs and in responses. Every option that refuses a value
 * says what kind of value it was; only a finite number is printed.
 */
import { validateOptions } from './validate-options'

const SENTINEL = 'SENTINEL-8f3a91'
const authenticator = { authenticate: async () => null }

/** Values a host could hand over by mistake, each carrying the sentinel somewhere a careless message would print. */
const HANDED_OVER: ReadonlyArray<readonly [string, unknown, string]> = [
  ['a string', SENTINEL, 'a string'],
  ['a symbol', Symbol(SENTINEL), 'a symbol'],
  ['a function', () => 'SENTINEL-8f3a91', 'a function'],
  ['an object with a toString', { toString: () => SENTINEL }, 'an object'],
  ['an array', [SENTINEL], 'an array'],
  ['a boolean', true, 'a boolean'],
  ['NaN', Number.NaN, 'a number that is not finite'],
  ['Infinity', Infinity, 'a number that is not finite'],
]

/** Every option the validator refuses by value. */
const OPTIONS: readonly string[] = [
  'transport',
  'onConnectFailure',
  'hookTimeoutMs',
  'authenticateTimeoutMs',
  'maxPendingHandshakes',
  'maxConnections',
  'websocket.maxConnectionsPerUser',
  'websocket.maxHttpBufferSize',
  'websocket.pingIntervalMs',
  'websocket.pingTimeoutMs',
  'reauthenticationPolicy.intervalSeconds',
  'reauthenticationPolicy.cacheTtlMs',
  'reauthenticationPolicy.revalidateTimeoutMs',
  'reauthenticationPolicy.concurrency',
  'reauthenticationPolicy.onFailure',
  'sse.heartbeatMs',
  'sse.replayBufferSize',
  'sse.replayTtlMs',
  'sse.replayMaxIdleUsers',
  'sse.maxQueuedBytes',
  'sse.maxQueuedEvents',
  'sse.stallHeartbeats',
  'sse.maxConnectionsPerUser',
]

/** Build the options with `value` at the dotted `path`, which may name the top level or a group. */
function optionsWith(path: string, value: unknown): never {
  const base: Record<string, unknown> = { transport: 'sse', authenticator }
  const [head, tail] = path.split('.')
  if (tail === undefined) base[head as string] = value
  else base[head as string] = { [tail]: value }
  return base as never
}

describe.each(OPTIONS)('%s', (path) => {
  // Scenario: each kind of value a host could hand over by mistake. Expected: the refusal names the
  // option, says what kind of value it received, and does not contain what the value held.
  it.each(HANDED_OVER)('refuses %s by type, without echoing it', (_label, value, kind) => {
    let message = ''
    try {
      validateOptions(optionsWith(path, value))
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain(`options.${path}`)
    expect(message).toContain(`received ${kind}`)
    expect(message).not.toContain(SENTINEL)
  })
})

describe('a finite number', () => {
  // Scenario: a finite number outside the range. Expected: it is printed, since it carries no secret.
  it('is printed in the refusal', () => {
    expect(() => validateOptions(optionsWith('maxConnections', -7))).toThrow(
      new Error(
        '[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.maxConnections must be an integer >= 1, received -7',
      ),
    )
  })
})
