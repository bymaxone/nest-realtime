/**
 * @fileoverview RedisRealtimePubSub.publish against a Redis that is connected and then stops
 * answering: the publish settles at a bound instead of waiting for a reply that never comes, over
 * a real ioredis client and a scripted server.
 * @layer test
 */
import type { Socket } from 'node:net'
import Redis from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

jest.setTimeout(8_000)

/** How long a publish waits for the server's answer before it is given up on. */
const PUBLISH_WAIT_MS = 2_000

const message: RealtimePubSubMessage = {
  op: 'broadcast',
  args: { event: 'tick', data: 1, id: '1' },
  origin: 'inst-1',
}

const clients: Redis[] = []
const servers: FakeRespServer[] = []

afterEach(async () => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
})

/** A server that answers like Redis until a PUBLISH arrives, then holds that command unanswered. */
async function serverHoldingPublish(): Promise<{
  fake: FakeRespServer
  held: () => Socket | undefined
}> {
  const fake = new FakeRespServer()
  await fake.start()
  servers.push(fake)
  let socket: Socket | undefined
  fake.respond((command, from) => {
    if (command[0] !== 'PUBLISH') return healthyRedis(command, from)
    socket = from
    return null
  })
  return { fake, held: () => socket }
}

/** A pub/sub over a client that is connected and ready, which is the state a paused Redis leaves it in. */
async function readyPubSub(fake: FakeRespServer): Promise<RedisRealtimePubSub> {
  const redis = new Redis({ host: '127.0.0.1', port: fake.port, retryStrategy: () => 40 })
  redis.on('error', () => undefined)
  clients.push(redis)
  await redis.ping()
  return new RedisRealtimePubSub({ client: redis })
}

/** Lets the event loop turn until `condition` holds, on the real `setImmediate` the fake clock leaves alone. */
async function turnsUntil(what: string, condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 5_000 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  if (!condition()) throw new Error(`the event loop turned 5000 times without ${what}`)
}

/** The clock belongs to the test, but the sockets and the event loop keep running. */
const FAKE_CLOCK: Parameters<typeof jest.useFakeTimers>[0] = {
  doNotFake: [
    'setImmediate',
    'clearImmediate',
    'nextTick',
    'queueMicrotask',
    'Date',
    'performance',
  ],
}

describe('publishing to a Redis that has stopped answering', () => {
  /*
   * Given a ready client whose server accepted the PUBLISH and never answers
   * When the clock reaches the bound
   * Then the publish is still pending one millisecond before it and rejects with
   *   REALTIME_PUBSUB_UNAVAILABLE at it
   */
  it('rejects at the bound, not before and not after', async () => {
    const { fake, held } = await serverHoldingPublish()
    const pubsub = await readyPubSub(fake)
    jest.useFakeTimers(FAKE_CLOCK)
    let outcome: unknown = 'pending'
    void pubsub.publish(message).then(
      () => (outcome = 'resolved'),
      (error: unknown) => (outcome = error),
    )
    await turnsUntil('the PUBLISH reaching the server', () => held() !== undefined)

    await jest.advanceTimersByTimeAsync(PUBLISH_WAIT_MS - 1)
    expect(outcome).toBe('pending')
    await jest.advanceTimersByTimeAsync(1)
    await turnsUntil('the publish settling at the bound', () => outcome !== 'pending')

    expect(outcome).toMatchObject({
      code: REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
      cause: { message: 'the server did not answer within 2000 ms' },
    })
  })

  /*
   * Given a publish that was given up on at the bound
   * When the server answers it afterwards
   * Then nothing is rejected without a handler
   */
  it('leaves no unhandled rejection when the answer comes after the bound', async () => {
    const { fake, held } = await serverHoldingPublish()
    const pubsub = await readyPubSub(fake)
    const unhandled: unknown[] = []
    const record = (reason: unknown): number => unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      jest.useFakeTimers(FAKE_CLOCK)
      let settled = false
      void pubsub.publish(message).catch(() => (settled = true))
      await turnsUntil('the PUBLISH reaching the server', () => held() !== undefined)
      await jest.advanceTimersByTimeAsync(PUBLISH_WAIT_MS)
      await turnsUntil('the publish settling at the bound', () => settled)

      held()?.write(':1\r\n')
      for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', record)
    }

    expect(unhandled).toEqual([])
  })

  /*
   * Given a server that answers a PUBLISH at once
   * When the publish settles
   * Then it resolved, and no timer is left armed
   */
  it('resolves when the server answers, and leaves no timer armed', async () => {
    const fake = new FakeRespServer()
    await fake.start()
    servers.push(fake)
    fake.respond((command, from) =>
      command[0] === 'PUBLISH' ? ':1\r\n' : healthyRedis(command, from),
    )
    const pubsub = await readyPubSub(fake)
    jest.useFakeTimers(FAKE_CLOCK)

    const publishing = pubsub.publish(message)
    await turnsUntil('the publish being answered', () => fake.seen.some((c) => c[0] === 'PUBLISH'))
    await expect(publishing).resolves.toBeUndefined()

    expect(jest.getTimerCount()).toBe(0)
  })

  /*
   * Given a publish waiting on a silent server
   * When its timer is created
   * Then the timer does not keep the process alive
   */
  it('does not let the bound keep the process alive', async () => {
    const { fake, held } = await serverHoldingPublish()
    const pubsub = await readyPubSub(fake)
    const created: NodeJS.Timeout[] = []
    const real = global.setTimeout
    jest.spyOn(global, 'setTimeout').mockImplementation(((
      ...args: Parameters<typeof setTimeout>
    ) => {
      const timer = real(...args)
      if (args[1] === PUBLISH_WAIT_MS) created.push(timer)
      return timer
    }) as typeof setTimeout)

    void pubsub.publish(message).catch(() => undefined)
    await turnsUntil('the PUBLISH reaching the server', () => held() !== undefined)

    expect(created).toHaveLength(1)
    expect(created[0]?.hasRef()).toBe(false)
    clearTimeout(created[0])
  })
})
