/**
 * @fileoverview The malformed-payload report writes the end of a burst: at the end of its window,
 * and at once when the last handler unsubscribes.
 * @layer test
 */
import { Logger } from '@nestjs/common'
import type { Redis } from 'ioredis'
import IORedisMock from 'ioredis-mock'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

const report = (count: number) =>
  expect.objectContaining({ event: 'REALTIME_PUBSUB_DROPPED', count, last: 'malformed' })

/** A subscribed bus that was just pushed three payloads it cannot parse. */
async function burst(channel: string) {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  const client = new IORedisMock() as unknown as Redis
  const pubsub = new RedisRealtimePubSub({ client, channel })
  const unsubscribe = await pubsub.subscribe(jest.fn())
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  for (const payload of ['{a', '{b', '{c']) await client.publish(channel, payload)
  await new Promise((resolve) => setImmediate(resolve))
  return { warn, unsubscribe }
}

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('RedisRealtimePubSub: the tail of a burst of malformed payloads', () => {
  // Scenario: three bad payloads, then nothing. Expected: one line at once, and one with the other
  // two when the minute ends.
  it('is written when the window ends', async () => {
    const { warn, unsubscribe } = await burst('tail:window')
    expect(warn.mock.calls).toEqual([[report(1)]])
    jest.advanceTimersByTime(59_000)
    expect(warn.mock.calls).toHaveLength(1)

    jest.advanceTimersByTime(1_000)

    expect(warn.mock.calls).toEqual([[report(1)], [report(2)]])
    jest.useRealTimers()
    await unsubscribe()
  })

  // Scenario: the bus is closed inside the window. Expected: what waits is written at once, and
  // nothing more later.
  it('is written at once when the last handler unsubscribes', async () => {
    const { warn, unsubscribe } = await burst('tail:close')

    await unsubscribe()

    expect(warn.mock.calls).toEqual([[report(1)], [report(2)]])
    jest.advanceTimersByTime(60_000)
    expect(warn.mock.calls).toHaveLength(2)
  })
})
