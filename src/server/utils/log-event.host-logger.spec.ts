/**
 * @fileoverview A logger the host supplies that throws, or whose async method rejects, while the library logs an event.
 * @layer utils
 *
 * The logger is Nest's own `Logger`, delegating to the host's through `Logger.overrideLogger`, which is the path a
 * host's `app.useLogger` takes. A logger that throws synchronously is absorbed: the line is lost and the call that
 * was logging goes on. A logger whose method returns a rejected promise is not in the library's reach: Nest's
 * `Logger` discards what the method returns, so the rejection is an unhandled rejection of the host's process.
 */
import { Logger, type LoggerService } from '@nestjs/common'
import {
  build,
  mkAuth,
  mkConnections,
  mkOptions,
  mkRealtime,
} from '../../../test/fixtures/reauthentication/harness'
import { logEvent } from './log-event'

const quiet = { log: () => undefined, debug: () => undefined, verbose: () => undefined }

/** A host logger whose `warn` and `error` throw, as a transport with a closed socket can. */
const throwing = (): LoggerService => ({
  ...quiet,
  warn: () => {
    throw new Error('host logger warn threw')
  },
  error: () => {
    throw new Error('host logger error threw')
  },
})

afterEach(() => {
  Logger.overrideLogger(false)
  jest.restoreAllMocks()
})

describe('logEvent with a host logger that throws', () => {
  // Scenario: the host's logger throws on warn and on error. Expected: logEvent returns, so the failure it was
  // reporting does not become a second failure in the caller's handler. Why: logEvent is called from catch blocks and
  // from promise handlers, where a throw is an unhandled rejection or ends the cleanup that was running.
  it.each(['warn', 'error'] as const)('absorbs a throw on %s', (level) => {
    Logger.overrideLogger(throwing())
    const logger = new Logger('Component')

    expect(() => logEvent(logger, level, 'REALTIME_HOOK_FAILED', 'a hook failed')).not.toThrow()
  })

  // Scenario: the host's logger works. Expected: the event reaches it as before, so the guard costs nothing.
  it('still delivers the event to a logger that works', () => {
    const warn = jest.fn()
    Logger.overrideLogger({ ...quiet, warn, error: jest.fn() })

    logEvent(new Logger('Component'), 'warn', 'REALTIME_HOOK_FAILED', 'a hook failed', { n: 1 })

    expect(warn).toHaveBeenCalledWith(
      { event: 'REALTIME_HOOK_FAILED', message: 'a hook failed', n: 1 },
      'Component',
    )
  })
})

describe('a library path that logs from a promise handler, with a host logger that throws', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  // Scenario: a re-authentication cycle rejects while the host's logger throws on warn. Expected: no unhandled
  // rejection and the timer keeps running. Why: the cycle's failure is logged from the handler of the timer's
  // promise, so a throw there would be the process's unhandled rejection, which ends a Node process by default.
  it('does not turn the failure of a cycle into an unhandled rejection', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      Logger.overrideLogger(throwing())
      const svc = build(
        mkConnections([]),
        mkRealtime(),
        mkAuth(jest.fn()),
        mkOptions({ intervalSeconds: 1 }),
      )
      const cycle = jest.spyOn(svc, 'runCycle').mockRejectedValue(new Error('cycle boom'))

      svc.onModuleInit()
      await jest.advanceTimersByTimeAsync(2_000)
      svc.onApplicationShutdown()
      await jest.advanceTimersByTimeAsync(0)

      expect(cycle).toHaveBeenCalledTimes(2)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
