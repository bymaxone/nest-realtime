/**
 * @fileoverview The numeric options that bound a connection, a buffer or a payload refuse what is not an integer.
 * @layer composition
 *
 * A bound written as a comparison (`value < 0`, `length > max`) is switched off by NaN, because every
 * comparison with NaN is false, and a string or a fraction passes a `< 0` check and is then coerced by
 * the comparison it feeds. Each option below is probed with the same six values.
 */
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { BymaxRealtimeModule } from '../realtime.module'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }

/** The options of one probe: `transport` is one the option applies to, the value goes where the path says. */
type Case = {
  readonly path: string
  readonly build: (value: unknown) => unknown
  /** The least the option may be: what the refusal message says. */
  readonly least: number
  /** The most the option may be, with the reason it has one: what the refusal message says. */
  readonly most: number
  /** Values the option must still accept. */
  readonly accepts: readonly number[]
}

/** Ceilings: an integer past them is a bound in name only, since nothing real is that large. */
const PER_USER_CEILING = 100_000 // beyond the ports one client address has, and the descriptors an instance has
const REPLAY_CEILING = 100_000 // events held per user stream: memory is this times the frame size
const BUFFER_CEILING = 100 * 1024 * 1024 // bytes one message may buffer while it assembles; Socket.IO's default is 1,000,000

const CASES: readonly Case[] = [
  {
    path: 'sse.maxConnectionsPerUser',
    build: (value) => ({ sse: { maxConnectionsPerUser: value } }),
    least: 0,
    most: PER_USER_CEILING,
    accepts: [0, 1, 5, PER_USER_CEILING],
  },
  {
    path: 'sse.replayBufferSize',
    build: (value) => ({ sse: { replayBufferSize: value } }),
    least: 0,
    most: REPLAY_CEILING,
    accepts: [0, 1, 100, REPLAY_CEILING],
  },
  {
    path: 'websocket.maxConnectionsPerUser',
    build: (value) => ({ websocket: { maxConnectionsPerUser: value } }),
    least: 0,
    most: PER_USER_CEILING,
    accepts: [0, 1, 5, PER_USER_CEILING],
  },
  {
    path: 'websocket.maxHttpBufferSize',
    build: (value) => ({ websocket: { maxHttpBufferSize: value } }),
    least: 1,
    most: BUFFER_CEILING,
    accepts: [1, 1_000_000, BUFFER_CEILING],
  },
]

/** What a bound written as a comparison lets through, and what an integer option must refuse. */
const PROBES: readonly unknown[] = [Number.NaN, Infinity, -1, 0, 1.5, '3']

function options(value: unknown, build: Case['build']): BymaxRealtimeModuleOptions {
  return {
    transport: 'sse',
    authenticator,
    ...(build(value) as object),
  } as BymaxRealtimeModuleOptions
}

describe.each(CASES)('$path', ({ path, build, least, most, accepts }) => {
  // Scenario: NaN, Infinity, a negative, a fraction and a numeric string. Expected: each is refused
  // with the stable code and the least the option may be, and zero only where zero is allowed.
  it.each(PROBES.filter((probe) => probe !== 0 || least > 0))('refuses %p', (probe) => {
    expect(() => validateOptions(options(probe, build))).toThrow(
      `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.${path} must be an integer >= ${least} and <= ${most}, got ${String(probe)}`,
    )
  })

  // Scenario: an integer no real value is: past the ceiling, beyond the safe integers, or the largest
  // double. Expected: each is refused with the ceiling in the message, so the bound is a bound.
  it.each([most + 1, 2 ** 53, 1e300, Number.MAX_VALUE])('refuses %p', (probe) => {
    expect(() => validateOptions(options(probe, build))).toThrow(
      `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.${path} must be an integer >= ${least} and <= ${most}, got ${String(probe)}`,
    )
  })

  // Scenario: the values the option exists for. Expected: they are accepted, and so is leaving it unset.
  it.each(accepts)('accepts %p', (value) => {
    expect(() => validateOptions(options(value, build))).not.toThrow()
  })

  it('accepts the option unset', () => {
    expect(() => validateOptions(options(undefined, build))).not.toThrow()
  })
})

describe('options with no ceiling of their own', () => {
  // Scenario: an integer past the safe integers where the option has a least and no most. Expected:
  // refused, because `Number.isInteger(1e300)` is true and the cap would then never fire.
  it.each([
    ['maxConnections', (v: unknown) => ({ maxConnections: v })],
    ['sse.maxQueuedBytes', (v: unknown) => ({ sse: { maxQueuedBytes: v } })],
    ['sse.maxQueuedEvents', (v: unknown) => ({ sse: { maxQueuedEvents: v } })],
    ['sse.stallHeartbeats', (v: unknown) => ({ sse: { stallHeartbeats: v } })],
    ['maxPendingHandshakes', (v: unknown) => ({ maxPendingHandshakes: v })],
    ['sse.replayMaxIdleUsers', (v: unknown) => ({ sse: { replayMaxIdleUsers: v } })],
    [
      'reauthenticationPolicy.concurrency',
      (v: unknown) => ({ reauthenticationPolicy: { concurrency: v } }),
    ],
    [
      'reauthenticationPolicy.cacheTtlMs',
      (v: unknown) => ({ reauthenticationPolicy: { cacheTtlMs: v } }),
    ],
  ] as const)('%s refuses 1e300 and 2 ** 53', (path, build) => {
    for (const probe of [1e300, 2 ** 53]) {
      expect(() => validateOptions(options(probe, build))).toThrow(
        `options.${path} must be an integer >= `,
      )
      expect(() => validateOptions(options(probe, build))).toThrow(`, got ${String(probe)}`)
    }
  })
})

describe('the refusal of an integer past the safe integers', () => {
  // Scenario: 1e300 for an option with no most. Expected: the message says what the most is, because
  // the value is an integer and a reader would otherwise not see what is wrong with it.
  it('names the largest safe integer', () => {
    expect(() => validateOptions(options(1e300, (v) => ({ maxConnections: v })))).toThrow(
      `options.maxConnections must be an integer >= 1, got 1e+300 (the most is ${Number.MAX_SAFE_INTEGER})`,
    )
  })
})

describe('registration', () => {
  // Constraint: `forRoot` rejects an invalid bound before it returns a module registration, so no
  // instance runs with the cap off. Scenario: a module is registered with NaN as a bound.
  it.each(CASES.map((c) => [c.path, c.build] as const))(
    'forRoot refuses NaN for %s',
    (_path, build) => {
      expect(() => BymaxRealtimeModule.forRoot(options(Number.NaN, build) as never)).toThrow(
        'REALTIME_INVALID_OPTIONS',
      )
    },
  )
})
