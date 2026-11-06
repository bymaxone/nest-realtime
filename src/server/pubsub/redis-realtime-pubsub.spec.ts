/**
 * @fileoverview Unit tests for RedisRealtimePubSub using ioredis-mock.
 * @layer infrastructure
 */
import { EventEmitter } from 'node:events'
import { inspect } from 'node:util'
import { Logger } from '@nestjs/common'
import RedisMock from 'ioredis-mock'
import type { Redis } from 'ioredis'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

const msg: RealtimePubSubMessage = { op: 'broadcast', args: { event: 'x' }, origin: 'inst-1' }

function build(channel?: string) {
  const client = new RedisMock() as unknown as Redis
  const opts = channel !== undefined ? { client, channel } : { client }
  const pubsub = new RedisRealtimePubSub(opts)
  return { pubsub, client }
}

describe('RedisRealtimePubSub', () => {
  // publish serialises the message to the configured Redis channel.
  it('publishes a JSON-encoded message to the channel', async () => {
    const { pubsub, client } = build('test:ch')
    const received: string[] = []
    const sub = client.duplicate()
    await sub.subscribe('test:ch')
    sub.on('message', (_ch: string, payload: string) => received.push(payload))
    await pubsub.publish(msg)
    // Give the event loop a tick to propagate.
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]!)).toMatchObject({ op: 'broadcast', origin: 'inst-1' })
    await sub.quit()
  })

  // subscribe delivers published messages to the handler.
  it('subscribe handler receives published messages', async () => {
    const { pubsub } = build()
    const received: RealtimePubSubMessage[] = []
    await pubsub.subscribe((m) => received.push(m))
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ op: 'broadcast' })
  })

  // Multiple handlers on the same instance all receive the message.
  it('delivers to multiple handlers on the same instance', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // Unsubscribing the last handler quits the sub client.
  it('quits the sub client when the last handler unsubscribes', async () => {
    const { pubsub } = build()
    const handler = jest.fn()
    const unsub = await pubsub.subscribe(handler)
    await unsub()
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()
  })

  // A second subscriber re-uses the existing sub client (no duplicate connection).
  it('reuses the sub client for additional subscribers', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // A malformed JSON payload from Redis never reaches a handler.
  it('does not deliver malformed JSON payloads to a handler', async () => {
    const { pubsub, client } = build()
    const handler = jest.fn()
    await pubsub.subscribe(handler)
    // Directly publish raw malformed bytes to the channel.
    await client.publish('bymax:realtime', '{not json')
    await new Promise((r) => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()
  })

  // A payload the bus cannot parse is dropped and reported: the log names the code, and a burst is
  // reported once per minute with the count, so a version skew shows without flooding.
  it('warns about malformed payloads once per minute with the count dropped', async () => {
    const { pubsub, client } = build()
    await pubsub.subscribe(jest.fn())
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const now = jest.spyOn(Date, 'now')
    try {
      now.mockReturnValue(1_000_000)
      await client.publish('bymax:realtime', '{not json')
      await client.publish('bymax:realtime', 'also not json')
      await new Promise((r) => setTimeout(r, 0))
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        'REALTIME_PUBSUB_UNAVAILABLE: dropped 1 malformed payload(s) on "bymax:realtime" since the last report',
      )
      now.mockReturnValue(1_000_000 + 60_000)
      await client.publish('bymax:realtime', 'again')
      await new Promise((r) => setTimeout(r, 0))
      expect(warnSpy).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenLastCalledWith(
        'REALTIME_PUBSUB_UNAVAILABLE: dropped 2 malformed payload(s) on "bymax:realtime" since the last report',
      )
    } finally {
      now.mockRestore()
      warnSpy.mockRestore()
    }
  })

  // A throwing handler does not block other handlers.
  it('isolates a throwing handler from remaining handlers', async () => {
    const { pubsub } = build()
    const throwing = jest.fn().mockImplementation(() => {
      throw new Error('boom')
    })
    const safe = jest.fn()
    await pubsub.subscribe(throwing)
    await pubsub.subscribe(safe)
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(safe).toHaveBeenCalledTimes(1)
  })

  // The default channel name is bymax:realtime.
  it('defaults to the bymax:realtime channel', async () => {
    const { pubsub } = build(undefined)
    const received: RealtimePubSubMessage[] = []
    await pubsub.subscribe((m) => received.push(m))
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
  })

  // The outage line names why the connection failed. ioredis wraps a refused connect in an error
  // that can have a code and no message, or a message and no code, or neither.
  it.each([
    [
      'a code and a message',
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:6379' },
      'ECONNREFUSED connect ECONNREFUSED 10.0.0.1:6379',
    ],
    ['a code and no message', { code: 'ETIMEDOUT', message: '' }, 'ETIMEDOUT'],
    ['a message and no code', { message: 'socket hang up' }, 'socket hang up'],
    ['a code that is not text', { code: 111, message: 'socket hang up' }, 'socket hang up'],
    ['neither', { message: '' }, 'Error'],
  ])('states the connection failure with %s', async (_label, fields, reason) => {
    const handlers: Record<string, (value: unknown) => void> = {}
    const sub = {
      subscribe: jest.fn().mockReturnValue(new Promise(() => undefined)),
      on: jest.fn((event: string, handler: (value: unknown) => void) => {
        handlers[event] = handler
      }),
    }
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
      const subscribing = pubsub.subscribe(jest.fn())
      handlers['error']!(Object.assign(new Error(fields.message), fields))
      await subscribing
      expect(warn).toHaveBeenCalledWith(
        `REALTIME_PUBSUB_UNAVAILABLE: not subscribed to "bymax:realtime": ${reason}. Remote events and revocations will not reach this instance until it subscribes again`,
      )
    } finally {
      warn.mockRestore()
    }
  })

  // More than one confirmation can be answered while the instance is already subscribed; each
  // extra one must log nothing, so a recovery is one line. The ready handler is fired by hand, so
  // no network order is involved.
  it('logs the subscription once when a second confirmation arrives while subscribed', async () => {
    const handlers: Record<string, () => void> = {}
    const sub = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      }),
    }
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
      await pubsub.subscribe(jest.fn())
      expect(log).toHaveBeenCalledTimes(1)
      handlers['ready']!()
      handlers['ready']!()
      await new Promise((resolve) => setImmediate(resolve))
      expect(sub.subscribe).toHaveBeenCalledTimes(3)
      expect(pubsub.isSubscribed()).toBe(true)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  // The subscriber is the adapter's own connection: it keeps its offline queue so the first
  // SUBSCRIBE can wait for the connection whatever the host client was built with, and it leaves
  // the re-subscribing to the adapter.
  it('duplicates the host client with the offline queue on and ioredis resubscribe off', async () => {
    const sub = { subscribe: jest.fn().mockResolvedValue(undefined), on: jest.fn() }
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
    await pubsub.subscribe(jest.fn())
    expect(pub.duplicate).toHaveBeenCalledWith({ autoResubscribe: false, enableOfflineQueue: true })
  })

  // Only an error reply is the server refusing the subscription. Any other rejection of the first
  // SUBSCRIBE is the connection failing (ioredis rejects at once when it cannot write, and gives up
  // after its retries), so the boot completes unready and the reason is logged.
  it('treats a rejection that is not an error reply as the connection failing', async () => {
    const sub = {
      subscribe: jest
        .fn()
        .mockRejectedValue(
          new Error("Stream isn't writeable and enableOfflineQueue options is false"),
        ),
      on: jest.fn(),
    }
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
      await expect(pubsub.subscribe(jest.fn())).resolves.toEqual(expect.any(Function))
      expect(pubsub.isSubscribed()).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        `REALTIME_PUBSUB_UNAVAILABLE: not subscribed to "bymax:realtime": Stream isn't writeable and enableOfflineQueue options is false. Remote events and revocations will not reach this instance until it subscribes again`,
      )
      // The rejection is the connection failing, which was just reported: it is not also a refusal.
      await new Promise((resolve) => setImmediate(resolve))
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  // The SUBSCRIBE sent when the subscriber is ready again can be rejected because the connection
  // closed under it, which is an outage that 'close' reports: it must not read as the server
  // refusing, and it must not take away a subscription the instance still holds. The ready handler
  // is fired by hand, so no network order is involved.
  it('does not read a SUBSCRIBE rejected by a closing connection as a refusal', async () => {
    const handlers: Record<string, () => void> = {}
    const sub = {
      subscribe: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Connection is closed.')),
      on: jest.fn((event: string, handler: () => void) => {
        handlers[event] = handler
      }),
    }
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
      await pubsub.subscribe(jest.fn())
      expect(pubsub.isSubscribed()).toBe(true)

      handlers['ready']!()
      await new Promise((resolve) => setImmediate(resolve))

      expect(sub.subscribe).toHaveBeenCalledTimes(2)
      expect(pubsub.isSubscribed()).toBe(true)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  // ioredis queues a command issued while the client is not ready and sends it, late, when the
  // connection returns, so a revocation or an emit would wait out the whole outage and then be sent
  // after its caller was told it failed. The publish is refused at once instead, and never queued.
  it.each(['wait', 'connecting', 'connect', 'reconnecting', 'close', 'end'])(
    'rejects a publish at once while the client is %s, without handing it to the client',
    async (status) => {
      const publish = jest.fn()
      const connect = jest.fn().mockResolvedValue(undefined)
      const pubsub = new RedisRealtimePubSub({
        client: { status, publish, connect } as unknown as Redis,
      })
      await expect(pubsub.publish(msg)).rejects.toThrow(
        `[RedisRealtimePubSub] REALTIME_PUBSUB_UNAVAILABLE: cannot publish to "bymax:realtime" (the Redis client is ${status})`,
      )
      expect(publish).not.toHaveBeenCalled()
      // Only a client that was told to wait for its first command is connected on its behalf.
      expect(connect).toHaveBeenCalledTimes(status === 'wait' ? 1 : 0)
    },
  )

  // A test double such as ioredis-mock reports no status at all; it is taken to be able to publish.
  it.each(['ready', ''])('hands a publish to the client whose status is %p', async (status) => {
    const publish = jest.fn().mockResolvedValue(1)
    const pubsub = new RedisRealtimePubSub({
      client: { status, publish } as unknown as Redis,
    })
    await expect(pubsub.publish(msg)).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledWith('bymax:realtime', JSON.stringify(msg))
  })

  // Readiness is the ability to carry traffic both ways: a confirmed subscription is not enough
  // when the connection that publishes cannot publish.
  it.each([
    ['ready', true],
    ['', true],
    ['wait', false],
    ['reconnecting', false],
  ])('reports %s publisher as subscribed=%s', async (status, expected) => {
    const sub = { subscribe: jest.fn().mockResolvedValue(undefined), on: jest.fn() }
    const pub = {
      duplicate: jest.fn().mockReturnValue(sub),
      status,
      connect: jest.fn().mockResolvedValue(undefined),
    }
    const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
    await pubsub.subscribe(jest.fn())
    expect(pubsub.isSubscribed()).toBe(expected)
  })

  // Subscribing waits for the publishing client to answer its first connection, ready or closed, so
  // an emit from another provider's start-up hook is not refused for the client's first milliseconds.
  // The events are fired by hand, so no network order is involved.
  describe('waiting for the publishing client', () => {
    function publisher(status: string) {
      const sub = { subscribe: jest.fn().mockResolvedValue(undefined), on: jest.fn() }
      return Object.assign(new EventEmitter(), {
        status,
        duplicate: jest.fn().mockReturnValue(sub),
        connect: jest.fn().mockResolvedValue(undefined),
      })
    }
    const pending = async (promise: Promise<unknown>): Promise<boolean> => {
      let done = false
      void promise.then(() => (done = true))
      await new Promise((resolve) => setImmediate(resolve))
      return !done
    }

    it('does not wait for a client that is already ready', async () => {
      const pub = publisher('ready')
      const subscribing = new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(
        jest.fn(),
      )
      expect(await pending(subscribing)).toBe(false)
      expect(pub.listenerCount('ready')).toBe(0)
      expect(pub.listenerCount('close')).toBe(0)
    })

    // Every way ioredis ends a first connection: it is ready, it closes (and retries, or gives
    // up), or its connector fails and it ends with no close at all.
    it.each(
      ['connecting', 'connect'].flatMap((status) =>
        ['ready', 'close', 'reconnecting', 'end'].map((event) => [status, event]),
      ),
    )(
      'waits for a client that is %s until it is %s, then stops listening',
      async (status, event) => {
        const pub = publisher(status)
        const subscribing = new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(
          jest.fn(),
        )
        expect(await pending(subscribing)).toBe(true)
        pub.emit(event)
        expect(await pending(subscribing)).toBe(false)
        for (const name of ['ready', 'close', 'reconnecting', 'end']) {
          expect(pub.listenerCount(name)).toBe(0)
        }
      },
    )

    // The wait starts only once the subscriber is attached: a subscriber that reconnects while the
    // publisher is still connecting must re-subscribe, and a boot that fails never starts the wait.
    it('re-subscribes when the subscriber reconnects while the publisher is still connecting', async () => {
      const handlers: Record<string, () => void> = {}
      const pub = publisher('connecting')
      const sub = {
        subscribe: jest.fn().mockResolvedValue(undefined),
        on: jest.fn((event: string, handler: () => void) => {
          handlers[event] = handler
        }),
      }
      pub.duplicate.mockReturnValue(sub)
      const subscribing = new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(
        jest.fn(),
      )
      await new Promise((resolve) => setImmediate(resolve))
      expect(sub.subscribe).toHaveBeenCalledTimes(1)

      handlers['ready']!()
      await new Promise((resolve) => setImmediate(resolve))
      expect(sub.subscribe).toHaveBeenCalledTimes(2)

      pub.emit('ready')
      await subscribing
    })

    it('never starts the wait when the subscription is refused', async () => {
      const pub = publisher('connecting')
      pub.duplicate.mockReturnValue({
        subscribe: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('NOPERM'), { name: 'ReplyError' })),
        on: jest.fn(),
        disconnect: jest.fn(),
      })
      await expect(
        new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(jest.fn()),
      ).rejects.toThrow('could not subscribe')
      for (const name of ['ready', 'close', 'reconnecting', 'end']) {
        expect(pub.listenerCount(name)).toBe(0)
      }
    })

    // The wait can never block the boot: a client that stays connecting is given up on at the
    // deadline, which leaves nothing listening and no timer behind.
    describe('with a client that never answers', () => {
      beforeEach(() => jest.useFakeTimers())
      afterEach(() => jest.useRealTimers())

      it('gives up at the deadline, and not before', async () => {
        const pub = publisher('connecting')
        let done = false
        void new RedisRealtimePubSub({ client: pub as unknown as Redis })
          .subscribe(jest.fn())
          .then(() => (done = true))
        await jest.advanceTimersByTimeAsync(1_999)
        expect(done).toBe(false)
        await jest.advanceTimersByTimeAsync(1)
        expect(done).toBe(true)
        for (const name of ['ready', 'close', 'reconnecting', 'end']) {
          expect(pub.listenerCount(name)).toBe(0)
        }
        expect(jest.getTimerCount()).toBe(0)
      })

      it('leaves no timer behind when the client answers first, and never keeps the process alive', async () => {
        const pub = publisher('connecting')
        // Wrapped by hand and put back in `finally`: the fake clock owns `setTimeout` here, and a
        // spy that jest restores later would put the fake one back for the tests that follow.
        const fake = globalThis.setTimeout
        const created: NodeJS.Timeout[] = []
        globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
          const timer = fake(...args)
          created.push(timer)
          return timer
        }) as typeof setTimeout
        try {
          const subscribing = new RedisRealtimePubSub({
            client: pub as unknown as Redis,
          }).subscribe(jest.fn())
          await jest.advanceTimersByTimeAsync(10)
          pub.emit('ready')
          await subscribing
        } finally {
          globalThis.setTimeout = fake
        }
        expect(jest.getTimerCount()).toBe(0)
        expect(created.some((timer) => timer.hasRef() === false)).toBe(true)
      })
    })

    it.each(['reconnecting', 'close', 'end'])(
      'does not wait for a client that is %s, which has already answered',
      async (status) => {
        const pub = publisher(status)
        const subscribing = new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(
          jest.fn(),
        )
        expect(await pending(subscribing)).toBe(false)
        expect(pub.listenerCount('ready')).toBe(0)
      },
    )

    // A lazy client leaves 'wait' for 'connecting' as soon as it is told to connect.
    it('waits for a lazy client that the adapter has just connected', async () => {
      const pub = publisher('wait')
      pub.connect.mockImplementation(() => {
        pub.status = 'connecting'
        return Promise.resolve()
      })
      const subscribing = new RedisRealtimePubSub({ client: pub as unknown as Redis }).subscribe(
        jest.fn(),
      )
      expect(await pending(subscribing)).toBe(true)
      expect(pub.connect).toHaveBeenCalledTimes(1)
      pub.emit('ready')
      expect(await pending(subscribing)).toBe(false)
    })
  })

  // When subscriber init fails, the handler is rolled back and subInit is cleared so the
  // next subscribe() retries with a fresh client instead of re-awaiting the rejected promise.
  it('rolls back handler and clears subInit when subscriber init fails', async () => {
    let duplicateCall = 0
    const failingSub = {
      // Only an error reply is the server refusing; anything else is the connection failing.
      subscribe: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('redis down'), { name: 'ReplyError' })),
      on: jest.fn(),
      disconnect: jest.fn(),
    }
    const recoverySub = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    }
    const fakePub = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest
        .fn()
        .mockImplementation(() => (duplicateCall++ === 0 ? failingSub : recoverySub)),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const handler = jest.fn()

    // First subscribe fails — must reject and not leave the handler registered.
    await expect(pubsub.subscribe(handler)).rejects.toThrow('redis down')
    // The failed subscriber is closed, not left retrying in the background.
    expect(failingSub.disconnect).toHaveBeenCalledTimes(1)

    // Second subscribe must retry (duplicate called a second time) and succeed.
    const unsub = await pubsub.subscribe(handler)
    expect(fakePub.duplicate).toHaveBeenCalledTimes(2)
    await unsub()
  })

  // Concurrent subscribe() calls are idempotent — the sub client is created exactly once.
  it('concurrent subscribe() calls create the sub client only once', async () => {
    // Covers: ensureSubscriber() returns the same in-flight promise for concurrent calls.
    const { pubsub, client } = build()
    const duplicateSpy = jest.spyOn(client, 'duplicate')
    await Promise.all([pubsub.subscribe(jest.fn()), pubsub.subscribe(jest.fn())])
    expect(duplicateSpy).toHaveBeenCalledTimes(1)
  })

  // When quit() rejects on the last unsubscribe, the unsubscribe still resolves and the
  // next subscribe creates a fresh client.
  it('swallows a quit failure and lets the next subscribe create a new client', async () => {
    // Covers: subInit is cleared before quit so a failing quit does not strand the reference.
    const makeSub = (quitImpl: () => Promise<void>) => ({
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      quit: jest.fn().mockImplementation(quitImpl),
    })

    let callCount = 0
    const fakePub = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest
        .fn()
        .mockImplementation(() =>
          callCount++ === 0
            ? makeSub(() => Promise.reject(new Error('quit failure')))
            : makeSub(() => Promise.resolve()),
        ),
    }

    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub = await pubsub.subscribe(jest.fn())

    // The last unsubscribe triggers quit — must resolve even if quit rejects.
    await expect(unsub()).resolves.toBeUndefined()

    // Next subscribe must call duplicate again (new client, since subInit was cleared).
    await pubsub.subscribe(jest.fn())
    expect(fakePub.duplicate).toHaveBeenCalledTimes(2)
  })
  // The default channel must be the 'bymax:realtime' string, not an empty string.
  it('publishes to the bymax:realtime channel when no channel option is provided', async () => {
    const { client } = build()
    const publishSpy = jest.spyOn(client as unknown as { publish: jest.Mock }, 'publish')
    const pubsub = new RedisRealtimePubSub({ client })
    await pubsub.publish(msg)
    expect(publishSpy).toHaveBeenCalledWith('bymax:realtime', expect.any(String))
    publishSpy.mockRestore()
  })

  // The second handler must still receive messages after the first handler unsubscribes.
  it('second handler receives messages after first handler is removed', async () => {
    const { pubsub } = build()
    const a = jest.fn()
    const b = jest.fn()
    const unsub1 = await pubsub.subscribe(a)
    await pubsub.subscribe(b)
    await unsub1()
    await pubsub.publish(msg)
    await new Promise((r) => setTimeout(r, 10))
    expect(b).toHaveBeenCalledTimes(1)
  })

  // The sub client's quit() is called when the last handler unsubscribes.
  it('calls quit on the sub client when the last handler unsubscribes', async () => {
    // Kills BlockStatement mutation that removes the try { await sub.quit() } block.
    const quitMock = jest.fn().mockResolvedValue('OK')
    const fakeSub = {
      subscribe: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      quit: quitMock,
    }
    const fakePub = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(fakeSub),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub = await pubsub.subscribe(jest.fn())
    await unsub()
    expect(quitMock).toHaveBeenCalled()
  })

  // Kills L78 ConditionalExpression: `if (this.handlers.size === 0)` → `if (true)`.
  // With two handlers, removing only the first still leaves handlers.size=1, so quit must NOT fire.
  it('does not quit the sub client when a second handler is still registered', async () => {
    const quitMock = jest.fn().mockResolvedValue('OK')
    const fakeSub = {
      subscribe: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      quit: quitMock,
    }
    const fakePub = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(fakeSub),
    }
    const pubsub = new RedisRealtimePubSub({ client: fakePub as unknown as Redis })
    const unsub1 = await pubsub.subscribe(jest.fn())
    await pubsub.subscribe(jest.fn())
    await unsub1()
    expect(quitMock).not.toHaveBeenCalled()
  })
  it('keeps the Redis clients out of every serialization path', () => {
    // Both the publisher and the lazily created subscriber carry
    // `options.password`, so neither may remain reachable by walking the
    // adapter — which is what a logger does when it renders its arguments.
    const password = 'r3d1s-canary'
    const client = { options: { password } } as unknown as Redis
    const pubsub = new RedisRealtimePubSub({ client })

    expect(JSON.stringify(pubsub)).not.toContain(password)
    expect(JSON.stringify({ ...pubsub })).not.toContain(password)
    expect(inspect(pubsub, { depth: null, showHidden: true })).not.toContain(password)
  })
})
