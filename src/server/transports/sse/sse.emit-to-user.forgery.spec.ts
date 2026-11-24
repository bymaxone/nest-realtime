/**
 * @fileoverview The SSE `emitToUser` decides between rejecting to the emitter and logging from two failures it collects;
 * a replaced Promise static or `then` must not turn them into success.
 * @layer test
 */
import { AuthenticationGate } from '../../services/authentication-gate.service'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import type { IRealtimePubSub } from '../../interfaces/realtime-pubsub.interface'
import { HeartbeatService } from './heartbeat.service'
import { EventReplayBuffer } from './event-replay-buffer'
import { SseTransport } from './sse.transport'

const realThen = Promise.prototype.then
const realAll = Promise.all
const realResolve = Promise.resolve
const realCtor = Object.getOwnPropertyDescriptor(
  Promise.prototype,
  'constructor',
) as PropertyDescriptor
const proto = Promise.prototype as unknown as Record<string, unknown>
const statics = Promise as unknown as Record<string, unknown>

function restoreAll(): void {
  proto['then'] = realThen
  statics['all'] = realAll
  statics['resolve'] = realResolve
  Object.defineProperty(Promise.prototype, 'constructor', realCtor)
}

/** An offline user whose queue and bus both refuse: the call has no delivery path and must reject. */
function offlineWithNoPath(
  onAppend: () => void = () => undefined,
  onPublish: () => void = () => undefined,
): SseTransport {
  const options = { transport: 'sse' as const, authenticator: { authenticate: async () => null } }
  const pubsub = {
    publish: () => {
      const refused = Promise.reject(new Error('bus down'))
      realThen.call(refused, undefined, () => undefined)
      onPublish()
      return refused
    },
    subscribe: async () => async () => undefined,
  } as unknown as IRealtimePubSub
  return new SseTransport(
    new ConnectionRegistry(),
    new RoomRegistry(),
    new EventReplayBuffer(options),
    new EventIdGenerator(),
    new HeartbeatService(),
    new AuthenticationGate(options, { authenticate: jest.fn() }),
    pubsub,
    {},
    options,
    'inst-1',
    {
      append: () => {
        const refused = Promise.reject(new Error('queue down'))
        realThen.call(refused, undefined, () => undefined)
        onAppend()
        return refused
      },
    } as never,
  )
}

/** Waits with the intrinsic `then`, puts the slots back, and reports whether the call rejected. */
function drive(
  transport: SseTransport,
  check: (rejected: boolean) => void,
  done: jest.DoneCallback,
) {
  const finish = (rejected: boolean): void => {
    restoreAll()
    try {
      check(rejected)
      done()
    } catch (error) {
      done(error as Error)
    }
  }
  realThen.call(
    transport.emitToUser('u1', 'evt', {}),
    () => finish(false),
    () => finish(true),
  )
}

afterEach(restoreAll)

describe('SseTransport.emitToUser decides on its own failures', () => {
  // Scenario: queue and bus both refuse and `Promise.all` is replaced by a one-shot that reports no failure for either.
  // Expected: the call rejects, because its own awaits read the two outcomes.
  it('rejects when Promise.all is replaced to report success', (done) => {
    statics['all'] = (tasks: Promise<unknown>[]) => {
      statics['all'] = realAll
      return Promise.resolve(tasks.map(() => undefined))
    }

    drive(offlineWithNoPath(), (rejected) => expect(rejected).toBe(true), done)
  })

  // Scenario: queue and bus both refuse and `Promise.prototype.then` is replaced by one that answers success to whoever
  // asks. Expected: the call rejects; no outcome is read through `then`.
  it('rejects when then is replaced to report success', (done) => {
    proto['then'] = function (this: Promise<unknown>, onFulfilled?: (v: unknown) => unknown) {
      return realThen.call(this, () => onFulfilled?.(undefined))
    }

    drive(offlineWithNoPath(), (rejected) => expect(rejected).toBe(true), done)
  })

  // Scenario: queue and bus both refuse, and the queue's own call plants a constructor that restores itself when read, and
  // a one-shot `then` that answers success. Expected: the call rejects.
  it('rejects when the queue call plants a constructor and a then', (done) => {
    const plant = (): void => {
      Object.defineProperty(Promise.prototype, 'constructor', {
        configurable: true,
        get() {
          Object.defineProperty(Promise.prototype, 'constructor', realCtor)
          return function Fake() {}
        },
      })
      proto['then'] = function (this: Promise<unknown>, onFulfilled?: (v: unknown) => unknown) {
        proto['then'] = realThen
        realThen.call(this, undefined, () => undefined)
        onFulfilled?.(undefined)
      }
    }

    drive(offlineWithNoPath(plant), (rejected) => expect(rejected).toBe(true), done)
  })

  // Scenario: the bus call replaces `Promise.resolve` with a one-shot. Expected: the call rejects.
  it('rejects when the bus call replaces Promise.resolve', (done) => {
    const plant = (): void => {
      statics['resolve'] = function () {
        statics['resolve'] = realResolve
        return realResolve.call(Promise, undefined)
      }
    }

    drive(offlineWithNoPath(undefined, plant), (rejected) => expect(rejected).toBe(true), done)
  })

  // Scenario: the bus call plants a one-shot `then` that answers success. Expected: the call rejects.
  it('rejects when the bus call plants a one-shot then', (done) => {
    const plant = (): void => {
      proto['then'] = function (this: Promise<unknown>, onFulfilled?: (v: unknown) => unknown) {
        proto['then'] = realThen
        realThen.call(this, undefined, () => undefined)
        onFulfilled?.(undefined)
      }
    }

    drive(offlineWithNoPath(undefined, plant), (rejected) => expect(rejected).toBe(true), done)
  })
})
