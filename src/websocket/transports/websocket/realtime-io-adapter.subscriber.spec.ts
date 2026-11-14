/**
 * @fileoverview RealtimeIoAdapter and the subscriber connection it opens for the Socket.IO Redis
 * adapter: closed with the adapter on one bound, released when the install fails, and guarded
 * against the rejections of the commands the Redis adapter never awaits.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeIoAdapter } from './realtime-io-adapter'

// The Redis adapter's constructor is replaced, so the subscriber stand-ins below are all it is given.
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn().mockReturnValue({}) }), {
  virtual: true,
})

/** How long closing waits for a subscriber's QUIT before it disconnects the connection. */
const QUIT_WAIT_MS = 2_000

/** What a stand-in for a subscriber connection offers: the closing calls and the four commands. */
interface Subscriber {
  quit: jest.Mock
  disconnect: jest.Mock
  subscribe: jest.Mock
  psubscribe: jest.Mock
  unsubscribe: jest.Mock
  punsubscribe: jest.Mock
}

/** A subscriber whose QUIT is `quit` and whose commands succeed. */
function subscriber(quit: () => Promise<unknown> = () => new Promise(() => undefined)): Subscriber {
  const ok = (): Promise<number> => Promise.resolve(1)
  return {
    quit: jest.fn(quit),
    disconnect: jest.fn(),
    subscribe: jest.fn(ok),
    psubscribe: jest.fn(ok),
    unsubscribe: jest.fn(ok),
    punsubscribe: jest.fn(ok),
  }
}

/** A caller's client whose `duplicate()` hands out `subscribers` in turn. */
function callerClient(...subscribers: unknown[]) {
  const duplicate = jest.fn()
  for (const next of subscribers) duplicate.mockReturnValueOnce(next)
  return {
    duplicate,
    quit: jest.fn(),
    disconnect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }
}

/** An adapter over `pubClient`; `createIOServer` of Nest's base class is replaced by a stub server. */
function adapterOver(pubClient: unknown): RealtimeIoAdapter {
  const options = { websocket: { redisAdapter: { pubClient } } } as BymaxRealtimeModuleOptions
  const app = { get: (token: symbol) => (token === REALTIME_OPTIONS_TOKEN ? options : undefined) }
  return new RealtimeIoAdapter(app as never)
}

