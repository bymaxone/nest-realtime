/**
 * @fileoverview RedisRealtimePubSub against a server that takes the connection and does not answer:
 * boot must not wait for it, and a late answer still counts.
 * @layer test
 */
import type { Socket } from 'node:net'
import { Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis, pushed } from '../../../test/fixtures/fake-resp-server'
import { lineWithError } from '../../../test/support/log-lines'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

// Two waits of 2,000 ms each, one for the subscriber and one for the publisher.
jest.setTimeout(10_000)

const clients: Redis[] = []
const unsubscribers: Array<() => Promise<void>> = []
const servers: FakeRespServer[] = []

/** A server that holds the commands `holds` picks until `answer` replies to them. */
async function holding(holds: (command: readonly string[]) => boolean) {
  const held: Array<[readonly string[], Socket]> = []
  const fake = new FakeRespServer((command, socket) => {
    if (!holds(command)) return healthyRedis(command, socket)
    held.push([command, socket])
    return null
  })
  await fake.start()
  servers.push(fake)
  const answer = (reply = healthyRedis): void => {
    fake.respond(healthyRedis)
    for (const [command, socket] of held.splice(0)) {
      const text = reply(command, socket)
      if (text !== null) socket.write(text)
    }
  }
  return { fake, answer }
}

function bus(port: number, extra: { commandTimeout?: number } = {}): RedisRealtimePubSub {
  const redis = new Redis(port, '127.0.0.1', { retryStrategy: () => 40, ...extra })
  redis.on('error', () => undefined)
  clients.push(redis)
  return new RedisRealtimePubSub({ client: redis })
}

async function until(what: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

let warn: jest.SpyInstance
const warnings = (): string[] => warn.mock.calls.map((call) => lineWithError(call[0]))

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  for (const unsubscribe of unsubscribers.splice(0)) await unsubscribe()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  jest.restoreAllMocks()
})

describe('RedisRealtimePubSub: a server that does not answer', () => {
  // Scenario: the server accepts the connection and answers nothing, ever. Expected: subscribe
  // resolves after its bounded waits, unsubscribed, with one warning naming the wait; unsubscribing
  // does not wait for the server either.
  it('lets the boot go on, unready, and closes without an answer', async () => {
    const { fake } = await holding(() => true)
    const pubsub = bus(fake.port)
    const started = Date.now()

    const unsubscribe = await pubsub.subscribe(jest.fn())

    expect(Date.now() - started).toBeLessThan(6_000)
    expect(pubsub.isSubscribed()).toBe(false)
    expect(warnings()).toEqual([
      expect.stringMatching(/^not subscribed\. .*no answer to SUBSCRIBE within 2000 ms/),
    ])
    const closing = Date.now()
    await unsubscribe()
    expect(Date.now() - closing).toBeLessThan(1_000)
  })

  // Scenario: the server answers late, either everything or only the SUBSCRIBE it was sent after a
  // completed handshake. Expected: the instance becomes subscribed and delivers.
  it.each([
    ['nothing was answered', () => true],
    ['only SUBSCRIBE was held', (command: readonly string[]) => command[0] === 'SUBSCRIBE'],
  ])('subscribes when the answer comes late (%s)', async (_label, holds) => {
    const { fake, answer } = await holding(holds)
    const pubsub = bus(fake.port)
    const received: RealtimePubSubMessage[] = []
    unsubscribers.push(await pubsub.subscribe((message) => received.push(message)))
    expect(pubsub.isSubscribed()).toBe(false)

    answer()

    await until('the subscription', () => pubsub.isSubscribed())
    const message = { op: 'disconnect', args: { connectionId: 'c1' }, origin: 'other' } as const
    fake.broadcast(pushed('bymax:realtime', JSON.stringify(message)))
    await until('the pushed message', () => received.length === 1)
    expect(received).toEqual([message])
  })

  // Scenario: the answer is on its way when the last handler unsubscribes. Expected: the bus does
  // not report itself subscribed afterwards.
  it('stays unsubscribed when the answer crosses the unsubscribe', async () => {
    const { fake, answer } = await holding((command) => command[0] === 'SUBSCRIBE')
    const pubsub = bus(fake.port)
    const unsubscribe = await pubsub.subscribe(jest.fn())

    answer()
    await unsubscribe()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(pubsub.isSubscribed()).toBe(false)
  })

  // Scenario: the server refuses the SUBSCRIBE slowly, but within the wait. Expected: subscribe
  // rejects, which fails the boot, as an immediate refusal does.
  it('still fails the boot on a refusal that arrives within the wait', async () => {
    const { fake, answer } = await holding((command) => command[0] === 'SUBSCRIBE')
    const pubsub = bus(fake.port)
    const outcome = pubsub.subscribe(jest.fn())
    const rejected = expect(outcome).rejects.toThrow(
      'REALTIME_PUBSUB_UNAVAILABLE: could not subscribe to "bymax:realtime"',
    )
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    answer(() => '-NOPERM refused in time\r\n')

    await rejected
    expect(pubsub.isSubscribed()).toBe(false)
  })

  // Scenario: a subscribed connection stops answering and stays open. Expected, and a known limit:
  // nothing notices, so the instance still reports itself subscribed.
  it('does not notice a subscribed connection that falls silent', async () => {
    const { fake } = await holding(() => false)
    const pubsub = bus(fake.port)
    unsubscribers.push(await pubsub.subscribe(jest.fn()))

    fake.respond(() => null)
    await new Promise((resolve) => setTimeout(resolve, 2_500))

    expect(pubsub.isSubscribed()).toBe(true)
    fake.respond(healthyRedis)
  })

  // Scenario: the client's commandTimeout rejects the unanswered SUBSCRIBE, and the server then
  // recovers. Expected, and a known limit: nothing sends it again, so the instance stays unready.
  it('does not send again a SUBSCRIBE that commandTimeout rejected', async () => {
    const { fake, answer } = await holding((command) => command[0] === 'SUBSCRIBE')
    const pubsub = bus(fake.port, { commandTimeout: 300 })
    unsubscribers.push(await pubsub.subscribe(jest.fn()))

    answer()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(pubsub.isSubscribed()).toBe(false)
    expect(fake.seen.filter((command) => command[0] === 'SUBSCRIBE')).toHaveLength(1)
  })

  // Scenario: the late answer to SUBSCRIBE is a refusal. Expected: it is logged, and the instance
  // stays unsubscribed.
  it('reports a refusal that comes late', async () => {
    const { fake, answer } = await holding((command) => command[0] === 'SUBSCRIBE')
    const pubsub = bus(fake.port)
    unsubscribers.push(await pubsub.subscribe(jest.fn()))

    answer(() => '-NOPERM refused late\r\n')

    await until('the refusal line', () =>
      warnings().some((line) => line.startsWith('the server refused the subscription')),
    )
    expect(pubsub.isSubscribed()).toBe(false)
  })
})
