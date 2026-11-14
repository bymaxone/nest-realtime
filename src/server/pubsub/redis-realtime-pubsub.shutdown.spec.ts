/**
 * @fileoverview Closing an application whose Redis stops answering after the pub/sub subscriber
 * connected: the close gives up on the subscriber's QUIT at a bound instead of waiting for a reply
 * that never comes, against a real ioredis client and a scripted server.
 * @layer test
 */
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import Redis from 'ioredis'
import { FakeRespServer } from '../../../test/fixtures/fake-resp-server'
import { BymaxRealtimeModule } from '../realtime.module'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

jest.setTimeout(8_000)

/** How long closing waits for the subscriber's QUIT before it disconnects the connection. */
const QUIT_WAIT_MS = 2_000

const clients: Redis[] = []
const servers: FakeRespServer[] = []
const apps: INestApplication[] = []

afterEach(async () => {
  // A case abandoned at its time limit never reaches its own `finally`, and fake timers left
  // installed would hang the cases after it.
  jest.useRealTimers()
  jest.restoreAllMocks()
  for (const redis of clients.splice(0)) redis.disconnect()
  for (const fake of servers.splice(0)) await fake.stop()
  apps.length = 0
})

/** Boots an SSE application on a pub/sub over `fake`, and resolves with the client it was given. */
async function bootOn(fake: FakeRespServer): Promise<INestApplication> {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  const redis = new Redis({ host: '127.0.0.1', port: fake.port, retryStrategy: () => 40 })
  redis.on('error', () => undefined)
  clients.push(redis)
  const module = await Test.createTestingModule({
    imports: [
      BymaxRealtimeModule.forRoot({
        transport: 'sse',
        authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        pubsub: new RedisRealtimePubSub({ client: redis }),
      }),
    ],
  }).compile()
  const app = module.createNestApplication()
  apps.push(app)
  await app.init()
  return app
}

/**
 * Lets the event loop turn until `condition` holds, on the real `setImmediate` that the test's fake
 * clock leaves alone, so a socket's data is read while the fake clock is installed. A condition that
 * never holds fails the case here, with its name, and not at the case's time limit.
 */
async function turnsUntil(what: string, condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 5_000 && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  if (!condition()) throw new Error(`the event loop turned 5000 times without ${what}`)
}

/** A scripted server that answers like Redis until `silence()` and says nothing after it. */
async function scriptedServer(): Promise<{
  fake: FakeRespServer
  quitSeen: () => boolean
  silence: () => void
}> {
  const fake = new FakeRespServer()
  await fake.start()
  servers.push(fake)
  const silence = (): void => fake.respond(() => null)
  const quitSeen = (): boolean => fake.seen.some((command) => command[0] === 'QUIT')
  return { fake, quitSeen, silence }
}

describe('closing an application whose Redis goes silent', () => {
  // The subscriber's QUIT is a command on a connection that no longer answers, so it never settles
  // and, with nothing bounding it, neither does the close. The clock belongs to the test: the QUIT
  // reaches the server, the close is still pending one millisecond before the bound, and it has
  // settled at the bound exactly.
  it('closes at the bound, not before and not after, when the subscriber QUIT is never answered', async () => {
    const { quitSeen, silence, fake } = await scriptedServer()
    const app = await bootOn(fake)
    expect(fake.seen.some((command) => command[0] === 'SUBSCRIBE')).toBe(true)
    silence()
    jest.useFakeTimers({
      doNotFake: [
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'Date',
        'performance',
      ],
    })
    try {
      let closed = false
      const closing = app.close().then(() => {
        closed = true
      })
      await turnsUntil('the QUIT reaching the server', quitSeen)

      await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1)
      expect(closed).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      await turnsUntil('the close settling at the bound', () => closed)
      await closing
    } finally {
      jest.useRealTimers()
    }
  })
})
