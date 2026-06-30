/**
 * @fileoverview Unit tests for OfflineQueueDeliveryService.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../interfaces/offline-queue-storage.interface'
import { OfflineQueueDeliveryService } from './offline-queue-delivery.service'

/** Must match the module-private RETRIEVE_LIMIT constant. */
const RETRIEVE_LIMIT = 200

function mkEvent(id: string): OfflineQueuedEvent {
  return { id, event: 'foo', data: { id }, emittedAt: new Date() }
}

function mkStorage(events: OfflineQueuedEvent[] = []): IOfflineQueueStorage {
  return {
    retrieveSince: jest.fn().mockResolvedValue(events),
    acknowledge: jest.fn().mockResolvedValue(undefined),
    append: jest.fn().mockResolvedValue(undefined),
  }
}

describe('OfflineQueueDeliveryService', () => {
  // Returns empty array when no storage is configured.
  it('returns [] when no storage is injected', async () => {
    const service = new OfflineQueueDeliveryService(undefined)
    const result = await service.deliver('u1', 'last-1', new Set())
    expect(result).toEqual([])
  })

  // Delivers events from the queue that are not already in the ring buffer.
  it('returns gap events not present in ringBufferIds', async () => {
    const events = [mkEvent('1'), mkEvent('2'), mkEvent('3')]
    const storage = mkStorage(events)
    const service = new OfflineQueueDeliveryService(storage)
    const result = await service.deliver('u1', 'last-1', new Set(['2']))
    expect(result.map((e) => e.id)).toEqual(['1', '3'])
  })

  // acknowledge is called with the last delivered event id.
  it('acknowledges the last delivered event', async () => {
    const events = [mkEvent('1'), mkEvent('2')]
    const storage = mkStorage(events)
    const service = new OfflineQueueDeliveryService(storage)
    await service.deliver('u1', 'last-1', new Set())
    expect(storage.acknowledge).toHaveBeenCalledWith('u1', '2')
  })

  // acknowledge is not called when there are no gap events.
  it('does not acknowledge when all events are in the ring buffer', async () => {
    const events = [mkEvent('1')]
    const storage = mkStorage(events)
    const service = new OfflineQueueDeliveryService(storage)
    await service.deliver('u1', 'last-1', new Set(['1']))
    expect(storage.acknowledge).not.toHaveBeenCalled()
  })

  // A retrieveSince failure returns [] without crashing.
  it('swallows retrieveSince failures and returns []', async () => {
    const storage = mkStorage()
    ;(storage.retrieveSince as jest.Mock).mockRejectedValueOnce(new Error('redis down'))
    const service = new OfflineQueueDeliveryService(storage)
    const result = await service.deliver('u1', 'last-1', new Set())
    expect(result).toEqual([])
  })

  // An acknowledge failure is swallowed so the caller still receives the events.
  it('swallows acknowledge failures and still returns the gap events', async () => {
    const events = [mkEvent('1')]
    const storage = mkStorage(events)
    ;(storage.acknowledge as jest.Mock).mockRejectedValueOnce(new Error('redis down'))
    const service = new OfflineQueueDeliveryService(storage)
    const result = await service.deliver('u1', 'last-1', new Set())
    expect(result).toHaveLength(1)
  })

  // When retrieveSince returns exactly RETRIEVE_LIMIT events, a warn is logged.
  it('warns when retrieveSince returns exactly the retrieve limit', async () => {
    // Covers: the `=== RETRIEVE_LIMIT` branch that warns about a potential event gap.
    const events = Array.from<unknown, OfflineQueuedEvent>({ length: RETRIEVE_LIMIT }, (_, i) =>
      mkEvent(String(i + 1)),
    )
    const storage = mkStorage(events)
    const service = new OfflineQueueDeliveryService(storage)
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const result = await service.deliver('u1', 'last-1', new Set())
      expect(result).toHaveLength(RETRIEVE_LIMIT)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('limit'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})
