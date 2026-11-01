/**
 * @fileoverview RedisRealtimePubSub's subscriber lifecycle against a real ioredis client and a
 * scripted in-process server: what boot does for each kind of failure, and whether the instance
 * reports itself subscribed through connection drops and recoveries.
 * @layer test
 */
import { Logger } from '@nestjs/common'
import Redis from 'ioredis'
import {
  FakeRespServer,
  healthyRedis,
  pushed,
  subscribed,
} from '../../../test/fixtures/fake-resp-server'
import type { RespHandler } from '../../../test/fixtures/fake-resp-server'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

// A mutant that leaves the instance stuck must fail here, well inside the mutation runner's own
// timeout, and not be counted as a timeout after the default five seconds per test.
jest.setTimeout(3_000)

const CHANNEL = 'bymax:realtime'
const DOWN_PREFIX = `REALTIME_PUBSUB_UNAVAILABLE: not subscribed to "${CHANNEL}": `
const UP = `Subscribed to "${CHANNEL}"; events and revocations from other instances reach this instance`

// What happened, in order, with the time since the test began. A failure carries it in its
// message, because the order of a close, a ready and a reply is what these cases are about and
// the assertion alone does not show it.
const trace: string[] = []
let began = Date.now()
function mark(what: string): void {
  trace.push(`${String(Date.now() - began).padStart(5)} ms  ${what}`)
}

/** Wraps a test body so that a failure also prints the trace. */
function traced<A extends unknown[]>(body: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await body(...args)
    } catch (error) {
      if (error instanceof Error) {
        error.message += `\n\nevents (time since the test began):\n${trace.join('\n')}`
      }
      throw error
    }
  }
}

/** The line the adapter logs for a refusal whose server message is `message`. */
const refusalLine = (message: string): string =>
  `REALTIME_PUBSUB_UNAVAILABLE: the server refused the subscription to "${CHANNEL}": ${message}`

/** The warnings mentioning `token`. Waits and assertions name their own server message, because
 * the logger spy is shared and another test's line must not satisfy them. */
const linesAbout = (warn: jest.SpyInstance, token: string): string[] =>
  warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(token))

const clients: Redis[] = []
const unsubscribers: Array<() => Promise<void>> = []
const servers: FakeRespServer[] = []

function client(port: number, extra: Record<string, unknown> = {}): Redis {
  const redis = new Redis({
    host: '127.0.0.1',
    port,
    retryStrategy: () => 40,
    maxRetriesPerRequest: null,
    ...extra,
  })
  redis.on('error', () => undefined)
  // The subscriber is a duplicate of this client; its connection events go in the trace.
  const duplicate = redis.duplicate.bind(redis)
  redis.duplicate = (override) => {
    const sub = duplicate(override)
    for (const event of ['connect', 'ready', 'close', 'end', 'reconnecting']) {
      sub.on(event, () => mark(`subscriber ${event}`))
    }
    sub.on('error', (error: Error) => mark(`subscriber error ${error.name}: ${error.message}`))
    return sub
  }
  clients.push(redis)
  return redis
}

/** The scripted behaviour, with each command and the reply it got put in the trace. */
function recorded(handler: RespHandler): RespHandler {
  return (command, socket) => {
    const reply = handler(command, socket)
    mark(
      `server got ${command.slice(0, 2).join(' ')} and ${reply === null ? 'said nothing' : `sent ${reply.split('\r\n')[0]}`}`,
    )
    return reply
  }
}

async function server(handler = healthyRedis): Promise<FakeRespServer> {
  const fake = new FakeRespServer(recorded(handler))
  await fake.start()
  servers.push(fake)
  return fake
}

/** Replaces the server's behaviour, keeping the trace. */
function behave(fake: FakeRespServer, handler: RespHandler): void {
  fake.respond(recorded(handler))
}

/** A port nothing listens on: bind a server, note its port, close it. */
async function closedPort(): Promise<FakeRespServer> {
  const fake = await server()
  await fake.stop()
  return fake
}

