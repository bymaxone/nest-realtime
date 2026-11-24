/**
 * @fileoverview A decision that reads the settled value of a bounded call is not changed by a Promise built-in
 * that was replaced after the library loaded.
 * @layer utils
 *
 * Constraint under test: the handshake gate, the re-authentication revalidate and the offline-queue replay read
 * what a call settled with, under a deadline. If that read goes through `Promise.race`, `Promise.resolve` or a
 * `then` that a host can replace, a refused handshake is admitted as whoever the replacement names, a revoked
 * connection is kept, and a replay carries events the store never held.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORGED_BUILTINS, withPromiseForged } from '../../../test/support/forged-promise'
import {
  build,
  flush,
  mkAuth,
  mkConnections,
  mkOptions,
  mkRealtime,
  mkRecord,
} from '../../../test/fixtures/reauthentication/harness'
import { OfflineQueueDeliveryService } from '../offline-queue/offline-queue-delivery.service'
import { AuthenticationGate } from '../services/authentication-gate.service'
import type { ConnectionAuthContext } from '../interfaces/connection-authenticator.interface'

const CONTEXT: ConnectionAuthContext = {
  transport: 'sse',
  headers: {},
  cookies: {},
  query: {},
  ip: '203.0.113.9',
  userAgent: undefined,
}

const ATTACKER = { userId: 'attacker' }
const INJECTED = [{ id: 'injected', event: 'x', data: {}, createdAt: 0 }]

describe.each(FORGED_BUILTINS)('with Promise.%s replaced after load', (kind) => {
  // A refusal stays a refusal: the authenticator said no, and the replacement cannot say yes.
  it('the handshake gate still refuses what the authenticator refused', async () => {
    const gate = new AuthenticationGate({} as never, { authenticate: async () => null } as never)

    const result = await withPromiseForged(kind, ATTACKER, () => gate.authenticate(CONTEXT))

    expect(result).toBeNull()
  })

  it('the handshake gate still throws what the authenticator threw', async () => {
    const failure = new Error('the session store is down')
    const gate = new AuthenticationGate(
      {} as never,
      {
        authenticate: async () => {
          throw failure
        },
      } as never,
    )

    const outcome = await withPromiseForged(kind, ATTACKER, async () => {
      try {
        return await gate.authenticate(CONTEXT)
      } catch (error) {
        return error
      }
    })

    expect(outcome).toBe(failure)
  })

  // A revoked connection is disconnected: `true` from the replacement is not the authenticator's answer.
  it('a connection whose revalidate answered false is still disconnected', async () => {
    const realtime = mkRealtime()
    const svc = build(
      mkConnections([mkRecord()]),
      realtime,
      // An async function, not `mockResolvedValue`: that calls `Promise.resolve`, and would be forged itself.
      mkAuth(jest.fn(async () => false)),
      mkOptions({ intervalSeconds: 60 }),
    )

    await withPromiseForged(kind, true, async () => {
      await svc.runCycle()
      await flush()
    })

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a replay carries only what the store returned', async () => {
    const storage = { retrieveSince: async () => [] }
    const queue = new OfflineQueueDeliveryService(storage as never, undefined, {
      authenticateTimeoutMs: 1_000,
    } as never)

    const events = await withPromiseForged(kind, INJECTED, () =>
      queue.retrieve('u1', '0', new Set()),
    )

    expect(events).toEqual([])
  })
})

/** Runs `run` with `Promise.prototype.then` wrapped the way an APM does: it calls the real one and passes the value on. */
async function withDelegatingThen<T>(run: () => Promise<T>): Promise<T> {
  const realThen = Promise.prototype.then
  const proto = Promise.prototype as unknown as Record<string, unknown>
  proto['then'] = function (this: Promise<unknown>, ...args: unknown[]) {
    return (realThen as (...a: unknown[]) => unknown).apply(this, args)
  }
  try {
    return await run()
  } finally {
    proto['then'] = realThen
  }
}

