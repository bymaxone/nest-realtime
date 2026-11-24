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
import { Logger } from '@nestjs/common'
import {
  FORGED_BUILTINS,
  plantSelfErasingThen,
  withConstructorReplacedAndRestored,
  hostCallThatSwapsInside,
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

describe('with the constructor replaced inside the host call and put back by a forged then', () => {
  // Scenario: the authenticator refuses (answers null), but while it runs it replaces the constructor of every promise
  // and a `then` that restores both and answers an identity. The replacement is gone by the time any check that follows an
  // await runs. Expected: the gate refuses, and the caller's await never reads the shared constructor, so the forged
  // identity is never delivered.
  it('the gate refuses what a host call swaps inside itself', async () => {
    const host = hostCallThatSwapsInside(null, ATTACKER)
    const gate = new AuthenticationGate({} as never, { authenticate: host.call } as never)
    let outcome: unknown
    let failure: unknown

    try {
      outcome = await gate.authenticate(CONTEXT)
    } catch (error) {
      failure = error
    } finally {
      host.restore()
    }

    expect(outcome).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })

  // Scenario: revalidate answers false and swaps inside its own call, as above, with `true` as the forged answer.
  // Expected: the connection is revoked, never kept.
  it('a connection whose revalidate answered false is revoked, not kept', async () => {
    const host = hostCallThatSwapsInside(false, true)
    const realtime = mkRealtime()
    const record = mkRecord()
    const svc = build(
      mkConnections([record]),
      realtime,
      mkAuth(jest.fn(host.call)),
      mkOptions({ intervalSeconds: 60 }),
    )

    try {
      await svc.runCycle()
      await flush()
    } finally {
      host.restore()
    }

    expect(realtime.disconnect).toHaveBeenCalledTimes(1)
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
