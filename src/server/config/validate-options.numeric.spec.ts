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
  /** Values the option must still accept. */
  readonly accepts: readonly number[]
}

const CASES: readonly Case[] = [
  {
    path: 'sse.maxConnectionsPerUser',
    build: (value) => ({ sse: { maxConnectionsPerUser: value } }),
    least: 0,
    accepts: [0, 1, 5],
  },
  {
    path: 'sse.replayBufferSize',
    build: (value) => ({ sse: { replayBufferSize: value } }),
    least: 0,
    accepts: [0, 1, 100],
  },
  {
    path: 'websocket.maxConnectionsPerUser',
    build: (value) => ({ websocket: { maxConnectionsPerUser: value } }),
    least: 0,
    accepts: [0, 1, 5],
  },
  {
    path: 'websocket.maxHttpBufferSize',
    build: (value) => ({ websocket: { maxHttpBufferSize: value } }),
    least: 1,
    accepts: [1, 1_000_000],
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

describe.each(CASES)('$path', ({ path, build, least, accepts }) => {
  // Scenario: NaN, Infinity, a negative, a fraction and a numeric string. Expected: each is refused
  // with the stable code and the least the option may be, and zero only where zero is allowed.
  it.each(PROBES.filter((probe) => probe !== 0 || least > 0))('refuses %p', (probe) => {
    expect(() => validateOptions(options(probe, build))).toThrow(
      `[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: options.${path} must be an integer >= ${least}, got ${String(probe)}`,
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

describe('registration', () => {
  // Scenario: a module is registered with NaN as a bound. Expected: start-up fails, so no instance
  // runs with the cap off. Why: the bound was reachable through forRoot, which is where it is set.
  it.each(CASES.map((c) => [c.path, c.build] as const))(
    'forRoot refuses NaN for %s',
    (_path, build) => {
      expect(() => BymaxRealtimeModule.forRoot(options(Number.NaN, build) as never)).toThrow(
        'REALTIME_INVALID_OPTIONS',
      )
    },
  )
})
