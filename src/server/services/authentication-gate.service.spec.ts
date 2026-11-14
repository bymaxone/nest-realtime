/**
 * @fileoverview The gate every handshake goes through: bounded in time and in how many wait.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import type { ConnectionAuthContext } from '../interfaces/connection-authenticator.interface'
import { AuthenticationGate, AuthenticationUnavailableError } from './authentication-gate.service'

const context = {
  transport: 'sse',
  headers: { authorization: 'Bearer SECRET-TOKEN' },
  cookies: { session: 'SECRET-COOKIE' },
  query: {},
  ip: '203.0.113.9',
} as unknown as ConnectionAuthContext

type Call = {
  context: ConnectionAuthContext
  signal: AbortSignal
  settle: (value: unknown) => void
}

/** An authenticator whose calls stay open until the test settles them. */
function open(): {
  authenticator: { authenticate: jest.Mock }
  calls: Call[]
} {
  const calls: Call[] = []
  const authenticate = jest.fn(
    (ctx: ConnectionAuthContext, options: { signal: AbortSignal }) =>
      new Promise((resolve) => {
        calls.push({ context: ctx, signal: options.signal, settle: resolve })
      }),
  )
  return { authenticator: { authenticate }, calls }
}

const gateOf = (
  authenticator: { authenticate: jest.Mock },
  options: { authenticateTimeoutMs?: number; maxPendingHandshakes?: number } = {},
): AuthenticationGate => new AuthenticationGate(options as never, authenticator as never)

