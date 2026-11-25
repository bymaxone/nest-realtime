/**
 * @fileoverview The events that end a publishing client's first connection attempt: each one lets
 * the boot go on at once, and none of them is waited on after it has fired.
 * @layer test
 */
import { EventEmitter } from 'node:events'
import type Redis from 'ioredis'
import { settlesInThisTurn } from '../../../test/support/settles-in-this-turn'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

/** How long the adapter waits for the publisher before it boots without it. */
const PUBLISHER_WAIT_MS = 2_000

/** The events that end a first connection attempt, one case each. */
const OVER = ['ready', 'close', 'reconnecting', 'end'] as const

/** A publishing client that is still connecting and says nothing until the test tells it to. */
function connecting(status: string): EventEmitter & { status: string } {
  return Object.assign(new EventEmitter(), { status })
}

/** `publisherSettled` is private; the boot reaches it through `subscribe`, which needs a server. */
function settled(pubsub: RedisRealtimePubSub): Promise<void> {
  return (pubsub as unknown as { publisherSettled(): Promise<void> }).publisherSettled()
}

afterEach(() => {
  jest.useRealTimers()
})

describe('the end of a first connection attempt', () => {
  it.each(OVER)(
    'lets the boot go on when the client emits %s, well before the deadline',
    async (event) => {
      jest.useFakeTimers({
        doNotFake: ['setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
      })
      const pub = connecting('connecting')
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })

      const waiting = settlesInThisTurn(() => {
        const settling = settled(pubsub)
        pub.emit(event)
        return settling
      })

      expect(await waiting).toEqual({ status: 'fulfilled', value: undefined })
      // Nothing is left listening, and the deadline was cleared, not run.
      expect(OVER.map((name) => pub.listenerCount(name))).toEqual([0, 0, 0, 0])
      expect(jest.getTimerCount()).toBe(0)
    },
  )

  it('keeps waiting while the client is connecting and has said nothing', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
    })
    const pub = connecting('connecting')
    const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })

    const outcome = await settlesInThisTurn(() => settled(pubsub))
    expect(outcome).toEqual({ status: 'pending' })

    await jest.advanceTimersByTimeAsync(PUBLISHER_WAIT_MS)
    expect(OVER.map((name) => pub.listenerCount(name))).toEqual([0, 0, 0, 0])
  })

  it('does not wait on a client that is not connecting', async () => {
    const pub = connecting('ready')
    const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })

    expect(await settlesInThisTurn(() => settled(pubsub))).toEqual({
      status: 'fulfilled',
      value: undefined,
    })
    expect(OVER.map((name) => pub.listenerCount(name))).toEqual([0, 0, 0, 0])
  })
})
