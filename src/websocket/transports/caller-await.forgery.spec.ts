/**
 * @fileoverview The caller's own `await` of a library method that decides something reads no slot a host can replace.
 * @layer transport
 *
 * Constraint under test: a handshake, a revocation and a room change are answered by a promise that an `async` function
 * made, and the caller's `await` of that promise reads its `constructor`, and a `then` when that is not the intrinsic
 * one. A host call that replaces both while it runs, and puts them back the first time they are read, would otherwise
 * answer for the library's own method. Each row ends on an intrinsic `then`, because a test that awaits while the slots
 * are swapped is answered by the same replacement.
 */
import { EventEmitter } from 'node:events'
import { types } from 'node:util'
import { Logger } from '@nestjs/common'
import { RealtimeService } from '../../server/services/realtime.service'
import { AuthenticationGate } from '../../server/services/authentication-gate.service'
import { awaitable } from '../../server/utils/within-deadline'
import { hostCallThatSwapsInside } from '../../../test/support/forged-promise'
import { CompositeTransport } from './composite/composite.transport'
import { RealtimeGateway } from './websocket/realtime.gateway'

const realThen = Promise.prototype.then
const realConstructor = Object.getOwnPropertyDescriptor(
  Promise.prototype,
  'constructor',
) as PropertyDescriptor
const proto = Promise.prototype as unknown as Record<string, unknown>
const FORGED = { auth: { userId: 'attacker', tenantId: 't-victim', rooms: ['tenant:t-victim'] } }
const BUS_REFUSED = Object.assign(new Error('bus refused'), { code: 'REALTIME_PUBSUB_UNAVAILABLE' })

interface Outcome {
  readonly ok: boolean
  readonly value: unknown
}

/** Puts every slot a row may have replaced back. */
function restoreAll(): void {
  Object.defineProperty(Promise.prototype, 'constructor', realConstructor)
  proto['then'] = realThen
}

/**
 * Starts `start`, waits for its promise with the intrinsic `then`, puts the slots back, and hands the outcome to `check`.
 * Nothing in here awaits, so no replacement a row planted answers for the test.
 */
function drive(
  start: () => Promise<unknown>,
  check: (outcome: Outcome) => void,
  done: jest.DoneCallback,
): void {
  const finish = (outcome: Outcome): void => {
    restoreAll()
    try {
      check(outcome)
      done()
    } catch (error) {
      done(error as Error)
    }
  }
  let promise: Promise<unknown>
  try {
    promise = start()
  } catch (error) {
    restoreAll()
    done(error as Error)
    return
  }
  realThen.call(
    promise,
    (value: unknown) => finish({ ok: true, value }),
    (value: unknown) => finish({ ok: false, value }),
  )
}

/**
 * A host call that refuses with `error` and, synchronously while it runs, plants a constructor that puts itself back when
 * read, and a `then` that does the same and settles whatever it is asked about with success.
 */
function refusalThatPlants(error: Error): () => Promise<void> {
  return () => {
    const refused = Promise.reject(error)
    realThen.call(refused, undefined, () => undefined)
    Object.defineProperty(Promise.prototype, 'constructor', {
      configurable: true,
      get() {
        Object.defineProperty(Promise.prototype, 'constructor', realConstructor)
        return function Fake() {}
      },
    })
    proto['then'] = function (this: Promise<unknown>, onFulfilled?: (v: unknown) => unknown) {
      proto['then'] = realThen
      realThen.call(this, undefined, () => undefined)
      onFulfilled?.(undefined)
      return undefined
    }
    return refused
  }
}

afterEach(restoreAll)

describe('the handshake the gateway waits for', () => {
  // Scenario: the authenticator refuses (null) and, while it runs, swaps the constructor and a `then` that answers an
  // identity. Expected: the socket is disconnected and nothing is registered under the forged identity.
  it('does not register a socket whose authenticator refused', (done) => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const host = hostCallThatSwapsInside(null, FORGED)
    const gate = new AuthenticationGate({} as never, { authenticate: host.call } as never)
    const registered: unknown[] = []
    const transport = {
      setServer: () => undefined,
      admit: () => ({ release: () => undefined, renew: () => undefined }),
      authenticate: (context: unknown) => gate.authenticate(context as never),
      registerSocket: async (_socket: unknown, auth: unknown) => {
        registered.push(auth)
      },
      shuttingDown: false,
    }
    const gateway = new RealtimeGateway(transport as never, {} as never)
    const socket = {
      id: 's1',
      handshake: { address: '1.2.3.4', auth: {}, headers: { cookie: '' }, query: {} },
      conn: new EventEmitter(),
      disconnect: jest.fn(),
      emit: jest.fn(),
    }

    drive(
      () => gateway.handleConnection(socket as never),
      () => {
        host.restore()
        expect(registered).toEqual([])
        expect(socket.disconnect).toHaveBeenCalled()
      },
      done,
    )
  })
})

