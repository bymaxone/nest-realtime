/**
 * @fileoverview What `RedisRealtimePubSub` forwards of a Redis client error: the reply code and a
 * fixed library message, and nothing of the client's message, cause or command.
 * @layer test
 */
import { inspect } from 'node:util'
import { Logger } from '@nestjs/common'
import { Redis } from 'ioredis'
import { FakeRespServer, healthyRedis } from '../../../test/fixtures/fake-resp-server'
import type { RespHandler } from '../../../test/fixtures/fake-resp-server'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

// Upper case, because the fake server upper-cases the words it reads and some replies repeat them.
const PASSWORD = 'DUMMY_PASSWORD_ZQ9'
const PAYLOAD = 'DUMMY_PAYLOAD_K3V'
const USER = 'DUMMY_USER_M7Q'

const wrongPass: RespHandler = (command, socket) =>
  command[0] === 'HELLO' || command[0] === 'AUTH'
    ? '-WRONGPASS invalid username-password pair or user is disabled.\r\n'
    : healthyRedis(command, socket)

/** An error reply whose text holds the words of the command it answers. */
const repeatsArguments: RespHandler = (command, socket) =>
  command[0] === 'HELLO' || command[0] === 'AUTH'
    ? `-ERR unknown command '${command[0]}', with args beginning with: ${command.slice(1).join(' ')}\r\n`
    : healthyRedis(command, socket)

/** An error text whose first word is not shaped like a reply code. */
const freeText: RespHandler = (command, socket) =>
  command[0] === 'HELLO' || command[0] === 'AUTH'
    ? `-${command.at(-1)} was not accepted\r\n`
    : healthyRedis(command, socket)

/** Everything a value holds, its causes and non-enumerable properties included. */
function everything(value: unknown): string {
  return inspect(value, { depth: 12, showHidden: true })
}

function expectNoValues(value: unknown): void {
  const text = everything(value)
  for (const value of [PASSWORD, PAYLOAD, USER]) expect(text).not.toContain(value)
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(condition()).toBe(true)
}