/** The error a call rejected with, or `undefined` if it did not reject. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('AuthenticationUnavailableError', () => {
  it('says why, and carries the reason, without anything of the request', () => {
    const saturated = new AuthenticationUnavailableError('saturated')
    const timedOut = new AuthenticationUnavailableError('timeout')

    expect(saturated.message).toBe('too many handshakes are waiting for the authenticator')
    expect(saturated.reason).toBe('saturated')
    expect(timedOut.message).toBe('the authenticator did not answer in time')
    expect(timedOut.reason).toBe('timeout')
  })
})

describe('AuthenticationGate', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('asks the authenticator, with a signal, and returns its answer', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })

    await expect(gateOf({ authenticate }).authenticate(context)).resolves.toStrictEqual({
      userId: 'u1',
    })

    expect(authenticate).toHaveBeenCalledWith(context, { signal: expect.any(AbortSignal) })
  })

  it('returns null when the authenticator rejects the credentials', async () => {
    const gate = gateOf({ authenticate: jest.fn().mockResolvedValue(null) })

    await expect(gate.authenticate(context)).resolves.toBeNull()
  })

  it('throws what the authenticator throws, as it is', async () => {
    const failure = new Error('database down')
    const gate = gateOf({ authenticate: jest.fn().mockRejectedValue(failure) })

    await expect(gate.authenticate(context)).rejects.toBe(failure)
  })

  describe('the time limit', () => {
    it('refuses a call that has not settled after 10,000 ms by default, and not before', async () => {
      const { authenticator } = open()
      const answer = rejection(gateOf(authenticator).authenticate(context))
      let settled = false
      void answer.then(() => (settled = true))

      await jest.advanceTimersByTimeAsync(9_999)
      expect(settled).toBe(false)
      await jest.advanceTimersByTimeAsync(1)

      expect(await answer).toBeInstanceOf(AuthenticationUnavailableError)
      expect(await answer).toMatchObject({ reason: 'timeout' })
    })

    it('uses authenticateTimeoutMs when it is set', async () => {
      const { authenticator } = open()
      const answer = rejection(
        gateOf(authenticator, { authenticateTimeoutMs: 250 }).authenticate(context),
      )

      await jest.advanceTimersByTimeAsync(250)

      expect(await answer).toMatchObject({ reason: 'timeout' })
    })

    it('aborts the signal when the time passes, and not before', async () => {
      const { authenticator, calls } = open()
      const answer = rejection(
        gateOf(authenticator, { authenticateTimeoutMs: 100 }).authenticate(context),
      )
      await jest.advanceTimersByTimeAsync(99)
      expect(calls[0]?.signal.aborted).toBe(false)

      await jest.advanceTimersByTimeAsync(1)
      await answer

      expect(calls[0]?.signal.aborted).toBe(true)
    })

    // The refusal is decided before the abort is dispatched, so a call that answers from its own
    // abort listener does not turn a timeout into a success.
    it('refuses a call that answers with credentials from its abort listener', async () => {
      const authenticate = jest.fn(
        (_ctx: unknown, options: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            options.signal.addEventListener('abort', () => resolve({ userId: 'u1' }))
          }),
      )
      const answer = rejection(
        gateOf({ authenticate }, { authenticateTimeoutMs: 100 }).authenticate(context),
      )

      await jest.advanceTimersByTimeAsync(100)

      expect(await answer).toMatchObject({ reason: 'timeout' })
    })

    it('does not refuse a call that settles in time, and clears its timer', async () => {
      const { authenticator, calls } = open()
      const answer = gateOf(authenticator).authenticate(context)
      await jest.advanceTimersByTimeAsync(0)

      calls[0]?.settle({ userId: 'u1' })

      await expect(answer).resolves.toStrictEqual({ userId: 'u1' })
      expect(jest.getTimerCount()).toBe(0)
    })

    it('ignores what a call that was given up on throws later', async () => {
      let fail!: (error: Error) => void
      const authenticate = jest.fn(() => new Promise((_resolve, reject) => (fail = reject)))
      const answer = rejection(
        gateOf({ authenticate }, { authenticateTimeoutMs: 100 }).authenticate(context),
      )
      await jest.advanceTimersByTimeAsync(100)
      await answer

      fail(new Error('late'))
      await jest.advanceTimersByTimeAsync(0)

      expect(jest.getTimerCount()).toBe(0)
    })
  })

  describe('the limit on pending handshakes', () => {
    // The slot belongs to the call, not to the wait: a backend that never answers is not given a new
    // call for every handshake while the abandoned ones stay open against it.
    it('refuses at once, without asking, once abandoned calls fill the limit, and admits again as they settle', async () => {
      const { authenticator, calls } = open()
      const gate = gateOf(authenticator, { authenticateTimeoutMs: 100, maxPendingHandshakes: 3 })
      const firstThree = [1, 2, 3].map(() => rejection(gate.authenticate(context)))
      await jest.advanceTimersByTimeAsync(100)
      for (const answer of firstThree) expect(await answer).toMatchObject({ reason: 'timeout' })
      expect(authenticator.authenticate).toHaveBeenCalledTimes(3)

      const refused = await rejection(gate.authenticate(context))

      expect(refused).toMatchObject({ reason: 'saturated' })
      expect(authenticator.authenticate).toHaveBeenCalledTimes(3)

      calls[0]?.settle(null)
      await jest.advanceTimersByTimeAsync(0)
      const admitted = gate.authenticate(context)
      await jest.advanceTimersByTimeAsync(0)
      expect(authenticator.authenticate).toHaveBeenCalledTimes(4)
      calls[3]?.settle(null)
      await expect(admitted).resolves.toBeNull()
    })

    it('frees the slot at once when the consumer stops its call on the signal', async () => {
      const authenticate = jest.fn(
        (_ctx: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('stopped')))
          }),
      )
      const gate = gateOf({ authenticate }, { authenticateTimeoutMs: 100, maxPendingHandshakes: 1 })
      const first = rejection(gate.authenticate(context))
      await jest.advanceTimersByTimeAsync(100)
      await first

      const second = rejection(gate.authenticate(context))
      await jest.advanceTimersByTimeAsync(100)

      expect(authenticate).toHaveBeenCalledTimes(2)
      expect(await second).toMatchObject({ reason: 'timeout' })
    })

    it('frees the slot when a call settles, throws or returns null', async () => {
      const authenticate = jest
        .fn()
        .mockResolvedValueOnce({ userId: 'u1' })
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ userId: 'u2' })
      const gate = gateOf({ authenticate }, { maxPendingHandshakes: 1 })

      await gate.authenticate(context)
      await rejection(gate.authenticate(context))
      await gate.authenticate(context)

      await expect(gate.authenticate(context)).resolves.toStrictEqual({ userId: 'u2' })
    })

    it('holds nothing per handshake after many have gone through', async () => {
      const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
      const gate = gateOf({ authenticate }, { maxPendingHandshakes: 5 })

      for (let i = 0; i < 1_000; i++) await gate.authenticate(context)

      expect((gate as unknown as { pending: number }).pending).toBe(0)
      expect(jest.getTimerCount()).toBe(0)
    })

    it('allows 1,000 pending handshakes by default', async () => {
      const { authenticator } = open()
      const gate = gateOf(authenticator)
      const waiting = Array.from({ length: 1_000 }, () => rejection(gate.authenticate(context)))

      const refused = await rejection(gate.authenticate(context))

      expect(refused).toMatchObject({ reason: 'saturated' })
      expect(authenticator.authenticate).toHaveBeenCalledTimes(1_000)
      await jest.advanceTimersByTimeAsync(10_000)
      await Promise.all(waiting)
    })
  })

  describe('the log', () => {
    it('logs one line for a window of refusals, with their count, and carries nothing of the request', async () => {
      const { authenticator } = open()
      const gate = gateOf(authenticator, { maxPendingHandshakes: 1 })
      void rejection(gate.authenticate(context))

      for (let i = 0; i < 50; i++) await rejection(gate.authenticate(context))

      expect(warn).toHaveBeenCalledTimes(1)
      const [line] = warn.mock.calls[0] as [string]
      expect(line).toBe(
        'handshakes refused since the last report: 1 because 1 were already waiting for the authenticator, 0 because it did not answer in 10000 ms',
      )
      for (const secret of ['SECRET-TOKEN', 'SECRET-COOKIE', '203.0.113.9']) {
        expect(line).not.toContain(secret)
      }
    })

    // The first refusal is reported at once; the next are counted and reported with the first one that
    // finds the window over, here the timeout of the call that filled the limit.
    it('reports the refusals of a window, saturated and timed out, when the next window opens', async () => {
      const { authenticator } = open()
      const gate = gateOf(authenticator, { maxPendingHandshakes: 1 })
      void rejection(gate.authenticate(context))
      for (let i = 0; i < 4; i++) await rejection(gate.authenticate(context))
      await jest.advanceTimersByTimeAsync(10_000)

      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn.mock.calls[1]).toStrictEqual([
        'handshakes refused since the last report: 3 because 1 were already waiting for the authenticator, 1 because it did not answer in 10000 ms',
      ])
    })

    it('counts the timeouts too', async () => {
      const { authenticator } = open()
      const gate = gateOf(authenticator, { authenticateTimeoutMs: 100, maxPendingHandshakes: 10 })
      const answer = rejection(gate.authenticate(context))

      await jest.advanceTimersByTimeAsync(100)
      await answer

      expect(warn).toHaveBeenCalledWith(
        'handshakes refused since the last report: 0 because 10 were already waiting for the authenticator, 1 because it did not answer in 100 ms',
      )
    })
  })
})
