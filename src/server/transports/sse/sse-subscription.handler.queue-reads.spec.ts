/**
 * @fileoverview The two reads of a reconnect's offline-queue gap, in every combination of how the
 * first and the second can come out: what the client is answered, what is delivered, how many times
 * the store is called.
 * @layer transport
 */
import { InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  collect,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
} from '../../../../test/fixtures/sse/subscription-harness'
import type { OfflineQueuedEvent } from '../../interfaces/offline-queue-storage.interface'
import { OfflineQueueDeliveryService } from '../../offline-queue/offline-queue-delivery.service'
import { SseSubscriptionHandler } from './sse-subscription.handler'

type First = 'ok' | 'timeout' | 'cap' | 'store error'
type Second = 'ok' | 'timeout' | 'cap' | 'store error'
type Outcome =
  | { answer: '503' | '500'; reads: number }
  | { answer: 'served'; delivered: string[]; reads: number }

const at = (id: string): OfflineQueuedEvent => ({
  id,
  event: 'evt',
  data: {},
  emittedAt: new Date(),
})
const hangs = (): Promise<never> => new Promise(() => undefined)

/**
 * One reconnect, with its first and second read scripted. `cap` takes the only place for a read
 * with a call that never answers, before the first read for `First`, between the reads for `Second`.
 * Returns what the client was answered, and how many times the store was called for the reconnect.
 */
async function reconnect(first: First, second: Second): Promise<Outcome> {
  let calls = 0
  let occupying = 0
  const script: Array<() => Promise<OfflineQueuedEvent[]>> = [
    () =>
      first === 'ok'
        ? Promise.resolve([at('q-1')])
        : first === 'timeout'
          ? hangs()
          : Promise.reject(new Error('down')),
    () =>
      second === 'ok'
        ? Promise.resolve([at('q-2')])
        : second === 'timeout'
          ? hangs()
          : Promise.reject(new Error('down')),
  ]
  const options = mkOptions({ authenticateTimeoutMs: 1_000, maxPendingHandshakes: 1 })
  const service = new OfflineQueueDeliveryService(
    {
      retrieveSince: () => {
        calls += 1
        return occupying > 0 ? hangs() : (script.shift() ?? (() => Promise.resolve([])))()
      },
      acknowledge: async () => undefined,
      append: async () => undefined,
    },
    undefined,
    options,
  )
  /** Take the only place for a read, with a call that never answers. */
  const occupy = (): void => {
    occupying += 1
    service.retrieve('other', 'x', new Set()).catch(() => undefined)
    occupying -= 1
  }
  const transport = mkTransport({
    emitConnectionEvent: false,
    admit: () => ({ release: jest.fn(), renew: jest.fn() }),
  })
  const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), options, undefined, service)
  const req = mkReq({ headers: { 'last-event-id': 'q-0' } })
  const res = mkRes()

  if (first === 'cap') occupy()
  const occupants = first === 'cap' ? 1 : 0
  const guarded = handler.authenticateBeforeCommit(req, res).then(
    () => undefined,
    (error: unknown) => error,
  )
  await jest.advanceTimersByTimeAsync(first === 'timeout' ? 1_000 : 0)
  const refused = await guarded
  const reads = (): number =>
    calls - occupants - (second === 'cap' && refused === undefined ? 1 : 0)
  if (refused !== undefined)
    return {
      answer: refused instanceof ServiceUnavailableException ? '503' : '500',
      reads: reads(),
    }

  if (second === 'cap') occupy()
  const handled = handler.handle(req, res).then(
    (stream) => stream,
    (error: unknown) => error,
  )
  await jest.advanceTimersByTimeAsync(second === 'timeout' ? 1_000 : 0)
  const result = await handled
  if (result instanceof ServiceUnavailableException) return { answer: '503', reads: reads() }
  if (result instanceof InternalServerErrorException) return { answer: '500', reads: reads() }
  return {
    answer: 'served',
    delivered: collect(result as Parameters<typeof collect>[0]).map((e) => String(e.id)),
    reads: reads(),
  }
}

describe('SseSubscriptionHandler: the two reads of the offline-queue gap, case by case', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // The first read decides whether there is a second: a first read that timed out or was refused ends
  // the attempt with the 503, and one whose store failed serves the reconnect without a gap, as an
  // outage always has. Only a first read that succeeded is followed by a second, and its every
  // failure then ends the attempt before anything is delivered, so the client's cursor stays put.
  const CELLS: Array<[First, Second, Outcome]> = [
    ['ok', 'ok', { answer: 'served', delivered: ['q-1', 'q-2'], reads: 2 }],
    ['ok', 'timeout', { answer: '503', reads: 2 }],
    ['ok', 'cap', { answer: '503', reads: 1 }],
    ['ok', 'store error', { answer: '500', reads: 2 }],
    ['timeout', 'ok', { answer: '503', reads: 1 }],
    ['timeout', 'timeout', { answer: '503', reads: 1 }],
    ['timeout', 'cap', { answer: '503', reads: 1 }],
    ['timeout', 'store error', { answer: '503', reads: 1 }],
    ['cap', 'ok', { answer: '503', reads: 0 }],
    ['cap', 'timeout', { answer: '503', reads: 0 }],
    ['cap', 'cap', { answer: '503', reads: 0 }],
    ['cap', 'store error', { answer: '503', reads: 0 }],
    ['store error', 'ok', { answer: 'served', delivered: [], reads: 1 }],
    ['store error', 'timeout', { answer: 'served', delivered: [], reads: 1 }],
    ['store error', 'cap', { answer: 'served', delivered: [], reads: 1 }],
    ['store error', 'store error', { answer: 'served', delivered: [], reads: 1 }],
  ]

  it.each(CELLS)('first read %s, second read %s', async (first, second, expected) => {
    await expect(reconnect(first, second)).resolves.toEqual(expected)
  })
})
