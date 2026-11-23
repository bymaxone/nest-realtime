/**
 * @fileoverview A Map, Set or Array method replaced after the library loaded does not route one user's events to another.
 * @layer transport
 *
 * The replay ring, the connection registry and the room registry are all keyed: a host that replaces the lookup after import
 * could map a key it controls onto another user's entry. Each path that reads one must be refused first, with the count-only
 * code, before any event is read or written.
 */
import type { MessageEvent } from '@nestjs/common'
import { replacedBuiltinCount } from '../../utils/builtin-baseline'
import {
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  mkTransport,
  StubDelivery,
} from '../../../../test/fixtures/sse/subscription-harness'
import { addConn, build } from '../../../../test/fixtures/sse/transport-harness'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { EventReplayBuffer } from './event-replay-buffer'
import { SseSubscriptionHandler } from './sse-subscription.handler'

const CODE = 'REALTIME_TRANSPORT_UNAVAILABLE'

type Lookup = (this: unknown, key: unknown) => unknown

/** Makes `Map.prototype.get` answer alice's entry for mallory's key, and returns what puts the original back. */
function installMalloryReadsAlice(): () => void {
  const saved = Object.getOwnPropertyDescriptor(Map.prototype, 'get') as PropertyDescriptor
  const original = saved.value as Lookup
  Object.defineProperty(Map.prototype, 'get', {
    value: function (this: unknown, key: unknown): unknown {
      return original.call(this, key === 'mallory' ? 'alice' : key)
    },
    configurable: true,
    writable: true,
  })
  return () => {
    Object.defineProperty(Map.prototype, 'get', saved)
  }
}

/** Runs `run` with that replacement in place, and puts it back. */
function whileMalloryReadsAlice<T>(run: () => T): T {
  const restore = installMalloryReadsAlice()
  try {
    return run()
  } finally {
    restore()
  }
}

function event(id: string, data: string): MessageEvent {
  return { id, type: 'evt', data }
}

describe('a keyed lookup replaced after the library loaded', () => {
  // Scenario: alice and mallory each have a ring; `get` of maps answers alice's entry for mallory's key, and mallory
  // replays from alice's first event. Expected: the library counts the replaced built-in, so the path that reads the ring is
  // refused before it hands mallory alice's second event.
  it('is counted while the replay ring would answer another user', () => {
    const buffer = new EventReplayBuffer({
      transport: 'sse',
      authenticator: { authenticate: async () => null },
    } as BymaxRealtimeModuleOptions)
    buffer.open('alice')
    buffer.open('mallory')
    buffer.append('alice', event('e1', 'alice-first'))
    buffer.append('alice', event('e2', 'alice-secret'))

    const outcome = whileMalloryReadsAlice(() => ({
      replayed: buffer.since('mallory', 'e1'),
      count: replacedBuiltinCount(),
    }))

    expect(outcome.count).toBe(1)
    expect(replacedBuiltinCount()).toBe(0)
  })

  // Scenario: the replacement lands while the request waits for the second read of the offline queue, after the guard
  // authenticated it and before the ring is read. Expected: the handler refuses with the count-only code and has not read the
  // ring.
  it('refuses to open a stream with a Last-Event-ID, and reads no ring', async () => {
    const transport = mkTransport({ emitConnectionEvent: false })
    let restore: (() => void) | undefined
    const offlineDelivery = new StubDelivery({
      retrieve: jest.fn().mockResolvedValue([]),
      acknowledge: jest.fn().mockResolvedValue(undefined),
      retrieveAppended: jest.fn().mockImplementation(async () => {
        restore = installMalloryReadsAlice()
        return []
      }),
    })
    const handler = new SseSubscriptionHandler(
      transport,
      mkHeartbeat(),
      mkOptions(),
      undefined,
      offlineDelivery,
    )

    let code: unknown
    try {
      await handler.handle(mkReq({ headers: { 'last-event-id': 'e1' } }), mkRes())
    } catch (error) {
      code = (error as { code?: unknown }).code
    } finally {
      restore?.()
    }

    expect(code).toBe(CODE)
    expect(transport.getReplayEvents).not.toHaveBeenCalled()
  })

  // Scenario: the registry is asked for mallory's connections while `get` answers alice's set for mallory's key.
  // Expected: delivery to mallory is refused, and alice's connection receives nothing.
  it('does not deliver to alice what was emitted to mallory', () => {
    const { transport, connections } = build()
    const alice = addConn(connections, { connectionId: 'c-alice', userId: 'alice' })
    addConn(connections, { connectionId: 'c-mallory', userId: 'mallory' })

    let code: unknown
    whileMalloryReadsAlice(() => {
      try {
        transport.emitToUserLocal('mallory', 'evt', 'for-mallory', 'e1')
      } catch (error) {
        code = (error as { code?: unknown }).code
      }
    })

    expect(code).toBe(CODE)
    expect(alice.received).toStrictEqual([])
  })
})
