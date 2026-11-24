/**
 * @fileoverview A host call's own answer, a native promise or a record, is not asked for a `then` that the host left
 * behind to restore itself as it is read.
 * @layer utils
 *
 * Constraint under test: the gate and the bounded re-authentication await what a host call returned. A host that
 * installs accessors which put themselves back on the first read leaves nothing for a check made after the await.
 */
import { hostCallWithSelfRestoringAccessors } from '../../../test/support/forged-promise'
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
import { firstOf } from './within-deadline'

const CONTEXT: ConnectionAuthContext = {
  transport: 'sse',
  headers: {},
  cookies: {},
  query: {},
  ip: '203.0.113.9',
  userAgent: undefined,
}

const ATTACKER = { userId: 'attacker' }
const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }

describe('with accessors left behind that restore themselves as they are read', () => {
  // Scenario: the authenticator answers null, and while it runs it replaces the `constructor` and `then` of every promise
  // with accessors that put themselves back when read, then returns its own promise. The engine's await of that promise
  // reads both, and the `then` it is given answers with an identity. Nothing is left for a later check to find. Expected:
  // the gate refuses; the host's promise carries its own constructor, so the await reads neither accessor, and the ones
  // still in place are found by the check that follows.
  it('the gate refuses what a host promise is awaited through', async () => {
    const host = hostCallWithSelfRestoringAccessors(null, ATTACKER, 'promise')
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

  // Scenario: the authenticator is not async: it answers a plain record and leaves a `then` accessor on Object.prototype
  // that deletes itself when read and answers with an identity. Expected: the gate refuses, because the record is used as
  // it is, never asked for a `then`, and the accessor is still there for the check that follows.
  it('the gate refuses what a record answered by a host is awaited through', async () => {
    const host = hostCallWithSelfRestoringAccessors({ userId: 'u1' }, ATTACKER, 'record')
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

  // Scenario: revalidate answers false through a native promise and leaves the accessors behind, as above, with `true` as
  // the forged answer. Expected: the connection is revoked, never kept.
  it('a connection whose revalidate promise is read through them is revoked, not kept', async () => {
    const host = hostCallWithSelfRestoringAccessors(false, true, 'promise')
    const realtime = mkRealtime()
    const record = mkRecord()
    const svc = build(
      mkConnections([record]),
      realtime,
      mkAuth(jest.fn(host.call as never)),
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

describe('what a host authenticator may answer without being a promise', () => {
  class Identity {
    userId = 'u1'
  }
  const answerOf = async (answer: unknown): Promise<unknown> => {
    const gate = new AuthenticationGate({} as never, { authenticate: () => answer } as never)
    return gate.authenticate(CONTEXT)
  }

  // Scenario: a synchronous authenticator answers null, a plain record, or a record with no prototype. Expected: each
  // reaches the caller as it is.
  it.each([
    ['null', null],
    ['a plain record', { userId: 'u1' }],
    ['a record with no prototype', Object.assign(Object.create(null) as object, { userId: 'u1' })],
  ])('hands over %s as it is', async (_name, answer) => {
    expect(await answerOf(answer)).toBe(answer)
  })

  // Scenario: the answer is an instance of a class, or an object with a `then` of its own. Expected: it is awaited as a
  // value, so a thenable settles with what it resolves to, and an instance with no `then` is handed over whole.
  it('awaits a thenable and an instance, because either can have a then to ask for', async () => {
    const instance = new Identity()
    const thenable = { then: (resolve: (value: unknown) => void) => resolve({ userId: 'u2' }) }

    expect(await answerOf(instance)).toBe(instance)
    expect(await answerOf(thenable)).toEqual({ userId: 'u2' })
  })
})

describe('the Promise constructor this module pins on the promises it awaits', () => {
  const load = (): void => {
    jest.isolateModules(() => {
      require('./within-deadline')
    })
  }

  // Scenario: the module loads normally. Expected: it loads.
  it('loads when the engine constructor is in place', () => {
    expect(load).not.toThrow()
  })

  // Scenario: a host replaced `Promise.prototype.constructor` with its own function before the module loaded. Expected:
  // the load is refused, so the stranger is never pinned on a promise a decision awaits.
  it('refuses to load when the constructor slot holds another function', () => {
    const real = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'constructor',
    ) as PropertyDescriptor
    function Fake(): void {}
    Object.defineProperty(Promise.prototype, 'constructor', { ...real, value: Fake })
    try {
      expect(load).toThrow('replaced before this module loaded')
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', real)
    }
  })

  // Scenario: the replacement has the engine's prototype and name but is a plain function. Expected: refused, because it
  // does not print as native code.
  it('refuses a function that borrows the prototype and the name', () => {
    const real = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'constructor',
    ) as PropertyDescriptor
    function Promise_(): void {}
    Object.defineProperty(Promise_, 'name', { value: 'Promise' })
    Promise_.prototype = Promise.prototype
    Object.defineProperty(Promise.prototype, 'constructor', { ...real, value: Promise_ })
    try {
      expect(load).toThrow('replaced before this module loaded')
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', real)
    }
  })

  // Scenario: the slot holds a getter that answers the engine's own Promise. Expected: refused, because a read of the slot
  // runs the getter, which can answer something else the next time, and the slot is read as a descriptor.
  it('refuses a getter in the slot, even one that answers the engine constructor', () => {
    const real = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'constructor',
    ) as PropertyDescriptor
    const reads = jest.fn(() => real.value as unknown)
    Object.defineProperty(Promise.prototype, 'constructor', {
      configurable: true,
      get: reads,
    })
    try {
      expect(load).toThrow('replaced before this module loaded')
      expect(reads).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', real)
    }
  })
})

describe('a host promise that carries a constructor or a then of its own', () => {
  const gateOf = (answer: unknown): AuthenticationGate =>
    new AuthenticationGate({} as never, { authenticate: () => answer } as never)

  // Scenario: the host's promise has an own `then` that answers with an identity, and an own constructor it left
  // configurable. Expected: the library pins its own constructor over it, the await never calls that `then`, and the
  // honest answer is what the gate hands over.
  it('pins the engine constructor over a configurable one and never calls its then', async () => {
    const then = jest.fn()
    const promise = Promise.resolve(null)
    Object.defineProperty(promise, 'constructor', { value: function Fake() {}, configurable: true })
    Object.defineProperty(promise, 'then', { value: then, configurable: true })

    expect(await gateOf(promise).authenticate(CONTEXT)).toBeNull()
    expect(then).not.toHaveBeenCalled()
  })

  // Scenario: the host pinned its own constructor, non-configurable, so it cannot be replaced. Expected: refused; the
  // await would route through it.
  it('refuses one whose own constructor cannot be replaced', async () => {
    const promise = Promise.resolve(ATTACKER)
    Object.defineProperty(promise, 'constructor', {
      value: function Fake() {},
      configurable: false,
    })

    await expect(gateOf(promise).authenticate(CONTEXT)).rejects.toThrow()
  })

  // Scenario: the host froze its promise, so it cannot take the constructor. Expected: refused.
  it('refuses a frozen one', async () => {
    await expect(
      gateOf(Object.freeze(Promise.resolve(ATTACKER))).authenticate(CONTEXT),
    ).rejects.toThrow()
  })
})

describe('a host promise that is refused is not left behind', () => {
  const settleTicks = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  }

  // Scenario: the authenticator returns a frozen promise that rejects, which cannot take the pinned constructor.
  // Expected: the gate refuses, and the promise's rejection is read, so that the process sees no unhandled rejection.
  it('reads the rejection of a refused promise at the gate', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => void seen.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const gate = new AuthenticationGate(
      {} as never,
      { authenticate: () => Object.freeze(Promise.reject(new Error('host'))) } as never,
    )

    try {
      await expect(gate.authenticate(CONTEXT)).rejects.toThrow(TypeError)
      await settleTicks()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(seen).toEqual([])
  })

  // Scenario: a queue store returns a frozen promise, on a queue that allows two reads at once, three times over.
  // Expected: no read keeps its place, so the next read of an honest store is answered and not refused as a timeout.
  it('gives back the place a refused store promise was holding', async () => {
    let answer: () => unknown = () => Object.freeze(Promise.resolve([]))
    const storage = { retrieveSince: () => answer() }
    const queue = new OfflineQueueDeliveryService(storage as never, undefined, {
      authenticateTimeoutMs: 1_000,
      maxPendingHandshakes: 2,
    } as never)

    for (let i = 0; i < 3; i++) await queue.retrieve('u1', '0', new Set()).catch(() => undefined)
    answer = async () => []

    expect((queue as unknown as { pending: number }).pending).toBe(0)
  })

  // Scenario: firstOf is given a promise that rejects and cannot be pinned (it is frozen), and one that is fine.
  // Expected: it refuses, and the rejection of the first is read, so the process sees no unhandled rejection.
  it('reads the rejection of both promises when firstOf refuses', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => void seen.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const refused = Object.freeze(Promise.reject(new Error('host')))

    try {
      expect(() => firstOf(refused, Promise.resolve(1))).toThrow(TypeError)
      await settleTicks()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(seen).toEqual([])
  })
})
