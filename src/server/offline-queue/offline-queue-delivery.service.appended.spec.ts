/**
 * @fileoverview The second read of a reconnect's gap: what was appended to the offline queue since
 * the first. Where it starts, how much it may return, when it is not made at all, and that every
 * failure of it is thrown.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'
import {
  OfflineQueueDeliveryService,
  OfflineQueueTimeoutError,
} from './offline-queue-delivery.service'
import type { OfflineQueueRead } from './offline-queue-delivery.service'

const RETRIEVE_LIMIT = 200

function event(id: string): OfflineQueuedEvent {
  return { id, event: 'evt', data: {}, emittedAt: new Date() }
}

/** The first read's answer when the store answered. */
function answered(...events: OfflineQueuedEvent[]): OfflineQueueRead {
  return { events, degraded: false }
}

function storage(read: IOfflineQueueStorage['retrieveSince']): IOfflineQueueStorage {
  return { retrieveSince: jest.fn(read), acknowledge: jest.fn(), append: jest.fn() }
}

function build(store: IOfflineQueueStorage, maxPendingHandshakes?: number) {
  return new OfflineQueueDeliveryService(store, undefined, {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    authenticateTimeoutMs: 1_000,
    ...(maxPendingHandshakes === undefined ? {} : { maxPendingHandshakes }),
  })
}

describe('OfflineQueueDeliveryService.retrieveGap', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('answers the events, not degraded, when the store answers', async () => {
    const store = storage(async () => [event('e-1')])

    const gap = await build(store).retrieveGap('u1', 'e-0')

    expect(gap.degraded).toBe(false)
    expect(gap.events.map((e) => e.id)).toEqual(['e-1'])
  })

  // The marker the second read acts on: a store that failed is reported and served as an empty gap.
  it('reports a store that fails and answers an empty gap marked as degraded', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const store = storage(() => Promise.reject(new Error('down')))

    await expect(build(store).retrieveGap('u1', 'e-0')).resolves.toEqual({
      events: [],
      degraded: true,
    })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Offline queue retrieve failed: down'),
    )
    warn.mockRestore()
  })

  // The count and the log line of reads given up on are for the reads that timed out or were refused,
  // not for a store that answered with an error.
  it('does not count a store that fails as a read given up on', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const store = storage(() => Promise.reject(new Error('down')))

    await build(store).retrieveGap('u1', 'e-0')

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('given up on'))
    warn.mockRestore()
  })

  it('takes no place, and answers degraded, for a store that throws as it is called', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const store = storage(() => {
      throw new Error('broken')
    })
    const service = build(store, 1)

    for (let i = 0; i < 3; i += 1) {
      await expect(service.retrieveGap('u1', 'e-0')).resolves.toEqual({
        events: [],
        degraded: true,
      })
    }
  })

  it('answers an empty gap that is not degraded when no queue is configured', async () => {
    await expect(
      new OfflineQueueDeliveryService(undefined).retrieveGap('u1', 'e-0'),
    ).resolves.toEqual({ events: [], degraded: false })
  })

  it('throws, rather than degrading, for a store that does not answer in time', async () => {
    const outcome = build(storage(() => new Promise(() => undefined)))
      .retrieveGap('u1', 'e-0')
      .catch((e: unknown) => e)

    await jest.advanceTimersByTimeAsync(1_000)

    expect(await outcome).toBeInstanceOf(OfflineQueueTimeoutError)
  })
})

