/**
 * @fileoverview What was appended to the offline queue since a reconnect's first read: where the
 * read starts, how much it may return, and that every failure is thrown.
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

const RETRIEVE_LIMIT = 200

function event(id: string): OfflineQueuedEvent {
  return { id, event: 'evt', data: {}, emittedAt: new Date() }
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

describe('OfflineQueueDeliveryService.retrieveAppended', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('reads after the last event the earlier read returned, and returns what the store has', async () => {
    const store = storage(async () => [event('e-4'), event('e-5')])
    const service = build(store)

    const appended = await service.retrieveAppended('u1', 'e-0', [event('e-1'), event('e-3')])

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', 'e-3', RETRIEVE_LIMIT - 2)
    expect(appended.map((e) => e.id)).toEqual(['e-4', 'e-5'])
  })

  it('reads after Last-Event-ID when the earlier read returned nothing', async () => {
    const store = storage(async () => [])
    const service = build(store)

    await service.retrieveAppended('u1', 'e-0', [])

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', 'e-0', RETRIEVE_LIMIT)
  })

  // One reconnect never carries more than the limit: when the earlier read reached it, the older
  // events beyond it are dropped as before, and there is nothing to read.
  it('makes no read once the earlier read reached the limit', async () => {
    const store = storage(async () => [event('x')])
    const read = Array.from({ length: RETRIEVE_LIMIT }, (_, i) => event(`e-${i}`))

    await expect(build(store).retrieveAppended('u1', 'e-0', read)).resolves.toEqual([])

    expect(store.retrieveSince).not.toHaveBeenCalled()
  })

  it('reads up to what is left of the limit', async () => {
    const store = storage(async () => [])
    const read = Array.from({ length: RETRIEVE_LIMIT - 1 }, (_, i) => event(`e-${i}`))

    await build(store).retrieveAppended('u1', 'e-0', read)

    expect(store.retrieveSince).toHaveBeenCalledWith('u1', `e-${RETRIEVE_LIMIT - 2}`, 1)
  })

  it('returns nothing, and calls nothing, when no queue is configured', async () => {
    const service = new OfflineQueueDeliveryService(undefined)

    await expect(service.retrieveAppended('u1', 'e-0', [])).resolves.toEqual([])
  })

  // A store that fails is reported and answers no extra events, as the first read's error answers an
  // empty gap: the reconnect is served, and an outage does not become a refusal of every reconnect.
  it('reports the store’s error and returns nothing rather than failing the reconnect', async () => {
    const error = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const store = storage(() => Promise.reject(new Error('down')))

    await expect(build(store).retrieveAppended('u1', 'e-0', [])).resolves.toEqual([])

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Offline queue retrieve failed: down'),
    )
    error.mockRestore()
  })

  it('returns nothing when the store throws as it is called, and takes no place for it', async () => {
    const error = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const store = storage(() => {
      throw new Error('broken')
    })
    const service = build(store, 1)

    for (let i = 0; i < 3; i += 1) {
      await expect(service.retrieveAppended('u1', 'e-0', [])).resolves.toEqual([])
    }
    error.mockRestore()
  })

  it('gives up on a store that does not answer, at the same deadline as the first read', async () => {
    const store = storage(() => new Promise(() => undefined))
    const outcome = build(store)
      .retrieveAppended('u1', 'e-0', [])
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
    const waiting = service.retrieveAppended('u1', 'e-0', []).catch((e: unknown) => e)

    await expect(service.retrieveAppended('u1', 'e-0', [])).rejects.toBeInstanceOf(
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