describe('RedisRealtimePubSub error hygiene', () => {
  let server: FakeRespServer
  let client: Redis
  let pubsub: RedisRealtimePubSub
  let warn: jest.SpyInstance
  // Closed after each case: a subscriber left open keeps reconnecting and jest never exits.
  let close: (() => Promise<void>) | undefined

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    server = new FakeRespServer()
    await server.start()
  })

  afterEach(async () => {
    await close?.()
    close = undefined
    client.disconnect()
    await server.stop()
    jest.restoreAllMocks()
  })

  function connect(): RedisRealtimePubSub {
    client = new Redis({
      host: '127.0.0.1',
      port: server.port,
      password: PASSWORD,
      retryStrategy: () => 50,
    })
    client.on('error', () => undefined)
    pubsub = new RedisRealtimePubSub({ client })
    return pubsub
  }

  const logged = (): string => everything(warn.mock.calls)

  // A refused boot rejects with the reply code; the rejection and its cause hold nothing else.
  it.each([
    ['a wrong password', wrongPass, 'the Redis server replied WRONGPASS'],
    ['an error text that repeats the arguments', repeatsArguments, 'the Redis server replied ERR'],
    ['an error text with no code', freeText, 'the Redis server replied with an error'],
  ])('rejects the boot on %s with the reply code only', async (_label, handler, message) => {
    server.respond(handler)
    const refusal = await connect()
      .subscribe(jest.fn())
      .then(
        (unsubscribe) => {
          close = unsubscribe
        },
        (error: unknown) => error,
      )
    expectNoValues(refusal)
    expectNoValues(warn.mock.calls)
    expect(refusal).toMatchObject({
      code: 'REALTIME_PUBSUB_UNAVAILABLE',
      cause: { name: 'ReplyError', message },
    })
    expect((refusal as { cause: object }).cause).not.toHaveProperty('command')
  })

  // A boot that went on unready logs the refusal that arrives later, with the code only.
  it.each([
    ['a wrong password', wrongPass, 'WRONGPASS'],
    ['an error text that repeats the arguments', repeatsArguments, 'ERR'],
  ])('logs %s met after the boot with the reply code only', async (_label, handler, code) => {
    await server.stop()
    close = await connect().subscribe(jest.fn())
    server.respond(handler)
    await server.start()
    await until(() => logged().includes('the server refused the subscription'))
    expectNoValues(warn.mock.calls)
    expect(logged()).toContain(`the Redis server replied ${code}`)
  })

  // A rejected PUBLISH rejects with the reply code and nothing of what was published.
  it('rejects a refused publish with the reply code only', async () => {
    server.respond((command, socket) =>
      command[0] === 'PUBLISH'
        ? "-OOM command not allowed when used memory > 'maxmemory'.\r\n"
        : healthyRedis(command, socket),
    )
    close = await connect().subscribe(jest.fn())
    const rejection = await pubsub
      .publish({ op: 'emit', target: { userId: USER }, event: 'e', data: PAYLOAD } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expectNoValues(rejection)
    expect(rejection).toMatchObject({
      name: 'ReplyError',
      message: 'the Redis server replied OOM',
    })
    expect(rejection).not.toHaveProperty('command')
  })

  // Of the client's own errors only a system error code is kept.
  it.each([
    ['no code', {}, 'the Redis client failed'],
    ['a system code', { code: 'ECONNRESET' }, 'the Redis client failed (ECONNRESET)'],
    ['a code that is free text', { code: PASSWORD.toLowerCase() }, 'the Redis client failed'],
  ])('reduces a client error with %s', async (_label, fields, message) => {
    const raised = Object.assign(new Error(`aborted ${PASSWORD}`), fields, {
      command: { name: 'publish', args: ['channel', PAYLOAD] },
    })
    client = new Redis({ lazyConnect: true })
    const fake = { status: 'ready', publish: jest.fn().mockRejectedValue(raised) }
    const rejection = await new RedisRealtimePubSub({ client: fake as unknown as Redis })
      .publish({ op: 'emit' } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toMatchObject({ name: 'Error', message })
    expect(rejection).not.toHaveProperty('command')
    expect(rejection).not.toHaveProperty('cause')
    expectNoValues(rejection)
  })

  // A rejection can be any value, one that refuses to be read included.
  it.each([
    ['null', null],
    ['text', PASSWORD],
    [
      'an object that throws when read',
      Object.defineProperty({}, 'name', {
        get: () => {
          throw new Error(PASSWORD)
        },
      }),
    ],
  ])('reduces a rejection that is %s', async (_label, raised) => {
    client = new Redis({ lazyConnect: true })
    const fake = { status: 'ready', publish: jest.fn().mockRejectedValue(raised) }
    const rejection = await new RedisRealtimePubSub({ client: fake as unknown as Redis })
      .publish({ op: 'emit' } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toMatchObject({ name: 'Error', message: 'the Redis client failed' })
    expectNoValues(rejection)
  })

  // A refusal the library raises about what the client returned is the library's, not the client's.
  it.each([
    [
      'a Proxy',
      () => new Proxy({}, {}),
      { code: 'REALTIME_TRANSPORT_UNAVAILABLE', message: expect.stringContaining('a Proxy') },
    ],
    [
      'a promise that cannot carry the engine constructor',
      () => Object.preventExtensions(Promise.resolve(1)),
      { name: 'TypeError', message: expect.stringContaining('cannot carry the engine') },
    ],
  ])('keeps its own refusal when the client returns %s', async (_label, result, refusal) => {
    client = new Redis({ lazyConnect: true })
    const fake = { status: 'ready', publish: jest.fn(result) }
    const rejection = await new RedisRealtimePubSub({ client: fake as unknown as Redis })
      .publish({ op: 'emit' } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toMatchObject(refusal)
  })

  // A client that throws instead of returning a promise raised a client error all the same.
  it('reduces an error the client throws synchronously', async () => {
    client = new Redis({ lazyConnect: true })
    const publish = jest.fn(() => {
      throw new Error(`refused ${PASSWORD}`)
    })
    const fake = { status: 'ready', publish }
    const rejection = await new RedisRealtimePubSub({ client: fake as unknown as Redis })
      .publish({ op: 'emit' } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    expect(rejection).toMatchObject({ name: 'Error', message: 'the Redis client failed' })
    expectNoValues(rejection)
  })
})