describe('OfflineQueueDeliveryService.retrieveAppended', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reads after the last event the first read returned, and returns what the store has', async () => {
    const store = storage(async () => [event('e-4'), event('e-5')])
    const service = build(store)

    const appended = await service.retrieveAppended(
      'u1',
      'e-0',
      answered(event('e-1'), event('e-3')),
    )

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', 'e-3', RETRIEVE_LIMIT - 2)
    expect(appended.map((e) => e.id)).toEqual(['e-4', 'e-5'])
  })

  it('reads after Last-Event-ID when the first read returned nothing', async () => {
    const store = storage(async () => [])

    await build(store).retrieveAppended('u1', 'e-0', answered())

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', 'e-0', RETRIEVE_LIMIT)
  })

  // One reconnect never carries more than the limit: when the first read reached it, the older events
  // beyond it are dropped, and there is nothing to read.
  it('makes no read once the first read reached the limit', async () => {
    const store = storage(async () => [event('x')])
    const read = answered(...Array.from({ length: RETRIEVE_LIMIT }, (_, i) => event(`e-${i}`)))

    await expect(build(store).retrieveAppended('u1', 'e-0', read)).resolves.toEqual([])

    expect(store.retrieveSince).not.toHaveBeenCalled()
  })

  it('reads up to what is left of the limit', async () => {
    const store = storage(async () => [])
    const read = answered(...Array.from({ length: RETRIEVE_LIMIT - 1 }, (_, i) => event(`e-${i}`)))

    await build(store).retrieveAppended('u1', 'e-0', read)

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', `e-${RETRIEVE_LIMIT - 2}`, 1)
  })

  it('returns nothing, and calls nothing, when no queue is configured', async () => {
    const service = new OfflineQueueDeliveryService(undefined)

    await expect(service.retrieveAppended('u1', 'e-0', answered())).resolves.toEqual([])
  })

  // The store is down and the reconnect is served without the gap: asking it again would turn
  // an outage into a second failure for every reconnect.
  it('makes no read when the first read degraded', async () => {
    const store = storage(async () => [event('x')])

    await expect(
      build(store).retrieveAppended('u1', 'e-0', { events: [], degraded: true }),
    ).resolves.toEqual([])

    expect(store.retrieveSince).not.toHaveBeenCalled()
  })

  // After a first read that succeeded, a stream built without these events moves the client's cursor
  // past them with the next event it receives: the store's own error ends the attempt, it is not read
  // as an empty answer.
  it('throws the store’s own error rather than answering no events', async () => {
    const store = storage(() => Promise.reject(new Error('down')))

    await expect(build(store).retrieveAppended('u1', 'e-0', answered())).rejects.toThrow('down')
  })

  it('throws when the store throws as it is called, and takes no place for it', async () => {
    const store = storage(() => {
      throw new Error('broken')
    })
    const service = build(store, 1)

    for (let i = 0; i < 3; i += 1) {
      await expect(service.retrieveAppended('u1', 'e-0', answered())).rejects.toThrow('broken')
    }
  })

  it('gives up on a store that does not answer, at the same deadline as the first read', async () => {
    const store = storage(() => new Promise(() => undefined))
    const outcome = build(store)
      .retrieveAppended('u1', 'e-0', answered())
      .catch((e: unknown) => e)

    await jest.advanceTimersByTimeAsync(999)
    expect(jest.getTimerCount()).toBe(1)
    await jest.advanceTimersByTimeAsync(1)

    expect(await outcome).toBeInstanceOf(OfflineQueueTimeoutError)
  })

  // The second read shares the first read's count of reads waiting: a hung store fills it, and the
  // next read of either kind is refused at once without calling the store.
  it('is refused at once, without calling the store, when the reads waiting are all taken', async () => {
    const store = storage(() => new Promise(() => undefined))
    const service = build(store, 1)
    const waiting = service.retrieveAppended('u1', 'e-0', answered()).catch((e: unknown) => e)

    await expect(service.retrieveAppended('u1', 'e-0', answered())).rejects.toBeInstanceOf(
      OfflineQueueTimeoutError,
    )
    await expect(service.retrieve('u1', 'e-0', new Set())).rejects.toBeInstanceOf(
      OfflineQueueTimeoutError,
    )

    expect(store.retrieveSince).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1_000)
    await waiting
  })
})