describe('a revocation that the transport refused', () => {
  // Scenario: the transport refuses and swaps the constructor and a `then` while it runs. Expected: the call rejects and
  // the eviction is not counted.
  it('is not reported as done by RealtimeService.disconnect', (done) => {
    const evicted: string[] = []
    const service = new RealtimeService(
      { kind: 'sse', disconnect: refusalThatPlants(BUS_REFUSED) } as never,
      undefined,
      { evicted: (reason: string) => evicted.push(reason) } as never,
    )

    drive(
      () => service.disconnect('c-remote', 'revoked'),
      (outcome) => {
        expect(outcome).toEqual({ ok: false, value: BUS_REFUSED })
        expect(evicted).toEqual([])
      },
      done,
    )
  })

  // Scenario: under 'both' the SSE side refuses and the WebSocket side resolves, with `Promise.allSettled` replaced by a
  // one-shot that reports both as fulfilled. Expected: the call rejects with the refusal.
  it('is not reported as done by the composite when allSettled is replaced', (done) => {
    const composite = new CompositeTransport(
      { disconnect: () => Promise.reject(BUS_REFUSED) } as never,
      { disconnect: async () => undefined } as never,
    )
    const realAllSettled = Promise.allSettled
    ;(Promise as unknown as Record<string, unknown>)['allSettled'] = (
      tasks: Promise<unknown>[],
    ) => {
      ;(Promise as unknown as Record<string, unknown>)['allSettled'] = realAllSettled
      tasks.forEach((task) => realThen.call(task, undefined, () => undefined))
      return Promise.resolve(tasks.map(() => ({ status: 'fulfilled', value: undefined })))
    }

    drive(
      () => composite.disconnect('c-remote', 'revoked'),
      (outcome) => {
        ;(Promise as unknown as Record<string, unknown>)['allSettled'] = realAllSettled
        expect(outcome.ok).toBe(false)
      },
      done,
    )
  })

  // Scenario: under 'both' the SSE side refuses and `Promise.prototype.then` is replaced by one that turns a refusal into
  // success. Expected: the call rejects with the refusal.
  it('is not reported as done by the composite when then is replaced', (done) => {
    const composite = new CompositeTransport(
      { disconnect: () => Promise.reject(BUS_REFUSED) } as never,
      { disconnect: async () => undefined } as never,
    )
    proto['then'] = function (
      this: Promise<unknown>,
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      return realThen.call(this, onFulfilled, (error: unknown) =>
        onFulfilled ? onFulfilled(undefined) : onRejected?.(error),
      )
    }

    drive(
      () => composite.disconnect('c-remote', 'revoked'),
      (outcome) => expect(outcome.ok).toBe(false),
      done,
    )
  })
})

describe('a room change or an emit that the transport refused', () => {
  const calls: Array<[string, (service: RealtimeService) => Promise<void>]> = [
    ['joinRoom', (service) => service.joinRoom('c-1', 'project:9')],
    ['leaveRoom', (service) => service.leaveRoom('c-1', 'project:9')],
    ['emitToUser', (service) => service.emitToUser('u-1', 'evt', {})],
    ['emitToTenant', (service) => service.emitToTenant('t-1', 'evt', {})],
    ['emitToRoom', (service) => service.emitToRoom('project:9', 'evt', {})],
    ['broadcast', (service) => service.broadcast('evt', {})],
  ]

  // Scenario: the transport refuses and plants a `then` that settles whatever is asked about with success. Expected: the
  // call rejects with the refusal, instead of resolving through the planted `then`.
  describe.each(calls)('%s', (name, invoke) => {
    it('rejects when the transport refused', (done) => {
      const refuse = refusalThatPlants(BUS_REFUSED)
      const transport = Object.fromEntries(
        calls.map(([method]) => [method, refuse]),
      ) as unknown as ConstructorParameters<typeof RealtimeService>[0]
      const service = new RealtimeService(transport)

      drive(
        () => invoke(service),
        (outcome) => expect({ name, ok: outcome.ok }).toEqual({ name, ok: false }),
        done,
      )
    })
  })

  // Scenario: each public method of the service is called against a transport that answers. Expected: the promise it
  // hands back carries its own `constructor`, so the caller's await reads no shared slot.
  it.each(calls)('%s hands back a promise with its own constructor', (_name, invoke) => {
    const answer = async (): Promise<void> => undefined
    const service = new RealtimeService(
      Object.fromEntries(calls.map(([method]) => [method, answer])) as never,
    )

    const promise = invoke(service)

    expect(Object.hasOwn(promise, 'constructor')).toBe(true)
  })
})

describe('what the engine says is a promise', () => {
  // Scenario: `util.types.isPromise` is replaced after the library loaded, to say that nothing is a promise. Expected:
  // `awaitable` still gives a native promise its own constructor, so the answer is the library's own.
  it('is taken once, so a replacement does not leave a promise unpinned', () => {
    const realIsPromise = types.isPromise
    const promise = Promise.resolve(1)
    ;(types as unknown as Record<string, unknown>)['isPromise'] = () => false
    let pinned: unknown
    try {
      pinned = awaitable(promise)
    } finally {
      ;(types as unknown as Record<string, unknown>)['isPromise'] = realIsPromise
    }

    expect(Object.hasOwn(pinned as object, 'constructor')).toBe(true)
  })
})
