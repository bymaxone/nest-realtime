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

/** What a scripted read does: answer with an event, never answer, or fail. */
function answerFor(how: First | Second, id: string): () => Promise<OfflineQueuedEvent[]> {
  if (how === 'ok') return () => Promise.resolve([at(id)])
  if (how === 'timeout') return hangs
  return () => Promise.reject(new Error('down'))
}

/**
 * A real service over a store that does what the scenario says on its first and second call, and
 * counts the calls. `occupy` takes the only place for a read with a call that never answers.
 */
function scriptedService(first: First, second: Second) {
  const state = { calls: 0, occupying: 0, occupants: 0 }
  const script = [answerFor(first, 'q-1'), answerFor(second, 'q-2')]
  const options = mkOptions({ authenticateTimeoutMs: 1_000, maxPendingHandshakes: 1 })
  const service = new OfflineQueueDeliveryService(
    {
      retrieveSince: () => {
        state.calls += 1
        return state.occupying > 0 ? hangs() : (script.shift() ?? (() => Promise.resolve([])))()
      },
      acknowledge: async () => undefined,
      append: async () => undefined,
    },
    undefined,
    options,
  )
  const occupy = (): void => {
    state.occupying += 1
    state.occupants += 1
    service.retrieve('other', 'x', new Set()).catch(() => undefined)
    state.occupying -= 1
  }
  return { service, options, occupy, reads: (): number => state.calls - state.occupants }
}

/** What the client was answered, from the error or the stream a request came to. */
function outcomeOf(result: unknown, reads: number): Outcome {
  if (result instanceof ServiceUnavailableException) return { answer: '503', reads }
  if (result instanceof InternalServerErrorException) return { answer: '500', reads }
  const stream = result as Parameters<typeof collect>[0]
  return { answer: 'served', delivered: collect(stream).map((e) => String(e.id)), reads }
}

/** The guard of a reconnect, run for as long as its first read takes; the error it refused with. */
async function runGuard(
  handler: SseSubscriptionHandler,
  req: ReturnType<typeof mkReq>,
  first: First,
) {
  const guarded = handler.authenticateBeforeCommit(req, mkRes()).then(
    () => undefined,
    (error: unknown) => error,
  )
  await jest.advanceTimersByTimeAsync(first === 'timeout' ? 1_000 : 0)
  return guarded
}

/** The route of a reconnect, run for as long as its second read takes; the stream or the error. */
async function runRoute(
  handler: SseSubscriptionHandler,
  req: ReturnType<typeof mkReq>,
  second: Second,
) {
  const handled = handler.handle(req, mkRes()).then(
    (stream) => stream,
    (error: unknown) => error,
  )
  await jest.advanceTimersByTimeAsync(second === 'timeout' ? 1_000 : 0)
  return handled
}

/**
 * One reconnect, with its first and second read scripted. `cap` takes the only place for a read
 * before the first read for `First`, and between the reads for `Second`. Returns what the client was
 * answered, and how many times the store was called for the reconnect.
 */
async function reconnect(first: First, second: Second): Promise<Outcome> {
  const { service, options, occupy, reads } = scriptedService(first, second)
  const transport = mkTransport({
    emitConnectionEvent: false,
    admit: () => ({ release: jest.fn(), renew: jest.fn() }),
  })
  const handler = new SseSubscriptionHandler(transport, mkHeartbeat(), options, undefined, service)
  const req = mkReq({ headers: { 'last-event-id': 'q-0' } })

  if (first === 'cap') occupy()
  const refused = await runGuard(handler, req, first)
  if (refused !== undefined) return outcomeOf(refused, reads())

  if (second === 'cap') occupy()
  return outcomeOf(await runRoute(handler, req, second), reads())
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