async function until(what: string, condition: () => boolean, ms = 1500): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function spies() {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation((message) => {
    mark(`warn  ${String(message)}`)
  })
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
    mark(`log   ${String(message)}`)
  })
  return { warn, log }
}

/** Subscribe and remember how to unsubscribe, so no subscriber outlives its test. */
async function subscribe(
  pubsub: RedisRealtimePubSub,
  handler: (message: RealtimePubSubMessage) => void = () => undefined,
): Promise<() => Promise<void>> {
  const unsubscribe = await pubsub.subscribe(handler)
  unsubscribers.push(unsubscribe)
  return unsubscribe
}

beforeEach(() => {
  trace.length = 0
  began = Date.now()
})

afterEach(async () => {
  for (const unsubscribe of unsubscribers.splice(0)) await unsubscribe()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
  // A reply already read from a socket still reaches its handler after the teardown, and on a
  // loaded runner that can be a poll later; let it land in this test's spies and not in the next
  // test's.
  await new Promise((resolve) => setTimeout(resolve, 20))
  jest.restoreAllMocks()
})

describe('RedisRealtimePubSub subscriber lifecycle', () => {
  // An error REPLY means the server was reached and refused: retrying cannot help, so the boot
  // fails instead of starting an instance that never hears a revocation.
  it.each([
    ['WRONGPASS on the handshake', (c: readonly string[]) => c[0] === 'HELLO', 'WRONGPASS'],
    [
      'NOPERM on SUBSCRIBE after a successful connect',
      (c: readonly string[]) => c[0] === 'SUBSCRIBE',
      'NOPERM',
    ],
  ])(
    'rejects the subscribe on %s',
    traced(async (_label, refuses, code) => {
      spies()
      const fake = await server((command, socket) => {
        if (refuses(command)) return `-${code} refused by the scripted server\r\n`
        return healthyRedis(command, socket)
      })
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      const failure = await pubsub.subscribe(jest.fn()).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe(
        `[RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: could not subscribe to "${CHANNEL}" (${code} refused by the scripted server)`,
      )
      expect(pubsub.isSubscribed()).toBe(false)
    }),
  )

  // A rejected subscribe must not leave a subscriber connection retrying in the background.
  it(
    'closes the subscriber connection after a rejected subscribe',
    traced(async () => {
      const { warn } = spies()
      const fake = await server((command) =>
        command[0] === 'SUBSCRIBE' ? '-NOPERM refused\r\n' : healthyRedis(command, null as never),
      )
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await pubsub.subscribe(jest.fn()).catch(() => undefined)
      // A subscriber left retrying would send SUBSCRIBE again after every reconnect.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(fake.seen.filter((c) => c[0] === 'SUBSCRIBE')).toHaveLength(1)
      // Closing it on purpose is not an outage, so nothing is logged for the closed connection.
      expect(warn).not.toHaveBeenCalled()
    }),
  )

  // An unreachable Redis does not answer at all; the boot must not wait for it.
  it(
    'resolves at once, not subscribed, when Redis is unreachable',
    traced(async () => {
      const { warn } = spies()
      const fake = await closedPort()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      const started = Date.now()
      const unsubscribe = await subscribe(pubsub)
      expect(Date.now() - started).toBeLessThan(1500)
      expect(typeof unsubscribe).toBe('function')
      expect(pubsub.isSubscribed()).toBe(false)
      // Several retries pass; the log carries one line, not one per retry.
      await new Promise((resolve) => setTimeout(resolve, 400))
      const lines = warn.mock.calls.map((call) => String(call[0]))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(
        new RegExp(
          `^${DOWN_PREFIX}.*ECONNREFUSED.*\\. Events and revocations from other instances will not reach this instance until it is subscribed again$`,
        ),
      )
    }),
  )

  // Shutdown awaits the unsubscribe; QUIT to a Redis that never answered would block it forever.
  it(
    'unsubscribes at once when Redis was never reachable',
    traced(async () => {
      const { warn } = spies()
      const fake = await closedPort()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      const unsubscribe = await subscribe(pubsub)
      await expect(unsubscribe()).resolves.toBeUndefined()
      // The queued SUBSCRIBE is rejected because the connection closed, which is not a refusal.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(warn.mock.calls.map((call) => String(call[0]))).toHaveLength(1)
    }),
  )

  // Redis arriving later must make the instance subscribed, with one line saying so, and the
  // messages it pushes must reach the handler.
  it(
    'becomes subscribed when Redis comes up, and delivers what it pushes',
    traced(async () => {
      const { warn, log } = spies()
      const fake = await closedPort()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      const received: RealtimePubSubMessage[] = []
      await subscribe(pubsub, (message) => received.push(message))
      expect(pubsub.isSubscribed()).toBe(false)
      behave(fake, healthyRedis)
      await fake.start()
      servers.push(fake)
      await until('the instance to report subscribed', () => pubsub.isSubscribed())
      const message: RealtimePubSubMessage = {
        op: 'disconnect',
        args: { connectionId: 'c1' },
        origin: 'other',
      }
      fake.broadcast(pushed(CHANNEL, JSON.stringify(message)))
      await until('the pushed message', () => received.length === 1)
      expect(received[0]).toEqual(message)
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([UP])
      expect(warn).toHaveBeenCalledTimes(1)
    }),
  )

  // A connection that becomes ready and then fails before SUBSCRIBE is confirmed is the same
  // as an unreachable Redis, not a refusal.
  it(
    'treats a connection that dies before SUBSCRIBE is confirmed as unreachable',
    traced(async () => {
      spies()
      let attempts = 0
      const fake = await server((command, socket) => {
        if (command[0] === 'SUBSCRIBE' && attempts++ < 2) {
          socket.destroy()
          return null
        }
        return healthyRedis(command, socket)
      })
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await expect(subscribe(pubsub)).resolves.toEqual(expect.any(Function))
      await until('the instance to report subscribed', () => pubsub.isSubscribed())
    }),
  )

  // Deaf at 3 a.m. is reported the same way as deaf at start: the state follows the connection.
  it(
    'reports unsubscribed while the connection is down and subscribed again after it',
    traced(async () => {
      const { warn, log } = spies()
      const fake = await server()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await subscribe(pubsub)
      expect(pubsub.isSubscribed()).toBe(true)
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([UP])
      behave(fake, (command, socket) =>
        command[0] === 'SUBSCRIBE' ? null : healthyRedis(command, socket),
      )
      fake.drop()
      await until('the instance to report unsubscribed', () => !pubsub.isSubscribed())
      // Reconnected but the replayed SUBSCRIBE is unconfirmed: still not subscribed.
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(pubsub.isSubscribed()).toBe(false)
      behave(fake, (command) =>
        command[0] === 'SUBSCRIBE'
          ? subscribed(command[1] ?? '')
          : healthyRedis(command, null as never),
      )
      fake.drop()
      await until('the instance to report subscribed again', () => pubsub.isSubscribed())
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        `${DOWN_PREFIX}connection closed. Events and revocations from other instances will not reach this instance until it is subscribed again`,
      ])
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([UP, UP])
    }),
  )

  // One outage is one down line and one recovered line, however many reconnects fail in between.
  it(
    'logs one down line and one recovered line for an outage with failed reconnects',
    traced(async () => {
      const { warn, log } = spies()
      const fake = await server()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await subscribe(pubsub)
      await fake.stop()
      await until('the instance to report unsubscribed', () => !pubsub.isSubscribed())
      // Several reconnect attempts fail against the closed port.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(warn).toHaveBeenCalledTimes(1)
      await fake.start()
      servers.push(fake)
      await until('the instance to report subscribed again', () => pubsub.isSubscribed())
      expect(warn).toHaveBeenCalledTimes(1)
      expect(log.mock.calls.map((call) => String(call[0]))).toEqual([UP, UP])
    }),
  )

  // ioredis replays SUBSCRIBE only when autoResubscribe is on; the adapter confirms its own, so
  // turning the option off cannot leave the instance deaf after a reconnect.
  it(
    'recovers after a drop when the client has autoResubscribe off',
    traced(async () => {
      spies()
      const fake = await server()
      const pubsub = new RedisRealtimePubSub({
        client: client(fake.port, { autoResubscribe: false }),
      })
      await subscribe(pubsub)
      fake.drop()
      await until('the instance to report unsubscribed', () => !pubsub.isSubscribed())
      await until('the instance to report subscribed again', () => pubsub.isSubscribed())
    }),
  )

  // A refusal that arrives after boot cannot fail the boot: the instance stays unsubscribed and
  // says why, once.
  it(
    'stays unsubscribed and reports a refusal that arrives after boot',
    traced(async () => {
      const { warn } = spies()
      const fake = await closedPort()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await subscribe(pubsub)
      behave(fake, (command, socket) =>
        command[0] === 'SUBSCRIBE' ? '-NOPERM revoked later\r\n' : healthyRedis(command, socket),
      )
      await fake.start()
      servers.push(fake)
      await until('the refusal to be reported', () => linesAbout(warn, 'revoked later').length > 0)
      expect(pubsub.isSubscribed()).toBe(false)
      expect(linesAbout(warn, 'revoked later')[0]).toBe(refusalLine('NOPERM revoked later'))
    }),
  )

  // A refusal of the SUBSCRIBE that follows a reconnect is the confirmation's to report: the
  // original SUBSCRIBE succeeded long ago, so nothing else sees it.
  it(
    'stays unsubscribed and reports a refusal of the SUBSCRIBE after a reconnect',
    traced(async () => {
      const { warn } = spies()
      const fake = await server()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await subscribe(pubsub)
      behave(fake, (command, socket) =>
        command[0] === 'SUBSCRIBE' ? '-NOPERM acl changed\r\n' : healthyRedis(command, socket),
      )
      // A refusal logged by another test's instance after its teardown, as CI delivered it.
      new Logger('RedisRealtimePubSub').warn(refusalLine('NOPERM revoked later'))
      fake.drop()
      await until('the refusal to be reported', () => linesAbout(warn, 'acl changed').length > 0)
      expect(pubsub.isSubscribed()).toBe(false)
      expect(linesAbout(warn, 'acl changed')).toEqual([refusalLine('NOPERM acl changed')])
    }),
  )

  // A server that refuses after the boot has completed is not a reason to give up: ioredis keeps
  // retrying the handshake, and the first one the server accepts makes the instance subscribed.
  it(
    'becomes subscribed once a server that refused after boot accepts the credentials',
    traced(async () => {
      const { warn } = spies()
      const fake = await closedPort()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      await subscribe(pubsub)
      behave(fake, (command, socket) =>
        command[0] === 'HELLO' ? '-WRONGPASS rotated\r\n' : healthyRedis(command, socket),
      )
      await fake.start()
      servers.push(fake)
      await until('the refusal to be reported', () => linesAbout(warn, 'rotated').length > 0)
      expect(pubsub.isSubscribed()).toBe(false)
      behave(fake, healthyRedis)
      await until('the instance to report subscribed', () => pubsub.isSubscribed())
    }),
  )

  // The last unsubscribe quits the client on purpose; that is not an outage and logs nothing.
  it(
    'stays quiet when the last handler unsubscribes',
    traced(async () => {
      const { warn } = spies()
      const fake = await server()
      const pubsub = new RedisRealtimePubSub({ client: client(fake.port) })
      const unsubscribe = await subscribe(pubsub)
      await unsubscribe()
      expect(pubsub.isSubscribed()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(warn).not.toHaveBeenCalled()
    }),
  )
})
