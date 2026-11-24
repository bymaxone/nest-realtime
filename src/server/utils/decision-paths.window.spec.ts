/**
 * @fileoverview Nothing a host can replace runs between a decision's last check and the await that reads its answer, the
 * wait that absorbs a rejection does not read the slot it guards, and a decision's object return is checked last.
 * @layer utils
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { plantSelfErasingThen } from '../../../test/support/forged-promise'
import { AuthenticationGate } from '../services/authentication-gate.service'
import type { ConnectionAuthContext } from '../interfaces/connection-authenticator.interface'
import {
  absorbed,
  awaitable,
  firstOf,
  isPlainResult,
  shielded,
  withinDeadline,
} from './within-deadline'

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

describe('the window between a decision check and its await', () => {
  // Scenario: the host hooks `AbortController`, which the gate builds for the authenticator, and plants a `then` on
  // Object.prototype that erases itself on first use and answers for the attacker; the authenticator then answers an
  // identity. Expected: the gate refuses; the check comes after everything a host can hook, so the plant is seen before
  // the authenticator's answer can read it.
  it('the gate refuses what a hooked AbortController plants for the authenticator', async () => {
    const RealAbortController = globalThis.AbortController
    globalThis.AbortController = class extends RealAbortController {
      constructor() {
        super()
        plantSelfErasingThen(Object.prototype, ATTACKER)
      }
    }
    const gate = new AuthenticationGate(
      {} as never,
      { authenticate: async () => ({ userId: 'alice' }) } as never,
    )
    let result: unknown
    let failure: unknown

    try {
      result = await gate.authenticate(CONTEXT)
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Object.prototype, 'then')
      globalThis.AbortController = RealAbortController
    }

    expect(result).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })
})

describe('the order of the gate before it asks the authenticator', () => {
  // Scenario: the gate's source is read in order. Expected: everything a host can hook (the controller and its signal) is
  // made before the last check that precedes the authenticator's call, and nothing is made between that check and the
  // call. A behavioural row cannot tell the orders apart, because the wait that follows checks again; this one fixes it.
  it('makes the controller and reads its signal before the last check', () => {
    const source = readFileSync(
      join(__dirname, '..', 'services/authentication-gate.service.ts'),
      'utf8',
    )
    const body = source.slice(source.indexOf('async decide('))
    const controller = body.indexOf('new AbortController()')
    const signal = body.indexOf('const { signal } = controller')
    const lastCheck = body.lastIndexOf('assertBuiltinsIntact()', body.indexOf('shielded('))

    expect(controller).toBeGreaterThan(-1)
    expect(signal).toBeGreaterThan(controller)
    expect(lastCheck).toBeGreaterThan(signal)
  })
})

describe('the wait that absorbs a rejection', () => {
  const RealConstructor = Promise
  const original = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    'constructor',
  ) as PropertyDescriptor

  // The frames of every read of the shared `constructor` slot made while `run` executes, counting only the synchronous part.
  const readsDuring = (run: () => void): string[] => {
    const stacks: string[] = []
    Object.defineProperty(Promise.prototype, 'constructor', {
      configurable: true,
      get() {
        stacks.push(new Error('read').stack ?? '')
        return RealConstructor
      },
    })
    try {
      run()
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', original)
    }
    return stacks
  }

  // Scenario: a promise the library made is absorbed while the shared constructor slot is observed. Expected: the absorbing
  // await never reads the slot, so a host that makes it throw cannot stop the rejection from being handled.
  it('does not read the shared constructor of a promise the library made', async () => {
    const own = shielded(Promise.reject(new Error('own')))

    const reads = readsDuring(() => void absorbed(own))
    await absorbed(own)

    expect(reads.filter((stack) => stack.includes('absorbed'))).toHaveLength(0)
  })

  // Scenario: every async method of the library that a decision path awaits, out to the outermost hop, is called inside
  // `shielded(`, so that the caller's await never reads the shared slot. Expected: no call to one of them is left bare,
  // and each is called at least once; an await of a bare one reads a constructor that a host call can have replaced and
  // put back.
  it.each([
    ['services/authentication-gate.service.ts', ['this.decide']],
    ['services/reauthentication.service.ts', ['this.bound']],
    ['pubsub/redis-realtime-pubsub.ts', ['this.negotiate']],
    ['offline-queue/offline-queue-delivery.service.ts', ['this.retrieveGap', 'this.read']],
    [
      'transports/sse/sse-subscription.handler.ts',
      [
        'this.transport.registerConnection',
        'this.authenticateRequest',
        'this.admitAndAuthenticate',
        'this.readQueue',
        'this.readAppended',
        'this.offlineDelivery.retrieveGap',
        'this.offlineDelivery.retrieveAppended',
      ],
    ],
  ])('%s calls each awaited method inside shielded()', (file, callees) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8')
    const bare: string[] = []
    const missing: string[] = []

    for (const callee of callees) {
      const calls = [
        ...source.matchAll(new RegExp(`${callee.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\(`, 'g')),
      ]
      if (calls.length === 0) missing.push(callee)
      for (const call of calls) {
        const before = source.slice(0, call.index).replace(/\s+$/, '')
        if (!before.endsWith('shielded(')) bare.push(callee)
      }
    }

    expect(missing).toEqual([])
    expect(bare).toEqual([])
  })

  // Scenario: an await of a promise that nothing shielded, made by a function of this file. Expected: the probe sees the
  // read of the slot, so the rows above can fail.
  it('is observed when a promise is awaited without being shielded', async () => {
    const foreign = Promise.reject(new Error('foreign'))
    const awaitBare = async (call: Promise<unknown>): Promise<void> => {
      try {
        await call
      } catch {
        // Read by the probe, not by the row.
      }
    }

    const reads = readsDuring(() => void awaitBare(foreign))
    await awaitBare(foreign)

    expect(reads.filter((stack) => stack.includes('awaitBare'))).toHaveLength(1)
  })

  // Scenario: `absorbed` is given a native promise that nothing shielded. Expected: it pins the constructor before it
  // awaits, so the wait reads no slot on `Promise.prototype`.
  it('absorbed reads no slot of a promise that nothing shielded', async () => {
    const foreign = Promise.reject(new Error('foreign'))

    const reads = readsDuring(() => void absorbed(foreign))
    await absorbed(foreign)

    expect(reads.filter((stack) => stack.includes('absorbed'))).toHaveLength(0)
  })
})

describe('shielded', () => {
  // Scenario: a value that is not an object. Expected: returned as it is; there is nothing to shield.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'text'],
  ])('returns %s as it is', (_name, value) => {
    expect(shielded(value)).toBe(value)
  })

  // Scenario: a promise that cannot take the constructor, because it is frozen. Expected: refused, since an await of it
  // would read the shared slot.
  it('refuses a frozen promise', () => {
    expect(() => shielded(Object.freeze(Promise.resolve()))).toThrow(TypeError)
  })

  // Scenario: a promise the library made. Expected: it carries its own constructor, the intrinsic one.
  it('gives a promise its own constructor', () => {
    const made = shielded(Promise.resolve())

    expect(Object.hasOwn(made, 'constructor')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(made, 'constructor')).toMatchObject({
      writable: false,
      configurable: false,
    })
  })
})

describe('the promise a wait hands to its caller', () => {
  const options = { timeoutError: () => new Error('deadline') }
  const realConstructor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    'constructor',
  ) as PropertyDescriptor

  // Scenario: a wait that settles normally, one that refused at once because the constructor was replaced before it began
  // (the path that skips the last check), and `firstOf` on both. Expected: every promise handed over carries its own
  // constructor, so the caller's await never reads the shared slot, whatever a host call did while the wait ran.
  it.each([
    ['a wait that settles', false],
    ['a wait that refused before its timer was armed', true],
  ])('%s hands over a promise with its own constructor', async (_name, replaced) => {
    if (replaced) {
      Object.defineProperty(Promise.prototype, 'constructor', {
        ...realConstructor,
        value: function Fake() {},
      })
    }
    let handed: Promise<unknown> | undefined
    try {
      handed = withinDeadline(Promise.resolve(1), 1_000, options)
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', realConstructor)
    }
    const own = Object.hasOwn(handed, 'constructor')
    await absorbed(handed)

    expect(own).toBe(true)
  })

  it('firstOf hands over a promise with its own constructor', async () => {
    const handed = firstOf(Promise.resolve(1), new Promise<number>(() => undefined))
    const own = Object.hasOwn(handed, 'constructor')
    await absorbed(handed)

    expect(own).toBe(true)
  })
})

describe('a decision that returns an object', () => {
  // Scenario: an accessor `then` is planted on Object.prototype after the authenticator was asked and before it answers; the
  // first read of it is the host's own resolution and the second is the engine resolving the gate's return. Expected: the
  // gate refuses and the accessor answers for nobody.
  it('the gate refuses an accessor then planted while its wait is pending', async () => {
    let release: ((value: unknown) => void) | undefined
    const gate = new AuthenticationGate(
      {} as never,
      {
        authenticate: () =>
          new Promise((resolve) => {
            release = resolve
          }),
      } as never,
    )
    let reads = 0
    let answered = 0
    let result: unknown
    let failure: unknown
    const started = gate.authenticate(CONTEXT)
    await new Promise((resolve) => setImmediate(resolve))

    Object.defineProperty(Object.prototype, 'then', {
      configurable: true,
      get() {
        reads += 1
        if (reads === 1) return undefined
        Reflect.deleteProperty(Object.prototype, 'then')
        return (resolve: (value: unknown) => void) => {
          answered += 1
          resolve(ATTACKER)
        }
      },
    })
    release?.({ userId: 'alice' })
    try {
      result = await started
    } catch (error) {
      failure = error
    } finally {
      Reflect.deleteProperty(Object.prototype, 'then')
    }

    expect(answered).toBe(0)
    expect(result).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })
})

describe('a promise a host call returned', () => {
  const pinned = { writable: false, configurable: false }
  const settle = (): { promise: Promise<number>; resolve: (n: number) => void } => {
    let resolve: (n: number) => void = () => undefined
    const promise = new Promise<number>((r) => (resolve = r))
    return { promise, resolve }
  }

  // Scenario: a native promise is handed to a wait. Expected: it has its own pinned constructor before anything awaits it.
  it('withinDeadline gives it its own constructor', async () => {
    const work = settle()
    const wait = withinDeadline(work.promise, 1000, { timeoutError: () => new Error('late') })
    work.resolve(1)
    await wait

    expect(Object.getOwnPropertyDescriptor(work.promise, 'constructor')).toMatchObject(pinned)
  })

  // Scenario: two native promises are handed to firstOf. Expected: both have their own pinned constructor.
  it('firstOf gives both of them their own constructor', async () => {
    const a = settle()
    const b = settle()
    const wait = firstOf(a.promise, b.promise)
    a.resolve(1)
    await wait

    expect(Object.getOwnPropertyDescriptor(a.promise, 'constructor')).toMatchObject(pinned)
    expect(Object.getOwnPropertyDescriptor(b.promise, 'constructor')).toMatchObject(pinned)
  })

  // Scenario: results of every shape. Expected: only a native promise is changed, and only a value with no then to ask for
  // is plain.
  it('tells a promise, a plain value and a thenable apart', () => {
    const native = Promise.resolve(1)
    const thenable = { then: () => undefined }

    expect(awaitable(native)).toBe(native)
    expect(Object.hasOwn(native, 'constructor')).toBe(true)
    expect(awaitable(thenable)).toBe(thenable)
    expect(Object.hasOwn(thenable, 'constructor')).toBe(false)
    expect(isPlainResult(undefined)).toBe(true)
    expect(isPlainResult(5)).toBe(true)
    expect(isPlainResult(null)).toBe(true)
    expect(isPlainResult({})).toBe(true)
    expect(isPlainResult(Object.create(null))).toBe(true)
    expect(isPlainResult(thenable)).toBe(false)
    expect(isPlainResult(native)).toBe(false)
    expect(isPlainResult(() => 1)).toBe(false)
    expect(isPlainResult(new (class Identity {})())).toBe(false)
  })
})
