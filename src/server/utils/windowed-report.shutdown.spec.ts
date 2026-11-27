/**
 * @fileoverview Every windowed report of the server side writes what is waiting at shutdown.
 * @layer utils
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { OfflineQueueDeliveryService } from '../offline-queue/offline-queue-delivery.service'
import { RealtimePubSubSubscriber } from '../pubsub/realtime-pubsub-subscriber'
import { AuthenticationGate } from '../services/authentication-gate.service'
import { ConnectionAdmission } from '../services/connection-admission.service'

let warn: jest.SpyInstance

beforeEach(() => {
  jest.useFakeTimers()
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.useRealTimers()
  warn.mockRestore()
})

/** The `count`, or the refusal counts, of each line written under `event`. */
function lines(event: string): Record<string, unknown>[] {
  return warn.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((line) => line['event'] === event)
}

describe('a burst cut short by shutdown', () => {
  // Scenario: three handshakes refused at the connection limit inside one window, then the
  // application closes. Expected: the two folded ones are written at shutdown.
  it('writes the refused connections', () => {
    const admission = new ConnectionAdmission(
      { maxConnections: 1 } as never,
      {
        count: () => 1,
      } as never,
    )
    for (let i = 0; i < 3; i++) expect(() => admission.admit()).toThrow()

    admission.onApplicationShutdown()

    expect(lines('REALTIME_CONNECTIONS_REFUSED').map((line) => line['count'])).toEqual([1, 2])
  })

  // Scenario: the same for handshakes the authentication gate refuses.
  it('writes the refused handshakes', async () => {
    const gate = new AuthenticationGate({ maxPendingHandshakes: 0 } as never, {} as never)
    for (let i = 0; i < 3; i++) await expect(gate.authenticate({} as never)).rejects.toThrow()

    gate.onApplicationShutdown()

    expect(lines('REALTIME_HANDSHAKES_REFUSED').map((line) => line['saturated'])).toEqual([1, 2])
  })

  // Scenario: the same for reconnects given up on because the offline queue is saturated.
  it('writes the reconnects given up on', async () => {
    const delivery = new OfflineQueueDeliveryService({} as never, undefined, {
      maxPendingHandshakes: 0,
    } as never)
    for (let i = 0; i < 3; i++) await expect(delivery.retrieveGap('u', '1')).rejects.toThrow()

    delivery.onApplicationShutdown()

    expect(lines('REALTIME_RECONNECTS_GIVEN_UP').map((line) => line['count'])).toEqual([1, 2])
  })

  // Scenario: the same for bus messages this instance could not act on.
  it('writes the dropped bus messages', async () => {
    let receive: (msg: unknown) => void = () => undefined
    const subscriber = new RealtimePubSubSubscriber(
      {
        subscribe: async (handler: (msg: unknown) => void) => {
          receive = handler
          return async () => undefined
        },
      } as never,
      'here',
      {} as never,
    )
    await subscriber.onModuleInit()
    for (let i = 0; i < 3; i++) receive({ origin: 'there', op: 'nonsense', args: {} })

    await subscriber.onApplicationShutdown()

    expect(lines('REALTIME_PUBSUB_DROPPED').map((line) => line['count'])).toEqual([1, 2])
  })
})
