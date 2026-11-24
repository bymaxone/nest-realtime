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
import { absorbed, shielded } from './within-deadline'

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
    const body = source.slice(source.indexOf('async authenticate('))
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

  // Scenario: each library-made promise that a decision path absorbs is made by `shielded`. Expected: the gate, the Redis
  // negotiation and the handler's registration each wrap theirs once; a promise absorbed without it reads the shared slot.
  it.each([
    ['services/authentication-gate.service.ts', 1],
    ['pubsub/redis-realtime-pubsub.ts', 1],
    ['transports/sse/sse-subscription.handler.ts', 1],
  ])('%s shields the promise it hands to a wait', (file, count) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8')

    expect(source.match(/\bshielded\(/g)?.length).toBe(count)
  })

  // Scenario: the same read for a promise that is not the library's. Expected: the probe sees it, so the row above can fail.
  it('is observed when the promise is not shielded', async () => {
    const foreign = Promise.reject(new Error('foreign'))

    const reads = readsDuring(() => void absorbed(foreign))
    await absorbed(foreign)

    expect(reads.filter((stack) => stack.includes('absorbed'))).toHaveLength(1)
  })
})

describe('shielded', () => {
  // Scenario: a value that is not an object, and a promise that cannot take a property. Expected: each is returned as it is;
  // the first has nothing to shield and the second is awaited the way it was.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'text'],
    ['a frozen promise', Object.freeze(Promise.resolve())],
  ])('returns %s as it is', (_name, value) => {
    expect(shielded(value)).toBe(value)
  })

  // Scenario: a promise the library made. Expected: it carries its own constructor, the intrinsic one.
  it('gives a promise its own constructor', () => {
    const made = shielded(Promise.resolve())

    expect(Object.hasOwn(made, 'constructor')).toBe(true)
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