/** Resolves with whether `promise` had settled once the microtasks queued so far have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(() => {
    done = true
  })
  await jest.advanceTimersByTimeAsync(0)
  return done
}

describe('RealtimeIoAdapter subscriber connection', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockImplementation(() => ({
      adapter: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }))
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('dispose', () => {
    // Scenario: two servers, so two subscribers, and a Redis that answers neither QUIT. Expected: both
    // have been asked to quit at once, the dispose is still pending one millisecond before the
    // bound, and at the bound it has settled with both disconnected. Why: Nest closes every server
    // at once, and a dead Redis must cost one bound for the application and not one per connection.
    it('closes every subscriber at once, on one bound', async () => {
      jest.useFakeTimers()
      const [first, second] = [subscriber(), subscriber()]
      const pub = callerClient(first, second)
      const adapter = adapterOver(pub)
      adapter.createIOServer(0)
      adapter.createIOServer(0)

      const disposing = adapter.dispose()
      await jest.advanceTimersByTimeAsync(0)
      expect(first.quit).toHaveBeenCalledTimes(1)
      expect(second.quit).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1)
      expect(await settled(disposing)).toBe(false)
      await jest.advanceTimersByTimeAsync(1)

      expect(await settled(disposing)).toBe(true)
      expect(first.disconnect).toHaveBeenCalledTimes(1)
      expect(second.disconnect).toHaveBeenCalledTimes(1)
    })

    // Scenario: the QUIT is answered. Expected: no disconnect, and a second dispose does nothing.
    // Why: an answered QUIT has closed the connection, and a connection is closed once.
    it('leaves a subscriber whose QUIT was answered, and closes each one once', async () => {
      const sub = subscriber(async () => 'OK')
      const adapter = adapterOver(callerClient(sub))
      adapter.createIOServer(0)

      await adapter.dispose()
      await adapter.dispose()

      expect(sub.quit).toHaveBeenCalledTimes(1)
      expect(sub.disconnect).not.toHaveBeenCalled()
    })

    // Scenario: the caller's client, which the adapter publishes through and duplicated from.
    // Expected: it is neither quit nor disconnected, and its own commands are the ones it came with.
    // Why: it belongs to the caller, whose application may still be using it.
    it("never closes or changes the caller's client", async () => {
      const sub = subscriber(async () => 'OK')
      const pub = callerClient(sub)
      const commands = { subscribe: pub.subscribe, unsubscribe: pub.unsubscribe }
      const adapter = adapterOver(pub)
      adapter.createIOServer(0)

      await adapter.dispose()

      expect(pub.quit).not.toHaveBeenCalled()
      expect(pub.disconnect).not.toHaveBeenCalled()
      expect(pub.subscribe).toBe(commands.subscribe)
      expect(pub.unsubscribe).toBe(commands.unsubscribe)
    })

    // Scenario: a stand-in without the closing calls, as a mock of a client can be. Expected: the
    // dispose still settles. Why: one connection that cannot be closed must not fail the others'
    // close or the application's.
    it('settles when a subscriber cannot be closed', async () => {
      const adapter = adapterOver(callerClient({}))
      adapter.createIOServer(0)

      await expect(adapter.dispose()).resolves.toBeUndefined()
    })
  })

  describe('when the Redis adapter cannot be installed', () => {
    const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
      createAdapter: jest.Mock
    }

    // Scenario: the adapter's constructor throws after the subscriber was opened. Expected: the boot
    // fails with its own error, the subscriber is disconnected once, and a later dispose does not
    // touch it. Why: a failed install may never reach `dispose`, so the release stands on its own,
    // and the connection has no other owner.
    it('disconnects the subscriber it opened, and leaves it alone at dispose', async () => {
      const sub = subscriber()
      const adapter = adapterOver(callerClient(sub))
      createAdapter.mockImplementationOnce(() => {
        throw new Error('adapter constructor exploded')
      })

      expect(() => adapter.createIOServer(0)).toThrow(/REALTIME_REDIS_ADAPTER_FAILED/)
      await adapter.dispose()

      expect(sub.disconnect).toHaveBeenCalledTimes(1)
      expect(sub.quit).not.toHaveBeenCalled()
    })

    // Scenario: the release itself throws. Expected: the install failure is what is reported. Why:
    // a cleanup must never replace the error it runs for.
    it('reports the install failure when the release throws', () => {
      const sub = subscriber()
      sub.disconnect.mockImplementation(() => {
        throw new Error('release exploded')
      })
      const adapter = adapterOver(callerClient(sub))
      createAdapter.mockImplementationOnce(() => {
        throw new Error('adapter constructor exploded')
      })

      expect(() => adapter.createIOServer(0)).toThrow(/adapter constructor exploded/)
    })
  })

  describe('the commands the Redis adapter does not await', () => {
    /** Installs the adapter over one subscriber and returns it, as the Redis adapter would see it. */
    function installed(sub: Subscriber): Subscriber {
      adapterOver(callerClient(sub)).createIOServer(0)
      return sub
    }

    // Scenario: a command that fails, awaited by a caller. Expected: the caller still sees the
    // rejection. Why: the guard is a handler attached beside the promise, and what returns to the
    // caller is the command's own promise.
    it('still rejects for a caller that awaits the command', async () => {
      const sub = subscriber()
      sub.subscribe.mockRejectedValue(new Error('refused'))
      installed(sub)

      await expect(sub.subscribe('channel')).rejects.toThrow('refused')
    })

    // Scenario: a command that fails and whose promise the Redis adapter drops, as it does for
    // `psubscribe` at boot and `unsubscribe` at close. Expected: no unhandled rejection reaches the
    // process. Why: an unhandled rejection ends a Node process, in the middle of whatever it is doing.
    it('leaves no unhandled rejection when the promise is dropped', async () => {
      const sub = subscriber()
      sub.psubscribe.mockRejectedValue(new Error('Connection is closed.'))
      sub.unsubscribe.mockRejectedValue(new Error('Connection is closed.'))
      installed(sub)
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)

      try {
        void sub.psubscribe('pattern')
        void sub.unsubscribe('channel')
        await new Promise((resolve) => setImmediate(resolve))
      } finally {
        process.off('unhandledRejection', unhandled)
      }

      expect(unhandled).not.toHaveBeenCalled()
    })

    // Scenario: several failures on one connection, with a message that carries a host and a
    // credential. Expected: one warning, naming the error's class and nothing of its message. Why:
    // a dead Redis fails every command, and a connection error's message can hold what must not be
    // logged.
    it('warns once per connection, by class only', async () => {
      class RedisDown extends Error {}
      const sub = subscriber()
      const failure = new RedisDown('connect ECONNREFUSED redis://user:secret@10.0.0.9:6379')
      sub.subscribe.mockRejectedValue(failure)
      sub.psubscribe.mockRejectedValue(failure)
      sub.punsubscribe.mockRejectedValue(failure)
      installed(sub)

      await Promise.allSettled([sub.subscribe('a'), sub.psubscribe('b'), sub.punsubscribe('c')])

      expect(warn).toHaveBeenCalledTimes(1)
      const text = String(warn.mock.calls[0]?.[0])
      expect(text).toContain('RedisDown')
      expect(text).not.toContain('secret')
      expect(text).not.toContain('10.0.0.9')
    })

    // Scenario: a rejection that is not an Error, on a second connection. Expected: its type is named.
    // Why: a handler must not assume what a command rejects with, and each connection reports its own.
    it('names the type of a rejection that is not an Error', async () => {
      const sub = subscriber()
      sub.unsubscribe.mockRejectedValue('plain text')
      installed(sub)

      await Promise.allSettled([sub.unsubscribe('a')])

      expect(String(warn.mock.calls[0]?.[0])).toContain('(String)')
    })

    // Scenario: a rejection with no prototype, which has no constructor to name. Expected: the
    // warning still comes, naming a plain Error, and nothing is left unhandled. Why: the handler is
    // what keeps a rejection from ending the process, so it must not throw on what it is handed.
    it('names a rejection that has no constructor, and leaves nothing unhandled', async () => {
      const sub = subscriber()
      sub.subscribe.mockRejectedValue(Object.create(null))
      installed(sub)
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)

      try {
        void sub.subscribe('a')
        await new Promise((resolve) => setImmediate(resolve))
      } finally {
        process.off('unhandledRejection', unhandled)
      }

      expect(String(warn.mock.calls[0]?.[0])).toContain('(Error)')
      expect(unhandled).not.toHaveBeenCalled()
    })

    // Scenario: a command that hands back no promise, as a mock can. Expected: it is called through
    // and its result returned. Why: the guard must not assume the shape of what it wraps.
    it('returns what a command returns when that is not a promise', () => {
      const sub = subscriber()
      sub.subscribe.mockReturnValue(7)
      installed(sub)

      expect(sub.subscribe('a')).toBe(7)
    })
  })
})
