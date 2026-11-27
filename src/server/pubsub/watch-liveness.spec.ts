/**
 * @fileoverview watchLiveness: what counts as an answer, and when a PING is sent or given up on.
 * @layer test
 */
import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { Worker } from 'node:worker_threads'
import type { Redis } from 'ioredis'
import { PROBE_DEADLINE_MS, PROBE_INTERVAL_MS, watchLiveness } from './watch-liveness'

/** A client double: `ping` returns what the test gives it, and its events are raised by hand. */
function client(ping: () => Promise<unknown>, options: { commandTimeout?: number } = {}) {
  const events = new EventEmitter()
  const double = Object.assign(events, { ping: jest.fn(ping), options })
  return {
    double,
    redis: double as unknown as Redis,
    ready: (): boolean => events.emit('ready'),
    close: (): boolean => events.emit('close'),
  }
}

/** A watch on a client that has just become ready. */
function watching(ping: () => Promise<unknown>) {
  const made = client(ping)
  const silent = jest.fn()
  const stop = watchLiveness(made.redis, silent)
  made.ready()
  return { ...made, silent, stop }
}

const never = (): Promise<never> => new Promise<never>(() => undefined)
const errorNamed = (name: string): Error => Object.assign(new Error('x'), { name })

/** Past the deadline, and past the turn of I/O that follows it. */
async function expireDeadline(): Promise<void> {
  await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS + 1)
}

describe('watchLiveness', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  // Scenario: the server never answers. Expected: one silence, at the deadline and not before.
  it('reports silence at the deadline', async () => {
    const { double, silent } = watching(never)

    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS - 1)
    expect(double.ping).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    await jest.advanceTimersByTimeAsync(PROBE_DEADLINE_MS - 1)
    expect(silent).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(2)

    expect(silent).toHaveBeenCalledTimes(1)
  })

  // Scenario: the server answers, with a reply or an error reply. Expected: no silence, and the
  // next interval asks again.
  it.each([
    ['a reply', () => Promise.resolve('PONG')],
    ['an error reply', () => Promise.reject(errorNamed('ReplyError'))],
  ])('takes %s as an answer', async (_label, ping) => {
    const { double, silent } = watching(ping)

    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2)
    await expireDeadline()

    expect(silent).not.toHaveBeenCalled()
    expect(double.ping).toHaveBeenCalledTimes(2)
  })

  // Scenario: the client gives up on the PING itself (its retries ran out). Expected: silence, without
  // waiting for the deadline.
  it("counts the client's own rejection as silence", async () => {
    const { silent } = watching(() => Promise.reject(errorNamed('Error')))

    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS + 1)

    expect(silent).toHaveBeenCalledTimes(1)
  })

  // Scenario: the client has a commandTimeout. Expected: lifted while ready, even over a repeated
  // ready, and back for the next handshake.
  it("lifts the client's commandTimeout from ready to close", () => {
    const { double, redis, ready, close } = client(never, { commandTimeout: 300 })
    watchLiveness(redis, jest.fn())
    expect(double.options.commandTimeout).toBe(300)

    ready()
    ready()
    expect(double.options).not.toHaveProperty('commandTimeout')
    close()

    expect(double.options.commandTimeout).toBe(300)
  })

  // Scenario: the client has no commandTimeout. Expected: none appears.
  it('adds no commandTimeout to a client without one', () => {
    const { double, ready, close } = watching(never)

    close()
    ready()

    expect(double.options).not.toHaveProperty('commandTimeout')
  })

  // Scenario: the client has not become ready. Expected: no timer at all.
  it('does nothing before ready', () => {
    watchLiveness(client(never).redis, jest.fn())

    expect(jest.getTimerCount()).toBe(0)
  })

  // Scenario: the connection closes with a PING in flight, then another becomes ready. Expected: no
  // timer while closed, that PING forgotten, and the next connection asked afresh, once per interval.
  it('stops while closed and starts afresh on the next ready', async () => {
    const { double, silent, ready, close } = watching(never)
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

    close()
    expect(jest.getTimerCount()).toBe(0)
    ready()
    ready()

    expect(jest.getTimerCount()).toBe(1)
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    expect(double.ping).toHaveBeenCalledTimes(2)
    expect(silent).not.toHaveBeenCalled()
  })

  // Scenario: the watch is stopped with a PING in flight. Expected: no timer left, nothing reported,
  // and a later ready starts nothing.
  it('leaves no timer behind when stopped', async () => {
    const { silent, stop, ready } = watching(never)
    await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)

    stop()
    ready()

    expect(jest.getTimerCount()).toBe(0)
    await expireDeadline()
    expect(silent).not.toHaveBeenCalled()
  })
})

describe('watchLiveness: timers and a stalled event loop', () => {
  const cleanups: Array<() => unknown> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  /** Replaces setInterval, so the test runs the probe itself. */
  function manualTick(unref: () => void = () => undefined): () => void {
    let tick: () => void = () => undefined
    jest.spyOn(global, 'setInterval').mockImplementation(((probe: () => void) => {
      tick = probe
      return { unref }
    }) as unknown as typeof setInterval)
    return () => tick()
  }

  // Scenario: the interval comes due again with a PING still unanswered, as after a stall.
  // Expected: no second PING.
  it('keeps one PING in flight', () => {
    const tick = manualTick()
    const { double, stop } = watching(never)
    cleanups.push(stop)

    tick()
    tick()

    expect(double.ping).toHaveBeenCalledTimes(1)
  })

  // Scenario: a watch is running. Expected: neither of its timers keeps the process alive.
  it('unrefs both timers', () => {
    const unref = jest.fn()
    const tick = manualTick(unref)
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => ({ unref })) as unknown as typeof setTimeout)
    watching(never)

    tick()

    expect(unref).toHaveBeenCalledTimes(2)
  })

  // Scenario: the reply arrives, over a real socket, while the event loop is blocked past the
  // deadline. Expected: no silence.
  it('reads a reply that arrived during a stall before giving up', async () => {
    // The server runs in a worker, so it answers while this thread is blocked.
    const server = new Worker(
      `const { parentPort } = require('node:worker_threads')
       const server = require('node:net').createServer((s) => s.on('data', () => s.write('PONG')))
       server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port))`,
      { eval: true },
    )
    cleanups.push(() => server.terminate())
    const port = await new Promise<number>((resolve) => server.once('message', resolve))
    const socket: Socket = connect(port, '127.0.0.1')
    cleanups.push(() => socket.destroy())
    await new Promise((resolve) => socket.once('connect', resolve))
    const tick = manualTick()
    const { silent, stop } = watching(
      () =>
        new Promise((resolve) => {
          socket.once('data', resolve)
          socket.write('PING')
        }),
    )
    cleanups.push(stop)

    tick()
    const until = Date.now() + PROBE_DEADLINE_MS + 200
    while (Date.now() < until) {
      // Blocks the loop, as a long synchronous task would.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(silent).not.toHaveBeenCalled()
  }, 15_000)
})
