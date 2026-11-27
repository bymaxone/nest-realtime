/**
 * @fileoverview RedisRealtimePubSub's PING watch of its subscriber connection: a connection that is
 * open and silent is replaced, and one that answers is left alone.
 * @layer test
 */
import type { Socket } from 'node:net'
import { Logger } from '@nestjs/common'
import Redis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import type { RespHandler } from '../../../test/fixtures/fake-resp-server'
import { lineWithError } from '../../../test/support/log-lines'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'
import { PROBE_DEADLINE_MS, PROBE_INTERVAL_MS } from './watch-liveness'

jest.setTimeout(10_000)

const clients: Redis[] = []
const unsubscribers: Array<() => Promise<void>> = []
const servers: FakeRespServer[] = []

let warn: jest.SpyInstance
const warnings = (): string[] => warn.mock.calls.map((call) => lineWithError(call[0]))

beforeEach(() => {
  // The clock follows real time, for the sockets, and can be jumped over the probe's waits.
  jest.useFakeTimers({ advanceTimers: true })
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
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

async function until(what: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A subscribed bus on a fake server, and what the server has seen. */
async function subscribedBus(options: Partial<RedisOptions> = {}) {
  const fake = new FakeRespServer()
  await fake.start()
  servers.push(fake)
  const redis = new Redis(fake.port, '127.0.0.1', { retryStrategy: () => 40 })
  Object.assign(redis.options, options)
  redis.on('error', () => undefined)
  clients.push(redis)
  const pubsub = new RedisRealtimePubSub({ client: redis })
  const unsubscribe = await pubsub.subscribe(jest.fn())
  unsubscribers.push(unsubscribe)
  const count = (name: string): number => fake.seen.filter(([word]) => word === name).length
  // The fake clock holds back nextTick, so `ready` arrives after the first confirmation and sends another.
  await until('the subscription', () => count('SUBSCRIBE') === 2 && pubsub.isSubscribed())
  return { fake, pubsub, unsubscribe, count }
}

/** Answers nothing until `thaw`, which replies to everything held, as a frozen process does. */
function freeze(fake: FakeRespServer): () => void {
  const held: Array<[readonly string[], Socket]> = []
  fake.respond((command, socket) => {
    held.push([command, socket])
    return null
  })
  return () => {
    fake.respond(healthyRedis)
    for (const [command, socket] of held.splice(0)) {
      const reply = healthyRedis(command, socket)
      if (reply !== null && !socket.destroyed) socket.write(reply)
    }
  }
}

/** One interval, so a PING is sent, and the real time its reply needs. */
async function probeOnce(): Promise<void> {
  await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
  await new Promise((resolve) => setTimeout(resolve, 30))
}

const refuses =
  (error: string): RespHandler =>
  (command, socket) =>
    command[0] === 'PING' ? `-${error}\r\n` : healthyRedis(command, socket)

describe('RedisRealtimePubSub: the PING watch of the subscriber', () => {
  // Scenario: the server answers each PING, with a reply or an error reply. Expected: the same
  // connection, still subscribed, nothing logged.
  it.each([
    ['a reply', healthyRedis],
    ['NOPERM', refuses('NOPERM no permission to run PING')],
    ['BUSY', refuses('BUSY Redis is busy running a script')],
    ['LOADING', refuses('LOADING Redis is loading the dataset')],
  ])('leaves alone a connection that answers with %s', async (_label, handler) => {
    const { fake, pubsub, count } = await subscribedBus()
    fake.respond(handler)

    for (let round = 0; round < 3; round++) await probeOnce()

    expect(count('PING')).toBe(3)
    expect(count('SUBSCRIBE')).toBe(2)
    expect(pubsub.isSubscribed()).toBe(true)
    expect(warnings()).toEqual([])
  })

  // Scenario: the host's client has a commandTimeout shorter than the probe's deadline, and a PING
  // is answered later than that. Expected: the subscriber takes the whole deadline, same connection.
  it("gives a PING the whole deadline whatever the host's commandTimeout", async () => {
    const { fake, pubsub, count } = await subscribedBus({ commandTimeout: 300 })
    const handshakes = count('HELLO')
    const thaw = freeze(fake)

    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS - 1_000)
    thaw()
    await probeOnce()

    expect(count('HELLO')).toBe(handshakes)
    expect(pubsub.isSubscribed()).toBe(true)
    expect(warnings()).toEqual([])
  })

  // Scenario: the host auto-pipelines and does not resend, and a connection closes with a PING in
  // flight. Expected: the next connection's PING is written, so that connection is kept.
  it('keeps the next connection after one closed with a PING in flight, under auto-pipelining', async () => {
    const { fake, pubsub, count } = await subscribedBus({
      enableAutoPipelining: true,
      autoResendUnfulfilledCommands: false,
    })
    const thaw = freeze(fake)
    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS + 100)
    thaw()
    await until('the new subscription', () => pubsub.isSubscribed())
    const handshakes = count('HELLO')
    const pings = count('PING')

    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS + 100)

    expect(count('PING')).toBeGreaterThan(pings)
    expect(count('HELLO')).toBe(handshakes)
    expect(pubsub.isSubscribed()).toBe(true)
  })

  // Scenario: the server freezes for far longer than the interval and the deadline, then answers
  // again. Expected: unsubscribed at the first miss, one new connection however long the freeze,
  // subscribed again on its confirmation, with one SUBSCRIBE for it.
  it.each([
    ['autoResubscribe on', true],
    ['autoResubscribe off', false],
  ])('replaces a silent connection once and recovers (%s)', async (_label, autoResubscribe) => {
    const { fake, pubsub, count } = await subscribedBus({ autoResubscribe })
    const before = new Set(fake.sockets)
    const handshakes = count('HELLO')
    const thaw = freeze(fake)

    await probeOnce()
    expect(pubsub.isSubscribed()).toBe(true)
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the miss', () => !pubsub.isSubscribed())
    await until('the new connection', () => count('HELLO') === handshakes + 1)
    for (let round = 0; round < 6; round++) await probeOnce()

    expect(count('HELLO')).toBe(handshakes + 1)
    expect([...fake.sockets].filter((socket) => !before.has(socket))).toHaveLength(1)
    expect(warnings()).toEqual([
      expect.stringMatching(/^not subscribed: no answer to PING within 5000 ms\./),
    ])

    thaw()

    await until('the subscription', () => pubsub.isSubscribed())
    // The new connection is subscribed by the bus, whatever the host chose for ioredis's replay:
    // its `ready` sends one SUBSCRIBE.
    expect(count('SUBSCRIBE')).toBe(3)
  })

  // Scenario: the host's retryStrategy gives up, and the server freezes. Without the watch the
  // connection would stay open and heal, so replacing it must not end the subscriber. Expected: one
  // new connection, after the probe's interval, and subscribed again once the server answers.
  it('replaces a silent connection although retryStrategy has given up', async () => {
    const { fake, pubsub, count } = await subscribedBus({ retryStrategy: () => null })
    const handshakes = count('HELLO')
    const thaw = freeze(fake)

    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the miss', () => !pubsub.isSubscribed())
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    await until('the new connection', () => count('HELLO') === handshakes + 1)
    thaw()

    await until('the subscription', () => pubsub.isSubscribed())
  })

  // Scenario: the same host, and the server closes the connection that replaced the silent one,
  // after it was ready. Expected: that close is not the probe's, so the host's strategy decides.
  it('lets retryStrategy end the subscriber on a close that follows a recovery', async () => {
    const { fake, pubsub, count } = await subscribedBus({ retryStrategy: () => null })
    const thaw = freeze(fake)
    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the miss', () => !pubsub.isSubscribed())
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    thaw()
    await until('the subscription', () => pubsub.isSubscribed())
    const handshakes = count('HELLO')

    for (const socket of fake.sockets) socket.destroy()
    await until('the close', () => !pubsub.isSubscribed())
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(count('HELLO')).toBe(handshakes)
  })

  // Scenario: the same host, and the server closes the first connection, which the probe never
  // replaced. Expected: the host's strategy ends the subscriber, with no connection afterwards.
  it('lets retryStrategy end the first connection, which the probe never replaced', async () => {
    const duplicates = jest.spyOn(Redis.prototype, 'duplicate')
    const { fake, count } = await subscribedBus({ retryStrategy: () => null })
    const sub = duplicates.mock.results[0]?.value as Redis
    const handshakes = count('HELLO')

    for (const socket of fake.sockets) socket.destroy()
    await until('the end', () => sub.status === 'end')
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(count('HELLO')).toBe(handshakes)
  })

  // Scenario: the same host, and the subscriber is closed during a replacement, while the 10 s
  // retry is waiting or while the new connection is not ready. Expected: nothing connects again.
  it.each([
    ['disconnect', 'waiting'],
    ['quit', 'waiting'],
    ['disconnect', 'connecting'],
    ['quit', 'connecting'],
  ] as const)('stops on %s() during a replacement (%s)', async (close, phase) => {
    const duplicates = jest.spyOn(Redis.prototype, 'duplicate')
    const { fake, count } = await subscribedBus({ retryStrategy: () => null })
    const sub = duplicates.mock.results[0]?.value as Redis
    const before = count('HELLO')
    freeze(fake)
    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the miss', () => sub.status === 'reconnecting')
    if (phase === 'connecting') {
      await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
      await until('the new connection', () => count('HELLO') === before + 1)
    }
    const handshakes = count('HELLO')

    if (close === 'quit') await expect(sub.quit()).resolves.toBe('OK')
    else sub.disconnect()
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 3)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(count('HELLO')).toBe(handshakes)
    if (phase === 'connecting') expect(sub.status).toBe('end')
  })

  // Scenario: the last handler unsubscribes while that reconnect is waiting. Expected: it is
  // dropped, so nothing connects afterwards and no timer is left behind.
  it('drops the pending reconnect on unsubscribe', async () => {
    const { fake, pubsub, unsubscribe, count } = await subscribedBus({ retryStrategy: () => null })
    const handshakes = count('HELLO')
    freeze(fake)
    await probeOnce()
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS)
    await until('the miss', () => !pubsub.isSubscribed())

    await unsubscribe()
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(count('HELLO')).toBe(handshakes)
  })

  // Scenario: the last handler unsubscribes with a PING unanswered. Expected: the interval is
  // cleared and no silence is reported afterwards.
  it('stops watching on unsubscribe', async () => {
    const intervals = jest.spyOn(global, 'setInterval')
    const cleared = jest.spyOn(global, 'clearInterval')
    const { fake, unsubscribe } = await subscribedBus()
    freeze(fake)
    await probeOnce()

    const closing = unsubscribe()
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    await closing

    const probe = intervals.mock.calls.findIndex(([, ms]) => ms === PROBE_INTERVAL_MS)
    expect(cleared).toHaveBeenCalledWith(intervals.mock.results[probe]?.value)
    expect(warnings()).toEqual([])
  })

  // Scenario: the boot is refused. Expected: the retired connection is not watched.
  it('stops watching a subscriber whose first SUBSCRIBE is refused', async () => {
    const intervals = jest.spyOn(global, 'setInterval')
    const cleared = jest.spyOn(global, 'clearInterval')
    const fake = new FakeRespServer((command, socket) =>
      command[0] === 'SUBSCRIBE' ? '-NOPERM no channel\r\n' : healthyRedis(command, socket),
    )
    await fake.start()
    servers.push(fake)
    const redis = new Redis(fake.port, '127.0.0.1')
    clients.push(redis)

    await expect(new RedisRealtimePubSub({ client: redis }).subscribe(jest.fn())).rejects.toThrow(
      'could not subscribe',
    )

    const probe = intervals.mock.calls.findIndex(([, ms]) => ms === PROBE_INTERVAL_MS)
    expect(cleared).toHaveBeenCalledWith(intervals.mock.results[probe]?.value)
  })
})
