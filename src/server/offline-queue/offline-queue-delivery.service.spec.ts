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
  describe('retrieve', () => {
    // Returns empty array when no storage is configured.
    it('returns [] when no storage is injected', async () => {
      const service = new OfflineQueueDeliveryService(undefined)
      const result = await service.retrieve('u1', 'last-1', new Set())
      expect(result).toEqual([])
    })

    // Delivers events from the queue that are not already in the ring buffer.
    it('returns gap events not present in ringBufferIds', async () => {
      const events = [mkEvent('1'), mkEvent('2'), mkEvent('3')]
      const storage = mkStorage(events)
      const service = new OfflineQueueDeliveryService(storage)
      const result = await service.retrieve('u1', 'last-1', new Set(['2']))
      expect(result.map((e) => e.id)).toEqual(['1', '3'])
    })

    // Core at-least-once guarantee: retrieval MUST NOT acknowledge (prune) the queue,
    // so events that never reach the client remain durable for the next reconnect.
    it('does not acknowledge during retrieval', async () => {
      const events = [mkEvent('1'), mkEvent('2')]
      const storage = mkStorage(events)
      const service = new OfflineQueueDeliveryService(storage)
      await service.retrieve('u1', 'last-1', new Set())
      expect(storage.acknowledge).not.toHaveBeenCalled()
    })

    // A retrieveSince failure returns [] without crashing.
    it('swallows retrieveSince failures and returns []', async () => {
      const storage = mkStorage()
      ;(storage.retrieveSince as jest.Mock).mockRejectedValueOnce(new Error('redis down'))
      const service = new OfflineQueueDeliveryService(storage)
      const result = await service.retrieve('u1', 'last-1', new Set())
      expect(result).toEqual([])
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
        const result = await service.retrieve('u1', 'last-1', new Set())
        expect(result).toHaveLength(RETRIEVE_LIMIT)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('limit'))
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('acknowledge', () => {
    // acknowledge prunes the queue up to the last delivered event id.
    it('acknowledges the last delivered event', async () => {
      const storage = mkStorage()
      const service = new OfflineQueueDeliveryService(storage)
      await service.acknowledge('u1', [mkEvent('1'), mkEvent('2')])
      expect(storage.acknowledge).toHaveBeenCalledWith('u1', '2')
    })

    // acknowledge is a no-op when there are no events to confirm.
    it('does not acknowledge when the event list is empty', async () => {
      const storage = mkStorage()
      const service = new OfflineQueueDeliveryService(storage)
      await service.acknowledge('u1', [])
      expect(storage.acknowledge).not.toHaveBeenCalled()
    })

    // acknowledge is a no-op when no storage is configured.
    it('does nothing when no storage is injected', async () => {
      const service = new OfflineQueueDeliveryService(undefined)
      await expect(service.acknowledge('u1', [mkEvent('1')])).resolves.toBeUndefined()
    })

    // An acknowledge failure is swallowed so a transient storage error never throws.
    it('swallows acknowledge failures', async () => {
      const storage = mkStorage()
      ;(storage.acknowledge as jest.Mock).mockRejectedValueOnce(new Error('redis down'))
      const service = new OfflineQueueDeliveryService(storage)
      await expect(service.acknowledge('u1', [mkEvent('1')])).resolves.toBeUndefined()
    })
  })
})
