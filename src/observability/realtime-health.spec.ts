/**
 * @fileoverview The pub/sub health indicator answers from the bus's own state and sends nothing.
 * @layer observability
 */
import { BYMAX_HEALTH_INDICATOR_METADATA } from '@bymax-one/nest-core/health'
import { InMemoryPubSub } from '../server/pubsub/in-memory-pubsub'
import type { IRealtimePubSub } from '../server/interfaces/realtime-pubsub.interface'
import { RealtimePubSubHealthIndicator } from './realtime-health'

function bus(isSubscribed?: () => boolean): IRealtimePubSub & { publish: jest.Mock } {
  return {
    publish: jest.fn(),
    subscribe: jest.fn(),
    ...(isSubscribed ? { isSubscribed } : {}),
  } as unknown as IRealtimePubSub & { publish: jest.Mock }
}

describe('RealtimePubSubHealthIndicator', () => {
  // Scenario: nest-core discovers it. Expected: the marker and a stable name.
  it('is marked as a health indicator and named', () => {
    expect(
      Reflect.getMetadata(BYMAX_HEALTH_INDICATOR_METADATA, RealtimePubSubHealthIndicator),
    ).toBe(true)
    expect(new RealtimePubSubHealthIndicator(bus()).name).toBe('realtime-pubsub')
  })

  // Scenario: the bus reports it is subscribed. Expected: up.
  it('is up while the bus is subscribed', async () => {
    await expect(new RealtimePubSubHealthIndicator(bus(() => true)).check()).resolves.toEqual({
      status: 'up',
    })
  })

  // Scenario: the bus lost its subscription, so what other instances publish no longer reaches this one.
  // Expected: down, with no detail that could carry a host name or a credential.
  it('is down when the bus is not subscribed', async () => {
    await expect(new RealtimePubSubHealthIndicator(bus(() => false)).check()).resolves.toEqual({
      status: 'down',
    })
  })

  // Scenario: a bus that cannot be unsubscribed once subscribed omits the question, as the in-memory one does.
  // Expected: up, because there is no signal to be alarmed by.
  it('is up for a bus that does not report its state', async () => {
    await expect(new RealtimePubSubHealthIndicator(new InMemoryPubSub()).check()).resolves.toEqual({
      status: 'up',
    })
  })

  // Scenario: any check. Expected: nothing is published, since a health probe must never send real traffic.
  it('never publishes', async () => {
    const quiet = bus(() => true)
    await new RealtimePubSubHealthIndicator(quiet).check()
    await new RealtimePubSubHealthIndicator(bus(() => false)).check()
    expect(quiet.publish).not.toHaveBeenCalled()
  })
})
