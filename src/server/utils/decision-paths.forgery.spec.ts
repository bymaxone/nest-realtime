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
import { Logger } from '@nestjs/common'
import {
  FORGED_BUILTINS,
  plantSelfErasingThen,
  withConstructorReplacedAndRestored,
  withPromiseForged,
  withSelfErasingThen,
} from '../../../test/support/forged-promise'
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
import { assertBuiltinsIntact } from './builtin-baseline'

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

  it('the second read of a replay carries only what the store returned', async () => {
    const storage = { retrieveSince: async () => [] }
    const queue = new OfflineQueueDeliveryService(storage as never, undefined, {
      authenticateTimeoutMs: 1_000,
    } as never)

    const events = await withPromiseForged(kind, INJECTED, () =>
      queue.retrieveAppended('u1', '0', { events: [], degraded: false }),
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

const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }
const MALLORY = { userId: 'mallory', roles: ['admin'] }

describe('with the constructor replaced and put back by a forged then', () => {
  // Scenario: the answer is read after the await, when the forged `then` has put the constructor back. Expected: the
  // replacement is seen before the await, so the call is refused and the forged answer is never read.
  it('the handshake gate refuses, and does not admit the forged identity', async () => {
    const gate = new AuthenticationGate({} as never, { authenticate: async () => null } as never)
    let outcome: unknown
    let failure: unknown

    await withConstructorReplacedAndRestored(ATTACKER, async () => {
      try {
        outcome = await gate.authenticate(CONTEXT)
      } catch (error) {
        failure = error
      }
    })

    expect(outcome).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  it('a connection whose revalidate answered false is still disconnected', async () => {
    const realtime = mkRealtime()
    const svc = build(
      mkConnections([mkRecord()]),
      realtime,
      mkAuth(jest.fn(async () => false)),
      mkOptions({ intervalSeconds: 60 }),
    )

    await withConstructorReplacedAndRestored(true, async () => {
      await svc.runCycle()
      await flush()
    })

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a replay is refused, and carries nothing the store did not return', async () => {
    const queue = new OfflineQueueDeliveryService(
      { retrieveSince: async () => [] } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let events: unknown
    let failure: unknown

    await withConstructorReplacedAndRestored(INJECTED, async () => {
      try {
        events = await queue.retrieve('u1', '0', new Set())
      } catch (error) {
        failure = error
      }
    })

    expect(events).toBeUndefined()
    expect(failure).toBeDefined()
  })
})

describe('with a then that erases itself, planted on a root prototype before the call', () => {
  // Scenario: the first promise resolved with an object is answered by the planted `then`. Expected: refused at entry,
  // before anything is resolved, and the planted answer is never used.
  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
  ])(
    'the handshake gate refuses, and does not admit the identity planted on %s',
    async (_name, root) => {
      const gate = new AuthenticationGate(
        {} as never,
        { authenticate: async () => ({ userId: 'alice' }) } as never,
      )
      let outcome: unknown
      let failure: unknown

      await withSelfErasingThen(root, MALLORY, async () => {
        try {
          outcome = await gate.authenticate(CONTEXT)
        } catch (error) {
          failure = error
        }
      })

      expect(outcome).toBeUndefined()
      expect(failure).toMatchObject(REFUSED)
    },
  )

  it('a connection whose revalidate answered false is still disconnected', async () => {
    const realtime = mkRealtime()
    const svc = build(
      mkConnections([mkRecord()]),
      realtime,
      mkAuth(jest.fn(async () => false)),
      mkOptions({ intervalSeconds: 60 }),
    )

    await withSelfErasingThen(Object.prototype, true, async () => {
      await svc.runCycle()
      await flush()
    })

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
  ])('a replay is refused, and carries no event planted on %s', async (_name, root) => {
    const queue = new OfflineQueueDeliveryService(
      { retrieveSince: async () => [{ id: 'e1', event: 'x', data: {}, createdAt: 0 }] } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let events: unknown
    let failure: unknown

    await withSelfErasingThen(root, INJECTED, async () => {
      try {
        events = await queue.retrieve('u1', '0', new Set())
      } catch (error) {
        failure = error
      }
    })

    expect(events).toBeUndefined()
    expect(failure).toBeDefined()
  })

  // Scenario: the store plants a `then` on Function.prototype while it answers, so the breach appears after the
  // call began. Expected: the gap read refuses; it is not served as an empty, degraded gap.
  it('a gap read refuses a breach that appears while the store answers', async () => {
    const queue = new OfflineQueueDeliveryService(
      {
        retrieveSince: () => {
          Object.defineProperty(Function.prototype, 'then', {
            configurable: true,
            value: undefined,
          })
          return []
        },
      } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let gap: unknown
    let failure: unknown

    try {
      gap = await queue.retrieveGap('u1', '0')
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Function.prototype, 'then')
    }

    expect(gap).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: the store fails with the refusal that was raised while a built-in was replaced, and the built-in is back
  // by the time the failure is sorted. Expected: the gap read refuses; it does not serve an empty, degraded gap.
  it('a gap read refuses a refusal raised earlier, whether or not the breach is still there', async () => {
    let refusal: unknown
    Object.defineProperty(Function.prototype, 'then', { configurable: true, value: undefined })
    try {
      assertBuiltinsIntact()
    } catch (error) {
      refusal = error
    } finally {
      Reflect.deleteProperty(Function.prototype, 'then')
    }
    const queue = new OfflineQueueDeliveryService(
      {
        retrieveSince: () => {
          throw refusal
        },
      } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let gap: unknown
    let failure: unknown

    try {
      gap = await queue.retrieveGap('u1', '0')
    } catch (error) {
      failure = error
    }

    expect(gap).toBeUndefined()
    expect(failure).toBe(refusal)
  })

  // Scenario: the store fails, and a `then` that erases itself is planted on Object.prototype while it does.
  // Expected: the gap read refuses; it does not return a gap that something else named.
  it('a gap read refuses a then planted while the store fails', async () => {
    const queue = new OfflineQueueDeliveryService(
      {
        retrieveSince: () =>
          new Promise((_resolve, reject) =>
            setImmediate(() => {
              plantSelfErasingThen(Object.prototype, { events: INJECTED, degraded: false })
              reject(new Error('store down'))
            }),
          ),
      } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let gap: unknown
    let failure: unknown

    try {
      gap = await queue.retrieveGap('u1', '0')
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Object.prototype, 'then')
    }

    expect(gap).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: the store answers with a full page, and the warning that the page hit its limit is where a `then` that
  // erases itself is planted, after every check that ran before the return. Expected: the gap read refuses.
  it('a gap read refuses a then planted by the warning for a full page', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `e${i}`,
      event: 'x',
      data: {},
      createdAt: 0,
    }))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      plantSelfErasingThen(Object.prototype, { events: INJECTED, degraded: false })
    })
    const queue = new OfflineQueueDeliveryService(
      { retrieveSince: () => full } as never,
      undefined,
      { authenticateTimeoutMs: 1_000 } as never,
    )
    let gap: unknown
    let failure: unknown

    try {
      gap = await queue.retrieveGap('u1', '0')
    } catch (error) {
      failure = error
    } finally {
      warn.mockRestore()
      Reflect.deleteProperty(Object.prototype, 'then')
    }

    expect(gap).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: no store is configured and a `then` is already planted when the gap is read. Expected: the gap read
  // refuses; an empty gap is not a reason to skip the check the other returns make.
  it('a gap read without a store refuses a then planted before it', async () => {
    const queue = new OfflineQueueDeliveryService(undefined, undefined, {
      authenticateTimeoutMs: 1_000,
    } as never)
    let gap: unknown
    let failure: unknown

    await withSelfErasingThen(Object.prototype, { events: INJECTED, degraded: false }, async () => {
      try {
        gap = await queue.retrieveGap('u1', '0')
      } catch (error) {
        failure = error
      }
    })

    expect(gap).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: the service has no storage, so the second read has nothing to ask, and a `then` is planted on Array.prototype
  // before the call. Expected: the second read refuses; an empty answer is not a reason to skip the check the other
  // returns make.
  it('a second read with nothing to ask refuses a then planted on arrays', async () => {
    const queue = new OfflineQueueDeliveryService(undefined, undefined, {
      authenticateTimeoutMs: 1_000,
    } as never)
    let appended: unknown
    let failure: unknown

    await withSelfErasingThen(Array.prototype, INJECTED, async () => {
      try {
        appended = await queue.retrieveAppended('u1', '0', { events: [], degraded: false })
      } catch (error) {
        failure = error
      }
    })

    expect(appended).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })
})

describe('the files whose answer is a decision', () => {
  const root = join(__dirname, '..')
  const bare = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // A Promise static by dot or by bracket, a destructured one, a promise built with `new`, `then`, `catch` and `finally`
  // called on something, and `then` called through `call`, `apply` or `bind`. Whitespace inside a match is not part of it.
  const FOUND =
    /\bnew\s+Promise\b|\bPromise\s*(?:\.\s*\w+|\[\s*['"`]\w+['"`]\s*\])|\{[^}]*\}\s*=\s*Promise\b|\.\s*(?:then|catch|finally)\s*\(|\bthen\s*\.\s*(?:call|apply|bind)|\[\s*['"`](?:then|catch|finally)['"`]\s*\]/g
  const matchesIn = (source: string): string[] =>
    (bare(source).match(FOUND) ?? []).map((found) => found.replace(/\s+/g, '')).sort()

  // Scenario: forms a scan that matched only `Promise.race` and `.then(` would miss. Expected: each is found.
  it.each([
    ["Promise['race'](x)", ["Promise['race']"]],
    ['const { race } = Promise', ['{race}=Promise']],
    ['Promise.try(f)', ['Promise.try']],
    ['Promise.withResolvers()', ['Promise.withResolvers']],
    ['p.catch(f)', ['.catch(']],
    ['p.finally(f)', ['.finally(']],
    ['then.call(p, f)', ['then.call']],
    ['p.then (f)', ['.then(']],
    ['p["then"]', ['["then"]']],
    ['new Promise((resolve) => resolve())', ['newPromise']],
    ['new  Promise<void>(f)', ['newPromise']],
    ['// Promise.race(x) /* p.then(f) */ // new Promise(f)', []],
  ])('finds %s', (source, expected) => {
    expect(matchesIn(source)).toEqual(expected)
  })

  // Files whose awaited answer decides admission, a revocation, a replay or a subscription. A match in one is a place
  // where a replaced built-in can put the answer; `withinDeadline` and `firstOf` are the waits they use. Each exempt match
  // is one site, listed with the reason nobody decides on it; a new match, or one more of the same, fails here.
  // Scenario: each file is read with its comments taken out. Expected: its matches are exactly the exempt ones.
  const EXEMPT: Record<string, readonly (readonly [match: string, reason: string])[]> = {
    'services/reauthentication.service.ts': [
      ['.catch(', 'the interval tick logs a cycle that threw; no answer is read'],
      [
        'Promise.all',
        'waits for every check to finish; the checks decide, and each reads its own answer',
      ],
      ['.then(', 'logs a hook failure; the hook runs after the decision'],
      ['.catch(', 'reports a failure of the failure event; the disconnect is not waiting for it'],
    ],
    // Boot time only, and older than the wait helper. `Promise.resolve` and `then` are not in the baseline, so this read is
    // not covered by the guard: the options it returns are validated after it, against the baseline.
    'config/guard-host-reads.ts': [
      ['Promise.resolve', 'boot-time read of a host factory, outside the guard'],
      ['then.call', 'boot-time read of a host factory, outside the guard'],
      ['newPromise', "adapts the host factory's callback at boot, outside the guard"],
    ],
    'pubsub/redis-realtime-pubsub.ts': [
      [
        'Promise.race',
        'the publish deadline: a late or lost publish is counted by its own path, not decided by it',
      ],
      [
        'newPromise',
        'the publish deadline timer: rejects with a fresh error, raced only by the publish wait',
      ],
      ['.catch(', 'a connect started in the background; its failure is retried, not read'],
      [
        'newPromise',
        'waits for a connecting publisher to settle before the quit; carries no value',
      ],
      [
        'newPromise',
        'the unreachable operand of the subscribe negotiation: resolved with a box it makes, read only through firstOf',
      ],
      ['Promise.resolve', 'returns at once when the connection is already up; carries no value'],
      ['.catch(', 'a refusal after boot marks the bus unsubscribed and logs; it admits nothing'],
      [
        '.then(',
        'a confirmation after boot marks the bus up or refused: availability state, not identity or admission',
      ],
    ],
    'utils/quit-within.ts': [
      ['newPromise', 'the shutdown bound for a client close; the answer is not read'],
      ['.then(', 'closes a client on shutdown; the answer is not read'],
      ['Promise.race', 'closes a client on shutdown; the answer is not read'],
    ],
    'utils/run-hook.ts': [
      ['newPromise', 'the hook timeout; a hook failure is logged, never decided on'],
      ['Promise.race', 'runs a hook whose failure is logged, never decided on'],
    ],
    'transports/sse/sse-subscription.handler.ts': [
      ['.then(', 'logs a failed lifecycle hook; the hook runs after the decision'],
    ],
    'utils/semaphore.ts': [['newPromise', 'a waiter for a free slot; carries no value']],
    'transports/sse/sse.transport.ts': [
      ['Promise.all', 'shutdown: waits for every connection to be cut'],
      [
        'Promise.all',
        'emitToUser: the failures it collects only choose between throwing to the emitter and logging; no identity, admission or replay is read. Tracked, not fixed here',
      ],
      ['.catch(', 'logs a disconnect that failed; the connection is already being closed'],
    ],
  }
  const FILES = [
    'services/authentication-gate.service.ts',
    'services/reauthentication.service.ts',
    'offline-queue/offline-queue-delivery.service.ts',
    'pubsub/redis-realtime-pubsub.ts',
    'config/guard-host-reads.ts',
    'utils/quit-within.ts',
    'utils/run-hook.ts',
    'utils/semaphore.ts',
    'utils/within-deadline.ts',
    'transports/sse/sse-subscription.handler.ts',
    'transports/sse/sse.transport.ts',
  ]

  it.each(FILES)('%s waits only through the helpers, bar its exempt sites', (file) => {
    const found = matchesIn(readFileSync(join(root, file), 'utf8'))

    expect(found).toEqual((EXEMPT[file] ?? []).map((site) => site[0]).sort())
  })
})
