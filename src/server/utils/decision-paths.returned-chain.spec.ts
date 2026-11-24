/**
 * @fileoverview What a decision returns is refused when any object of its prototype chain holds a `then`, and a promise
 * the library reads a rejection from is handled whatever its constructor's species does.
 * @layer utils
 *
 * Constraint under test: returning an object from an async function makes the engine ask it, and everything it inherits
 * from, for a `then`. A class instance, a `Buffer`, a typed array or a stream inherits through more than one prototype.
 */
import { Readable } from 'node:stream'
import { AuthenticationGate } from '../services/authentication-gate.service'
import type { ConnectionAuthContext } from '../interfaces/connection-authenticator.interface'
import { returnable } from './builtin-baseline'
import { absorbed, awaitable, firstOf } from './within-deadline'

const CONTEXT: ConnectionAuthContext = {
  transport: 'sse',
  headers: {},
  cookies: {},
  query: {},
  ip: '203.0.113.9',
  userAgent: undefined,
}
const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }
const FORGED = { userId: 'attacker' }

/** Plants a `then` on `target` and returns what puts things back. */
function plant(target: object): () => void {
  Object.defineProperty(target, 'then', {
    configurable: true,
    value: (resolve: (value: unknown) => void) => resolve(FORGED),
  })
  return () => {
    Reflect.deleteProperty(target, 'then')
  }
}

class Identity {
  userId = 'u1'
}
class Admin extends Identity {}

describe('returnable: the value an async function is about to return', () => {
  // Scenario: primitives and null, and objects with no `then` anywhere in their chain. Expected: handed back as they are.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a plain record', { userId: 'u1' }],
    ['a record with no prototype', Object.assign(Object.create(null) as object, { userId: 'u1' })],
    ['an array', [1, 2]],
    ['a class instance', new Admin()],
    ['a Buffer', Buffer.from('x')],
    ['a typed array', new Uint8Array(2)],
    ['a stream', new Readable({ read() {} })],
  ])('hands back %s as it is', (_name, value) => {
    expect(returnable(value)).toBe(value)
  })

  // Scenario: a `then` is planted on one object of the chain, near or far: the value itself, its class prototype, a base
  // class prototype, the typed array and `Buffer` prototypes and a stream's. Expected: refused, and the `then` is not
  // read, so it does not run.
  it.each([
    ['the value itself', () => new Identity(), (v: object) => v],
    ['a class prototype', () => new Identity(), () => Identity.prototype],
    ['a base class prototype', () => new Admin(), () => Identity.prototype],
    ['Buffer.prototype', () => Buffer.from('x'), () => Buffer.prototype],
    ['the typed array prototype', () => new Uint8Array(2), () => Uint8Array.prototype],
    ['the stream prototype', () => new Readable({ read() {} }), () => Readable.prototype],
    ['a function', () => () => undefined, (v: object) => v],
  ])('refuses a then on %s', (_name, make, target) => {
    const value = make() as object
    const read = jest.fn()
    const restore = plant(target(value))
    Object.defineProperty(target(value), 'then', { configurable: true, get: read })
    try {
      expect(() => returnable(value)).toThrow(expect.objectContaining(REFUSED))
      expect(read).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

describe('the gate returns what a host answered only when nothing in its chain has a then', () => {
  // Scenario: a host promise resolves with an instance of a class, and a `then` is planted on that class's prototype after
  // the host resolved it and before the gate returns it. Expected: the gate refuses; the engine is never asked for the
  // `then` that would answer with another identity.
  it('refuses a then planted on the class of an answered identity', async () => {
    let restore = (): void => undefined
    const host = {
      authenticate: () =>
        new Promise((resolve) => {
          resolve(new Identity())
          restore = plant(Identity.prototype)
        }),
    }
    const gate = new AuthenticationGate({} as never, host as never)
    let outcome: unknown
    let failure: unknown

    try {
      outcome = await gate.authenticate(CONTEXT)
    } catch (error) {
      failure = error
    } finally {
      restore()
    }

    expect(outcome).toBeUndefined()
    expect(failure).toMatchObject(REFUSED)
  })
})

describe('a promise whose constructor has a species that throws', () => {
  const rejecting = (): Promise<unknown> => {
    const promise = Promise.reject(new Error('cause'))
    return Object.defineProperty(promise, 'constructor', {
      configurable: true,
      writable: true,
      value: {
        get [Symbol.species](): never {
          throw new Error('own species')
        },
      },
    }) as Promise<unknown>
  }
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  const unhandledDuring = async (run: () => unknown): Promise<unknown[]> => {
    const seen: unknown[] = []
    const listener = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', listener)
    try {
      await run()
      await tick()
      await tick()
    } finally {
      process.off('unhandledRejection', listener)
    }
    return seen
  }

  // Scenario: `absorbed` is given a rejecting promise whose species throws. Expected: its rejection is handled and the
  // process sees nothing.
  it('absorbed handles it', async () => {
    expect(await unhandledDuring(() => absorbed(rejecting()))).toEqual([])
  })

  // Scenario: `firstOf` is given such a promise, rejecting, next to one that never settles. Expected: the wait ends with the
  // promise's own rejection, its cause, and nothing reaches the process unhandled.
  it('firstOf ends with its cause and handles it', async () => {
    let failure: unknown
    const seen = await unhandledDuring(async () => {
      try {
        await firstOf(rejecting(), new Promise<never>(() => undefined))
      } catch (error) {
        failure = error
      }
    })

    expect(failure).toMatchObject({ message: 'cause' })
    expect(seen).toEqual([])
  })

  // Scenario: a promise whose own constructor cannot be replaced, so the library cannot be sure of its await. Expected:
  // the refusal carries the real cause, which is that it cannot carry the engine's constructor.
  it('awaitable refuses one that keeps a constructor of its own, naming the cause', () => {
    const promise = Promise.resolve(1)
    Object.defineProperty(promise, 'constructor', { value: Object, configurable: false })

    expect(() => awaitable(promise)).toThrow('cannot carry the engine constructor')
  })
})
