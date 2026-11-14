/**
 * @fileoverview quitWithin: a QUIT waited for up to a bound, and a disconnect when it was not
 * answered, over a stand-in for the part of an ioredis client that closing uses.
 * @layer utils
 */
import { QUIT_WAIT_MS, quitWithin } from './quit-within'
import type { QuitableClient } from './quit-within'

/** A client whose QUIT is whatever `quit` does, and whose disconnects are counted. */
function client(quit: () => Promise<unknown>): QuitableClient & { disconnects: jest.Mock } {
  const disconnects = jest.fn()
  return { quit: jest.fn(quit), disconnect: disconnects, disconnects }
}

/** Resolves with whether `promise` had settled once every microtask queued so far has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(() => {
    done = true
  })
  await jest.advanceTimersByTimeAsync(0)
  return done
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('quitWithin', () => {
  // Scenario: the server answers the QUIT. Expected: it resolves, the connection is not
  // disconnected, and no timer is left. Why: an answered QUIT has closed the connection, and a
  // disconnect on it would arm ioredis's close timer on a socket that has no close left to clear it.
  it('resolves without disconnecting, and leaves no timer, when the QUIT is answered', async () => {
    const redis = client(async () => 'OK')

    await quitWithin(redis, 500)

    expect(redis.disconnects).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  // Scenario: the QUIT is never answered. Expected: pending one millisecond before the bound, and at
  // the bound it has settled and disconnected the connection, once. Why: that is the whole point of
  // the bound, and a connection left open would keep reconnecting.
  it('disconnects the connection at the bound, not before and not after, when the QUIT is never answered', async () => {
    const redis = client(() => new Promise<never>(() => undefined))

    const closing = quitWithin(redis, 500)
    await jest.advanceTimersByTimeAsync(499)
    expect(await settled(closing)).toBe(false)
    expect(redis.disconnects).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)

    expect(await settled(closing)).toBe(true)
    expect(redis.disconnects).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  // Scenario: no bound given. Expected: QUIT_WAIT_MS. Why: both callers rely on the default.
  it('waits QUIT_WAIT_MS when no bound is given', async () => {
    const redis = client(() => new Promise<never>(() => undefined))

    const closing = quitWithin(redis)
    await jest.advanceTimersByTimeAsync(QUIT_WAIT_MS - 1)
    expect(await settled(closing)).toBe(false)
    await jest.advanceTimersByTimeAsync(1)

    expect(await settled(closing)).toBe(true)
    expect(QUIT_WAIT_MS).toBe(2_000)
  })

  // Scenario: the QUIT is refused, as on a connection that is already closed. Expected: it
  // resolves, and disconnects. Why: that is the same outcome as a server that did not answer, and a
  // rejection here would fail a shutdown that has nothing left to wait for.
  it('resolves and disconnects when the QUIT is refused', async () => {
    const redis = client(() => Promise.reject(new Error('Connection is closed.')))

    await expect(quitWithin(redis, 500)).resolves.toBeUndefined()

    expect(redis.disconnects).toHaveBeenCalledTimes(1)
  })

  // Scenario: the QUIT is answered after the bound has passed. Expected: nothing more happens, and
  // no rejection is left unhandled. Why: the call has settled, and its late reply must not be
  // anyone's problem.
  it('ignores a QUIT answered after the bound', async () => {
    let answer: (value: unknown) => void = () => undefined
    const redis = client(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const closing = quitWithin(redis, 500)
    await jest.advanceTimersByTimeAsync(500)
    await closing

    answer('OK')
    await jest.advanceTimersByTimeAsync(0)

    expect(redis.disconnects).toHaveBeenCalledTimes(1)
  })

  // Scenario: the wait is running. Expected: its timer does not keep the process alive. Why: the
  // connection is what the process is closing, and a wait that held it open would be the hang this
  // bound exists to remove.
  it('does not keep the process alive while it waits', async () => {
    jest.useRealTimers()
    const timers = jest.spyOn(global, 'setTimeout')
    const redis = client(async () => 'OK')

    await quitWithin(redis, 500)

    const timer = timers.mock.results[0]?.value as NodeJS.Timeout
    expect(timer.hasRef()).toBe(false)
  })
})
