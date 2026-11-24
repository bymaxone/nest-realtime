/**
 * @fileoverview The composite decides between resolving and rejecting from the failures its two transports gave; a host
 * call that replaces `Array.prototype.push` or the array iterator must not make a failure disappear.
 * @layer transport
 */
import { CompositeTransport } from './composite.transport'

const realThen = Promise.prototype.then
const arrayProto = Array.prototype as unknown as Record<PropertyKey, unknown>
const realPush = Array.prototype.push
const realIterator = Array.prototype[Symbol.iterator]
const REFUSED = Object.assign(new Error('bus refused'), { code: 'REALTIME_PUBSUB_UNAVAILABLE' })

function restoreAll(): void {
  arrayProto['push'] = realPush
  arrayProto[Symbol.iterator] = realIterator
}

/** Waits with the intrinsic `then`, puts the slots back first, and reports whether the call rejected. */
function drive(start: () => Promise<unknown>, rejected: boolean, done: jest.DoneCallback): void {
  const finish = (didReject: boolean): void => {
    restoreAll()
    try {
      expect(didReject).toBe(rejected)
      done()
    } catch (error) {
      done(error as Error)
    }
  }
  realThen.call(
    start(),
    () => finish(false),
    () => finish(true),
  )
}

const plants: Array<[string, () => void]> = [
  [
    'a one-shot push that does nothing',
    () => {
      arrayProto['push'] = function () {
        arrayProto['push'] = realPush
        return 0
      }
    },
  ],
  [
    'a push that always does nothing',
    () => {
      arrayProto['push'] = () => 0
    },
  ],
  [
    'an array iterator that yields nothing',
    () => {
      arrayProto[Symbol.iterator] = function* () {}
    },
  ],
]

afterEach(restoreAll)

describe.each(plants)('with %s planted by a transport call', (_name, plant) => {
  // Scenario: the SSE side refuses and the WebSocket side resolves after planting. Expected: the call rejects.
  it('disconnect still rejects when one transport refused', (done) => {
    const composite = new CompositeTransport(
      { disconnect: () => Promise.reject(REFUSED) } as never,
      { disconnect: async () => plant() } as never,
    )

    drive(() => composite.disconnect('c-remote', 'revoked'), true, done)
  })

  // Scenario: both transports refuse and one plants. Expected: an emit that no transport took still rejects.
  it('emitToRoom still rejects when both transports refused', (done) => {
    const refuse = (): Promise<void> => {
      plant()
      return Promise.reject(REFUSED)
    }
    const composite = new CompositeTransport(
      { emitToRoom: refuse } as never,
      { emitToRoom: refuse } as never,
    )

    drive(() => composite.emitToRoom('project:9', 'evt', {}), true, done)
  })
})
