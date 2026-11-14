/**
 * @fileoverview RedisRealtimePubSub disconnects a subscriber only while there is a connection to
 * take down, against a real ioredis client.
 * @layer test
 *
 * ioredis arms a 2,000 ms timer when `disconnect()` is called and clears it only when the socket
 * emits `close`. A client already in the `end` state has no socket left to close, so a second
 * `disconnect()` on it leaves that timer running and keeps the process alive for about two seconds.
 * The cases count the 2,000 ms timers started while an operation runs, which holds under load
 * where a wait for a timer to expire would not.
 */
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

/** The delay ioredis gives the socket to close before it destroys it. */
const TEARDOWN_MS = 2_000

/** How many teardown timers `operation` started. */
async function teardownTimersStartedBy(operation: () => Promise<unknown>): Promise<number> {
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    await operation().catch(() => undefined)
    return timer.mock.calls.filter(([, delay]) => delay === TEARDOWN_MS).length
  } finally {
    timer.mockRestore()
  }
}

/** Waits for `condition`; a condition that never holds is a failure, not a hang. */
async function until(what: string, condition: () => boolean, ms = 1_500): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const clients: Redis[] = []
const servers: FakeRespServer[] = []

/** A client that keeps what it duplicates, so a test can read the subscriber's state. */
function client(port: number, retryStrategy: () => number | null): { redis: Redis; subs: Redis[] } {
  const redis = new Redis({ host: '127.0.0.1', port, retryStrategy, maxRetriesPerRequest: null })
  redis.on('error', () => undefined)
  const subs: Redis[] = []
  const duplicate = redis.duplicate.bind(redis)
  redis.duplicate = (override) => {
    const sub = duplicate(override)
    subs.push(sub)
    return sub
  }
  clients.push(redis)
  return { redis, subs }
}

async function server(handler = healthyRedis): Promise<FakeRespServer> {
  const fake = new FakeRespServer(handler)
  await fake.start()
  servers.push(fake)
  return fake
}

afterEach(async () => {
  // Disconnecting a client that has ended would arm the very timer these cases look for.
  for (const redis of clients.splice(0)) if (redis.status !== 'end') redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
})

describe('RedisRealtimePubSub teardown of a subscriber', () => {
  // Scenario: the retry strategy gives up, so the subscriber ends, and the subscription is then
  // retired. Expected: retiring it starts no teardown timer, since there is no socket to close.
  it('starts no teardown timer when it retires a subscriber that has ended', async () => {
    const gone = await server()
    const { port } = gone
    await gone.stop()
    const { redis, subs } = client(port, () => null)
    const unsubscribe = await new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn())
    await until('the subscriber to end', () => subs[0]?.status === 'end')

    expect(await teardownTimersStartedBy(unsubscribe)).toBe(0)
  })

  // Scenario: the server refuses the SUBSCRIBE of a subscriber that is connected. Expected: it is
  // still disconnected, which starts the one timer that its socket's close then clears. Why: the
  // guard is for an ended client only, and this shows the count sees ioredis's timer at all.
  it('still disconnects a subscriber that has a connection, which starts one teardown timer', async () => {
    const fake = await server((command, socket) =>
      command[0] === 'SUBSCRIBE'
        ? '-NOPERM refused by the scripted server\r\n'
        : healthyRedis(command, socket),
    )
    const { redis, subs } = client(fake.port, () => 40)

    const started = await teardownTimersStartedBy(() =>
      new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn()),
    )

    expect(started).toBe(1)
    await until('the subscriber to end', () => subs[0]?.status === 'end')
  })
})
