/**
 * @fileoverview The read of the offline queue on a reconnect is bounded: a queue that does not
 * answer cannot keep the handshake open.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import type { ConnectionAuthContext } from '../interfaces/connection-authenticator.interface'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'
import {
  AuthenticationGate,
  AuthenticationUnavailableError,
} from '../services/authentication-gate.service'
import {
  OfflineQueueDeliveryService,
  OfflineQueueTimeoutError,
} from './offline-queue-delivery.service'

function storageThatAnswers(read: IOfflineQueueStorage['retrieveSince']): IOfflineQueueStorage {
  return { retrieveSince: jest.fn(read), acknowledge: jest.fn(), append: jest.fn() }
}

const neverAnswers = (): Promise<OfflineQueuedEvent[]> => new Promise(() => undefined)

function build(
  storage: IOfflineQueueStorage,
  authenticateTimeoutMs?: number,
  maxPendingHandshakes?: number,
) {
  return new OfflineQueueDeliveryService(storage, undefined, {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    ...(authenticateTimeoutMs === undefined ? {} : { authenticateTimeoutMs }),
    ...(maxPendingHandshakes === undefined ? {} : { maxPendingHandshakes }),
  })
}

describe('OfflineQueueDeliveryService: the read is bounded', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  /** Start a read and record whether it has settled, and how. */
  function read(service: OfflineQueueDeliveryService) {
    const outcome: { settled: boolean; error?: unknown } = { settled: false }
    const pending = service.retrieve('u1', 'e-1', new Set()).then(
      () => void (outcome.settled = true),
      (error: unknown) => {
        outcome.settled = true
        outcome.error = error
      },
    )
    return { outcome, pending }
  }

  it('gives up on a queue that never answers once authenticateTimeoutMs has passed', async () => {
    const { outcome, pending } = read(build(storageThatAnswers(neverAnswers), 2_000))

    await jest.advanceTimersByTimeAsync(1_999)
    expect(outcome.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await pending

    expect(outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
    expect(outcome.error).toHaveProperty('message', 'the offline queue did not answer in time')
  })

  it('waits ten seconds when authenticateTimeoutMs is not set', async () => {
    const { outcome, pending } = read(build(storageThatAnswers(neverAnswers)))

    await jest.advanceTimersByTimeAsync(9_999)
    expect(outcome.settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await pending

    expect(outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
  })

  it('ignores what the queue answers after it was given up on, and fails nothing', async () => {
    let answer: (events: OfflineQueuedEvent[]) => void = () => undefined
    const service = build(
      storageThatAnswers(() => new Promise<OfflineQueuedEvent[]>((resolve) => (answer = resolve))),
      1_000,
    )
    const { outcome, pending } = read(service)
    await jest.advanceTimersByTimeAsync(1_000)
    await pending

    answer([])
    await jest.advanceTimersByTimeAsync(0)

    expect(outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
  })

  it('answers what a queue that answers in time returns, and leaves no timer behind', async () => {
    const event: OfflineQueuedEvent = { id: '2', event: 'e', data: {}, emittedAt: new Date() }
    const service = build(
      storageThatAnswers(async () => [event]),
      1_000,
    )

    await expect(service.retrieve('u1', 'e-1', new Set())).resolves.toEqual([event])

    expect(jest.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind once it has given up', async () => {
    const { pending } = read(build(storageThatAnswers(neverAnswers), 1_000))
    await jest.advanceTimersByTimeAsync(1_000)
    await pending

    expect(jest.getTimerCount()).toBe(0)
  })

  // A queue that fails is still no reason to refuse the handshake: the client gets its live events.
  it('still answers an empty gap when the queue fails, rather than giving up', async () => {
    const service = build(
      storageThatAnswers(() => Promise.reject(new Error('down'))),
      1_000,
    )

    await expect(service.retrieve('u1', 'e-1', new Set())).resolves.toEqual([])
  })

  it('logs one line for each window, with the count of reads given up on', async () => {
    const service = build(storageThatAnswers(neverAnswers), 1_000)
    const reads = Array.from({ length: 5 }, () => read(service))
    await jest.advanceTimersByTimeAsync(1_000)
    await Promise.all(reads.map((r) => r.pending))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining('reconnects given up on since the last report: 1,'),
    )

    jest.advanceTimersByTime(8_999)
    const later = read(service)
    await jest.advanceTimersByTimeAsync(1_000)
    await later.pending
    expect(warn).toHaveBeenCalledTimes(1)
    const next = read(service)
    await jest.advanceTimersByTimeAsync(1_000)
    await next.pending

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining('reconnects given up on since the last report: 6,'),
    )
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('did not answer in 1000 ms'))
  })

  it('starts a new window exactly ten seconds after the line that opened the last one', async () => {
    const service = build(storageThatAnswers(neverAnswers), 1_000)
    const give = async (afterMs: number) => {
      await jest.advanceTimersByTimeAsync(afterMs)
      const started = read(service)
      await jest.advanceTimersByTimeAsync(1_000)
      await started.pending
    }
    await give(0)
    expect(warn).toHaveBeenCalledTimes(1)

    await give(8_000)
    expect(warn).toHaveBeenCalledTimes(1)
    await give(0)

    expect(warn).toHaveBeenCalledTimes(2)
  })

  // A call that was given up on still runs, so it keeps its place until it settles: a store that
  // never answers fills the limit, it does not collect one more abandoned call for each reconnect.
  describe('the reads waiting at once', () => {
    it('refuses a read at once, without calling the store, when the limit is taken by hung ones', async () => {
      const storage = storageThatAnswers(neverAnswers)
      const service = build(storage, 1_000, 2)
      const first = read(service)
      const second = read(service)

      const third = read(service)
      await jest.advanceTimersByTimeAsync(0)

      expect(third.outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
      expect(storage.retrieveSince).toHaveBeenCalledTimes(2)
      await jest.advanceTimersByTimeAsync(1_000)
      await Promise.all([first.pending, second.pending])
    })

    it('still refuses after the hung ones were given up on, because their calls have not settled', async () => {
      const storage = storageThatAnswers(neverAnswers)
      const service = build(storage, 1_000, 2)
      const waiting = [read(service), read(service)]
      await jest.advanceTimersByTimeAsync(1_000)
      await Promise.all(waiting.map((r) => r.pending))

      const later = read(service)
      await jest.advanceTimersByTimeAsync(0)

      expect(later.outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
      expect(storage.retrieveSince).toHaveBeenCalledTimes(2)
    })

    it('frees the place when the call settles, whenever that is', async () => {
      const answers: Array<(events: OfflineQueuedEvent[]) => void> = []
      const storage = storageThatAnswers(
        () => new Promise<OfflineQueuedEvent[]>((resolve) => answers.push(resolve)),
      )
      const service = build(storage, 1_000, 1)
      const given = read(service)
      await jest.advanceTimersByTimeAsync(1_000)
      await given.pending

      answers[0]?.([])
      await jest.advanceTimersByTimeAsync(0)
      const next = read(service)
      await jest.advanceTimersByTimeAsync(0)

      expect(storage.retrieveSince).toHaveBeenCalledTimes(2)
      expect(next.outcome.settled).toBe(false)
      answers[1]?.([])
      await next.pending
    })

    it('holds a thousand by default and refuses the next', async () => {
      const storage = storageThatAnswers(neverAnswers)
      const service = build(storage, 60_000)
      for (let i = 0; i < 1_000; i += 1) read(service)

      const over = read(service)
      await jest.advanceTimersByTimeAsync(0)

      expect(over.outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)
      expect(storage.retrieveSince).toHaveBeenCalledTimes(1_000)
    })

    it('keeps no place for a call that throws as it is made', async () => {
      const storage = storageThatAnswers(() => {
        throw new Error('broken')
      })
      const service = build(storage, 1_000, 1)

      for (let i = 0; i < 3; i += 1) {
        await expect(service.retrieve('u1', 'e-1', new Set())).resolves.toEqual([])
      }
    })
  })

  // The offline reads and the authentications share the limit's value, `maxPendingHandshakes`, and
  // each keeps its own count: a burst of reconnects against a hung queue must not starve the
  // authentication of everyone else, nor a hung authenticator the reads.
  describe('the count of reads is not the count of authentications', () => {
    const options = {
      transport: 'sse',
      authenticator: { authenticate: async () => null },
      maxPendingHandshakes: 2,
      authenticateTimeoutMs: 1_000,
    } as const
    const context: ConnectionAuthContext = {
      headers: {},
      query: {},
      cookies: {},
      ip: '127.0.0.1',
      userAgent: undefined,
      transport: 'sse',
    }

    it('still admits an authentication when the offline reads have filled their limit', async () => {
      const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
      const gate = new AuthenticationGate(options, { authenticate })
      const service = new OfflineQueueDeliveryService(
        storageThatAnswers(neverAnswers),
        undefined,
        options,
      )
      read(service)
      read(service)
      const refused = read(service)
      await jest.advanceTimersByTimeAsync(0)
      expect(refused.outcome.error).toBeInstanceOf(OfflineQueueTimeoutError)

      await expect(gate.authenticate(context)).resolves.toEqual({ userId: 'u1' })

      expect(authenticate).toHaveBeenCalledTimes(1)
    })

    it('still admits an offline read when the authentications have filled their limit', async () => {
      const gate = new AuthenticationGate(options, {
        authenticate: () => new Promise(() => undefined),
      })
      gate.authenticate(context).catch(() => undefined)
      gate.authenticate(context).catch(() => undefined)
      await expect(gate.authenticate(context)).rejects.toBeInstanceOf(
        AuthenticationUnavailableError,
      )
      const storage = storageThatAnswers(async () => [])
      const service = new OfflineQueueDeliveryService(storage, undefined, options)

      await expect(service.retrieve('u1', 'e-1', new Set())).resolves.toEqual([])

      expect(storage.retrieveSince).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1_000)
    })
  })
})
