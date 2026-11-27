/**
 * @fileoverview RedisRealtimePubSub behind Redis Sentinel: replacing a silent connection outlasts a
 * `sentinelRetryStrategy` that gives up, and the host's strategy decides everywhere else.
 * @layer test
 */
import { Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'
import { PROBE_DEADLINE_MS, PROBE_INTERVAL_MS } from './watch-liveness'

jest.setTimeout(15_000)

const clients: Redis[] = []
const unsubscribers: Array<() => Promise<void>> = []
const servers: FakeRespServer[] = []

beforeEach(() => {
  // The clock follows real time, for the sockets, and can be jumped over the waits.
  jest.useFakeTimers({ advanceTimers: true })
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  for (const unsubscribe of unsubscribers.splice(0)) await unsubscribe()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
  jest.useRealTimers()
  await new Promise((resolve) => setTimeout(resolve, 20))
  jest.restoreAllMocks()
})

const real = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(what: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await real(10)
  }
}

/** Jumps the clock a second at a time, leaving each retry the real time its sockets need. */
async function pass(seconds: number): Promise<void> {
  for (let second = 0; second < seconds; second++) {
    await jest.advanceTimersByTimeAsync(1_000)
    await real(10)
  }
}

async function started(fake: FakeRespServer): Promise<FakeRespServer> {
  await fake.start()
  servers.push(fake)
  return fake
}

/** A subscribed bus on a fake master that a fake Sentinel names. */
async function behindSentinel(given: {
  sentinelRetryStrategy?: unknown
  sentinelCommandTimeout?: number
}) {
  const master = await started(new FakeRespServer())
  const port = String(master.port)
  const address = `*2\r\n$9\r\n127.0.0.1\r\n$${port.length}\r\n${port}\r\n`
  const sentinel = await started(
    new FakeRespServer((command, socket) => {
      if (command[1] === 'GET-MASTER-ADDR-BY-NAME') return address
      return command[0] === 'SENTINEL' ? '*0\r\n' : healthyRedis(command, socket)
    }),
  )
  const duplicates = jest.spyOn(Redis.prototype, 'duplicate')
  const redis = new Redis({
    sentinels: [{ host: '127.0.0.1', port: sentinel.port }],
    name: 'mymaster',
    retryStrategy: () => 40,
    ...(given.sentinelCommandTimeout && {
      sentinelCommandTimeout: given.sentinelCommandTimeout,
    }),
  })
  Object.assign(redis.options, given)
  redis.on('error', () => undefined)
  clients.push(redis)
  const pubsub = new RedisRealtimePubSub({ client: redis })
  unsubscribers.push(await pubsub.subscribe(jest.fn()))
  const sub: Redis = duplicates.mock.results[0]?.value
  await until('the subscription', () => sub.status === 'ready' && pubsub.isSubscribed())
  const asked = (): number =>
    sentinel.seen.filter(([, verb]) => verb === 'GET-MASTER-ADDR-BY-NAME').length
  return { master, sentinel, pubsub, sub, asked }
}

/** The master falls silent, the Sentinel goes away, and the watch gives up on its PING. */
async function silencedWithoutSentinel(
  bus: Awaited<ReturnType<typeof behindSentinel>>,
): Promise<() => void> {
  bus.master.respond(() => null)
  await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
  await real(30)
  await bus.sentinel.stop()
  await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
  await until('the miss', () => !bus.pubsub.isSubscribed())
  return () => bus.master.respond(healthyRedis)
}

/** Client options under which ioredis stops asking; an untyped host can pass any value. */
const GIVES_UP: Array<[string, { sentinelRetryStrategy: unknown }]> = [
  ['a sentinelRetryStrategy that returns null', { sentinelRetryStrategy: () => null }],
  ['sentinelRetryStrategy: false', { sentinelRetryStrategy: false }],
]

describe('RedisRealtimePubSub behind Sentinel', () => {
  // Scenario: the master falls silent and no Sentinel answers for 25 s, then both return.
  // Expected: the subscriber has not ended, and subscribes again.
  it.each(GIVES_UP)('recovers a replacement from a Sentinel outage with %s', async (_l, given) => {
    const bus = await behindSentinel(given)
    const heal = await silencedWithoutSentinel(bus)
    await pass(25)
    expect(bus.sub.status).not.toBe('end')

    heal()
    await bus.sentinel.start()
    await pass(2)

    await until('the subscription', () => bus.pubsub.isSubscribed())
  })

  // Scenario: the master closes the connection while no Sentinel answers, with no replacement in
  // progress. Expected: the host's strategy ends the subscriber.
  it.each(GIVES_UP)('ends on a close, never replaced, with %s', async (_label, given) => {
    const { master, sentinel, sub } = await behindSentinel(given)
    await sentinel.stop()

    master.drop()

    await until('the end', () => sub.status === 'end')
  })

  // Scenario: the host's strategy returns a delay longer than the library's own, during a
  // replacement. Expected: nothing asks the Sentinel before the host's delay is over.
  it("waits the delay the host's sentinelRetryStrategy returns", async () => {
    const bus = await behindSentinel({ sentinelRetryStrategy: () => 30_000 })
    await silencedWithoutSentinel(bus)
    await pass(1)
    await bus.sentinel.start()
    const before = bus.asked()

    await pass(20)
    expect(bus.asked()).toBe(before)
    await pass(15)

    await until('the Sentinel to be asked', () => bus.asked() > before)
  })

  // Scenario: the subscriber is closed while it waits to ask the Sentinels again. Expected: it ends
  // once that wait is over, and nothing keeps asking.
  it.each(['disconnect', 'quit'] as const)('ends on %s() during the wait', async (close) => {
    const bus = await behindSentinel({ sentinelRetryStrategy: () => null })
    await silencedWithoutSentinel(bus)
    await pass(2)

    if (close === 'quit') await expect(bus.sub.quit()).resolves.toBe('OK')
    else bus.sub.disconnect()
    await bus.sentinel.start()
    const before = bus.asked()
    await pass(2)

    await until('the end', () => bus.sub.status === 'end')
    await pass(5)
    expect(bus.asked()).toBeLessThanOrEqual(before + 1)
  })

  // Scenario: a Sentinel accepts the replacement's connection and never answers, and the
  // subscriber is closed. Expected: it ends once the 5 s command timeout rejects the question.
  it.each(['disconnect', 'quit'] as const)('ends on %s() with a mute Sentinel', async (close) => {
    const bus = await behindSentinel({})
    bus.master.respond(() => null)
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    await real(30)
    bus.sentinel.respond(() => null)
    const before = bus.sentinel.seen.length
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the replacement to reach the Sentinel', () => bus.sentinel.seen.length > before)

    if (close === 'quit') void bus.sub.quit().catch(() => undefined)
    else bus.sub.disconnect()
    await pass(7)

    await until('the end', () => bus.sub.status === 'end')
  })

  // Scenario: the host sets its own command timeout, or none. Expected: the subscriber has the
  // host's number, and 5 s where there is none.
  it.each([
    [1_234, 1_234],
    [undefined, 5_000],
  ])('a host sentinelCommandTimeout of %s gives the subscriber %s', async (host, expected) => {
    const bus = await behindSentinel(host ? { sentinelCommandTimeout: host } : {})

    expect(bus.sub.options.sentinelCommandTimeout).toBe(expected)
  })
})
