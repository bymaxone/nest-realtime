/**
 * @fileoverview RedisRealtimePubSub does not hold the process up when it retires a subscriber,
 * against a real ioredis client.
 * @layer test
 *
 * ioredis arms a timer in `disconnect()`, 2,000 ms by default, that only the socket's `close`
 * clears. A client that has ended, or that is waiting to reconnect, has no open socket whose close
 * is still to come, so that timer runs its whole length and keeps the process alive. The cases
 * count the delays of the timers started while an operation runs, and wait for the subscriber's
 * own events, so nothing here reads the clock.
 */
import Redis from 'ioredis'
import { Logger } from '@nestjs/common'
import { disconnectWithoutTimer } from '../../../test/support/disconnect-without-timer'
import { FakeRespServer, healthyRedis, pushed } from '../../../test/fixtures/fake-resp-server'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

/** The delay ioredis gives the socket to close before it destroys it, by default. */
const IOREDIS_DEFAULT_MS = 2_000

/** The delay of every timer `operation` started. */
async function timersStartedBy(operation: () => Promise<unknown>): Promise<number[]> {
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    await operation().catch(() => undefined)
    return timer.mock.calls.map(([, delay]) => Number(delay))
  } finally {
    timer.mockRestore()
  }
}

/** Resolves once `sub` has the status named by `event`, which ioredis also emits on reaching it. */
function reached(sub: Redis, event: 'end' | 'reconnecting'): Promise<void> {
  if (sub.status === event) return Promise.resolve()
  return new Promise((resolve) => sub.once(event, () => resolve()))
}

const clients: Redis[] = []
const servers: FakeRespServer[] = []
const retire: Array<() => Promise<void>> = []

/** A client that keeps what it duplicates, so a test can read the subscriber's state. */
function client(
  port: number,
  retryStrategy: () => number | null,
  extra: Record<string, unknown> = {},
): { redis: Redis; subs: Redis[] } {
  const redis = new Redis({
    host: '127.0.0.1',
    port,
    retryStrategy,
    maxRetriesPerRequest: null,
    ...extra,
  })
  redis.on('error', () => undefined)
  const subs: Redis[] = []
  const duplicate = redis.duplicate.bind(redis)
  redis.duplicate = (override) => {
    const sub = duplicate(override)
    subs.push(sub)
    clients.push(sub)
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

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const gone = await server()
  const { port } = gone
  await gone.stop()
  return port
}

afterEach(async () => {
  for (const unsubscribe of retire.splice(0)) await unsubscribe()
  // A publisher is not given a short disconnect timeout: the subscriber duplicates its options, and
  // these cases must fail if the adapter stops setting its own. Its timer is kept off the loop.
  for (const redis of clients.splice(0)) if (redis.status !== 'end') disconnectWithoutTimer(redis)
  for (const fake of servers.splice(0)) await fake.stop()
})

describe('RedisRealtimePubSub retiring a subscriber that has no open socket', () => {
  // Scenario: the retry strategy gives up, so the subscriber ends, and the subscription is then
  // retired. Expected: no timer as long as ioredis's default is started.
  it('starts no long timer when it retires a subscriber that has ended', async () => {
    const { redis, subs } = client(await closedPort(), () => null)
    const unsubscribe = await new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn())
    await reached(subs[0] as Redis, 'end')

    const delays = await timersStartedBy(unsubscribe)

    expect(delays.filter((delay) => delay >= IOREDIS_DEFAULT_MS)).toEqual([])
  })

  // Scenario: Redis is down and the default retry strategy is waiting to try again, which is what
  // a subscriber looks like for most of an outage. Expected: the same.
  it('starts no long timer when it retires a subscriber that is waiting to reconnect', async () => {
    const { redis, subs } = client(await closedPort(), () => 60_000)
    const unsubscribe = await new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn())
    await reached(subs[0] as Redis, 'reconnecting')

    const delays = await timersStartedBy(unsubscribe)

    expect(delays.filter((delay) => delay >= IOREDIS_DEFAULT_MS)).toEqual([])
  })

  // Scenario: the server refuses the SUBSCRIBE of a subscriber that is connected. Expected: it is
  // still disconnected, which starts the timer that its socket's close then clears. Why: the
  // shorter timer must not mean a subscriber is left connected, and this shows the count sees
  // ioredis's timer at all.
  it('still disconnects a subscriber that has a connection', async () => {
    const fake = await server((command, socket) =>
      command[0] === 'SUBSCRIBE'
        ? '-NOPERM refused by the scripted server\r\n'
        : healthyRedis(command, socket),
    )
    const { redis, subs } = client(fake.port, () => 40)

    const delays = await timersStartedBy(() =>
      new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn()),
    )

    expect(delays).toEqual([2_000, 1])
    await reached(subs[0] as Redis, 'end')
  })
})

describe('RedisRealtimePubSub subscriber that ioredis disconnects on its own', () => {
  // Scenario: the connection drops, and the SUBSCRIBE the adapter sends once ioredis has reconnected
  // is refused with READONLY, which `reconnectOnError` turns into a disconnect that ioredis makes
  // itself, with the short `disconnectTimeout` the subscriber was created with. Expected: it
  // reconnects once more, subscribes again, and a message pushed afterwards reaches the handler.
  // Why: the short timeout must change how long a socket is given to close, and nothing else.
  it('reconnects and subscribes again after ioredis disconnects it itself', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const fake = await server()
    const { redis } = client(fake.port, () => 40, { reconnectOnError: () => 1 })
    let deliver: (message: unknown) => void = () => undefined
    const delivered = new Promise<unknown>((resolve) => {
      deliver = resolve
    })
    retire.push(await new RedisRealtimePubSub({ client: redis }).subscribe((m) => deliver(m)))
    // The boot is settled: script the refusal. The first SUBSCRIBE after the drop is refused, the
    // next one, made after ioredis disconnected the subscriber itself, is answered.
    let subscribes = 0
    const resubscribed = new Promise<void>((resolve) => {
      fake.respond((command, socket) => {
        if (command[0] !== 'SUBSCRIBE') return healthyRedis(command, socket)
        subscribes += 1
        if (subscribes === 1) return '-READONLY refused once by the scripted server\r\n'
        resolve()
        return healthyRedis(command, socket)
      })
    })

    fake.drop()
    await resubscribed
    fake.broadcast(
      pushed('bymax:realtime', JSON.stringify({ op: 'broadcast', args: {}, origin: 'x' })),
    )

    expect(await delivered).toMatchObject({ op: 'broadcast' })
    expect(subscribes).toBe(2)
  })
})
