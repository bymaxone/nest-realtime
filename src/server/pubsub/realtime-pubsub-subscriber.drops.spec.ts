/**
 * @fileoverview RealtimePubSubSubscriber with messages it cannot act on (no known op, no args, not
 * an object): each is dropped and reported at most once for each window, in a line that carries
 * only counts and never anything the producer wrote.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import type { SseTransport } from '../transports/sse/sse.transport'
import { RealtimePubSubSubscriber } from './realtime-pubsub-subscriber'

/** How long the report stays quiet after it was written. */
const WINDOW_MS = 10_000

type Handler = (msg: RealtimePubSubMessage) => void

async function build(sse: Partial<Record<keyof SseTransport, jest.Mock>> = {}) {
  let handler: Handler | undefined
  const pubsub = {
    subscribe: jest.fn(async (h: Handler) => {
      handler = h
      return async () => undefined
    }),
    publish: jest.fn(),
  }
  const subscriber = new RealtimePubSubSubscriber(pubsub as never, 'inst-1', sse as never)
  await subscriber.onModuleInit()
  return (message: unknown): void => handler?.(message as RealtimePubSubMessage)
}

let warn: jest.SpyInstance

beforeEach(() => {
  jest.useFakeTimers()
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.useRealTimers()
  warn.mockRestore()
})

describe('messages the subscriber cannot act on', () => {
  /*
   * Given a message with no known op, repeated inside one window
   * When the window passes and another arrives
   * Then one line was written for the first, and one more counts the rest
   */
  it('reports an unknown op once for each window, with the count', async () => {
    const deliver = await build()
    deliver({ origin: 'other' })
    deliver({ op: 'nope', origin: 'other' })
    deliver({ op: 'nope', origin: 'other' })
    expect(warn).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(WINDOW_MS)
    deliver({ op: 'nope', origin: 'other' })

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(
      'Pub/sub dropped 3 message(s) it could not act on since the last report (last: unknown op)',
    )
  })

  /*
   * Given a message whose op is known and whose args are missing
   * When many arrive inside one window
   * Then one line is written, counted as failed handling
   */
  it('reports a message whose handling throws once for each window', async () => {
    const deliver = await build()
    for (let i = 0; i < 5; i++) deliver({ op: 'emitToUser', origin: 'other' })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Pub/sub dropped 1 message(s) it could not act on since the last report (last: TypeError)',
    )
  })

  /*
   * Given a message that is not an object
   * When it reaches the subscriber
   * Then it throws nothing and is counted, not dropped without a trace
   */
  it('counts a null message instead of dropping it silently', async () => {
    const deliver = await build()

    expect(() => deliver(null)).not.toThrow()

    expect(warn).toHaveBeenCalledWith(
      'Pub/sub dropped 1 message(s) it could not act on since the last report (last: TypeError)',
    )
  })

  /*
   * Given a message from this instance
   * When it reaches the subscriber
   * Then it is ignored without a line
   */
  it('ignores a message this instance published', async () => {
    const deliver = await build()

    deliver({ op: 'nope', origin: 'inst-1' })

    expect(warn).not.toHaveBeenCalled()
  })

  /*
   * Given an op that carries a CR/LF and is 100,000 characters long
   * When it reaches the subscriber
   * Then one short line is written and nothing of the op is in it
   */
  it('never writes what the producer put in the op', async () => {
    const deliver = await build()

    deliver({ op: `x\r\nFORGED line ${'a'.repeat(100_000)}`, origin: 'other' })

    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).not.toMatch(/[\r\n]/)
    expect(line).not.toContain('FORGED')
    expect(line.length).toBeLessThan(200)
  })

  /*
   * Given a local emit that throws an error whose message carries CR/LF
   * When the message reaches the subscriber
   * Then the line does not contain the error's message
   */
  it('never writes the message of the error that handling threw', async () => {
    const deliver = await build({
      emitToUserLocal: jest.fn(() => {
        throw new Error('secret\r\nFORGED line')
      }),
    })

    deliver({
      op: 'emitToUser',
      origin: 'other',
      args: { userId: 'u', event: 'e', data: 1, id: '1' },
    })

    const line = String(warn.mock.calls[0]?.[0])
    expect(line).not.toContain('secret')
    expect(line).not.toMatch(/[\r\n]/)
  })

  /*
   * Given handling that throws an object with no constructor
   * When the message reaches the subscriber
   * Then the failure is still counted, under the generic class
   */
  it('counts a failure whose thrown value has no constructor', async () => {
    const deliver = await build({
      emitToUserLocal: jest.fn(() => {
        throw Object.create(null)
      }),
    })

    deliver({
      op: 'emitToUser',
      origin: 'other',
      args: { userId: 'u', event: 'e', data: 1, id: '1' },
    })

    expect(warn).toHaveBeenCalledWith(
      'Pub/sub dropped 1 message(s) it could not act on since the last report (last: Error)',
    )
  })
})