describe('with a then that delegates, as an APM wraps it, and fake timers', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('the gate admits what the authenticator admitted and refuses on the deadline', async () => {
    const admit = new AuthenticationGate(
      { authenticateTimeoutMs: 50 } as never,
      { authenticate: async () => ({ userId: 'u1' }) } as never,
    )
    const hang = new AuthenticationGate(
      { authenticateTimeoutMs: 50 } as never,
      { authenticate: () => new Promise(() => undefined) } as never,
    )

    const admitted = await withDelegatingThen(() => admit.authenticate(CONTEXT))
    const outcome = await withDelegatingThen(async () => {
      const waiting = (async () => {
        try {
          return await hang.authenticate(CONTEXT)
        } catch (error) {
          return error
        }
      })()
      jest.advanceTimersByTime(50)
      return await waiting
    })

    expect(admitted).toEqual({ userId: 'u1' })
    expect((outcome as { reason?: string }).reason).toBe('timeout')
  })

  it.each([
    [true, 0],
    [false, 1],
  ])(
    'a connection whose revalidate answered %s is disconnected %i times',
    async (answer, calls) => {
      const realtime = mkRealtime()
      const svc = build(
        mkConnections([mkRecord()]),
        realtime,
        mkAuth(jest.fn(async () => answer)),
        mkOptions({ intervalSeconds: 60 }),
      )

      await withDelegatingThen(async () => {
        await svc.runCycle()
        await flush()
      })

      expect(realtime.disconnect).toHaveBeenCalledTimes(calls)
    },
  )

  it('a replay carries what the store returned', async () => {
    const stored = [{ id: 'e1', event: 'x', data: {}, createdAt: 0 }]
    const queue = new OfflineQueueDeliveryService(
      { retrieveSince: async () => stored } as never,
      undefined,
      {
        authenticateTimeoutMs: 50,
      } as never,
    )

    const events = await withDelegatingThen(() => queue.retrieve('u1', '0', new Set()))

    expect(events).toEqual(stored)
  })
})

describe('with Promise.prototype.constructor replaced', () => {
  it('a connection whose revalidate answered true is refused, not kept', async () => {
    const realtime = mkRealtime()
    const svc = build(
      mkConnections([mkRecord()]),
      realtime,
      mkAuth(jest.fn(async () => true)),
      mkOptions({ intervalSeconds: 60 }),
    )
    const real = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'constructor',
    ) as PropertyDescriptor
    Object.defineProperty(Promise.prototype, 'constructor', { ...real, value: function Fake() {} })
    try {
      await svc.runCycle()
      await flush()
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', real)
    }

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('the files whose answer is a decision', () => {
  const root = join(__dirname, '..')
  const bare = (file: string): string =>
    readFileSync(join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  const FOUND = /Promise\.(race|all|allSettled|any|resolve|reject)\b|\.then\(/g

  // Files whose awaited answer decides admission, a revocation, a replay or a subscription. A Promise static or a `then`
  // call in one is a place where a replaced built-in can put the answer; `withinDeadline` is the only wait they use.
  // Scenario: each file is read with its comments taken out. Expected: it has no match, bar the exempt ones below, each
  // with the reason nobody reads its answer.
  const EXEMPT: Record<string, readonly string[]> = {
    // The cycle's `Promise.all` only waits for every check to finish, and the `then` logs a hook failure: neither is read.
    'services/reauthentication.service.ts': ['Promise.all', '.then('],
    // Boot-time promise of the host's own factory; the options read from it are validated, after it, against the baseline.
    'config/guard-host-reads.ts': ['Promise.resolve'],
    // The publish deadline's outcome is not read: a late or lost publish is counted by its own path, not decided by it.
    'pubsub/redis-realtime-pubsub.ts': ['Promise.race', 'Promise.resolve', '.then('],
    // Neither wait's outcome is read: one closes a client on shutdown, the other runs a hook whose failure is logged.
    'utils/quit-within.ts': ['Promise.race', '.then('],
    'utils/run-hook.ts': ['Promise.race'],
  }
  const FILES = [
    'services/authentication-gate.service.ts',
    'services/reauthentication.service.ts',
    'offline-queue/offline-queue-delivery.service.ts',
    'pubsub/redis-realtime-pubsub.ts',
    'config/guard-host-reads.ts',
    'utils/quit-within.ts',
    'utils/run-hook.ts',
    'utils/within-deadline.ts',
  ]

  it.each(FILES)('%s waits only through withinDeadline, bar its exempt sites', (file) => {
    const found = [...new Set(bare(file).match(FOUND) ?? [])].sort()

    expect(found).toEqual([...(EXEMPT[file] ?? [])].sort())
  })
})
