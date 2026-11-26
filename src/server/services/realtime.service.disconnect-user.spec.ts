/**
 * @fileoverview Per-user disconnect on the SSE path: the service, the transport and the bus subscriber.
 * @layer application
 */
import 'reflect-metadata'
import { build, addConn } from '../../../test/fixtures/sse/transport-harness'
import { RealtimePubSubSubscriber } from '../pubsub/realtime-pubsub-subscriber'
import { RealtimeMetricsTally } from '../observability/realtime-metrics-tally'
import { RealtimeService } from './realtime.service'

describe('RealtimeService.disconnectUser', () => {
  // Scenario: the user holds two streams here and another user holds one. Expected: the two are
  // closed with the reason given, the other stays, and the revocation is published once.
  it('closes the streams of that user only and publishes the revocation once', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const { transport, connections, publish } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    addConn(connections, { connectionId: 'c2', userId: 'u1' })
    addConn(connections, { connectionId: 'c3', userId: 'u2' })

    await new RealtimeService(transport).disconnectUser('u1', 'logout')

    expect(connections.byUser('u1')).toEqual([])
    expect(connections.byUser('u2')).toHaveLength(1)
    expect(onDisconnect.mock.calls.map(([meta]) => [meta.connectionId, meta.reason])).toEqual([
      ['c1', 'logout'],
      ['c2', 'logout'],
    ])
    expect(publish.mock.calls).toEqual([
      [{ op: 'disconnectUser', args: { userId: 'u1', reason: 'logout' }, origin: 'inst-1' }],
    ])
  })

  // Scenario: the user has no stream on this instance. Expected: the revocation is still
  // published, since another instance may hold one.
  it('publishes for a user with no stream on this instance', async () => {
    const { transport, publish } = build()

    await transport.disconnectUser('u1')

    expect(publish).toHaveBeenCalledTimes(1)
  })

  // Scenario: the bus refuses the publish. Expected: the call rejects with
  // REALTIME_PUBSUB_UNAVAILABLE, the local stream is closed all the same, and the message does
  // not carry the user id.
  it('rejects when the bus refuses, after closing the local streams', async () => {
    const { transport, connections, publish } = build()
    addConn(connections, { connectionId: 'c1', userId: 'secret-user' })
    publish.mockRejectedValue(new Error('down'))

    const failure = await transport.disconnectUser('secret-user').catch((error: unknown) => error)

    expect(failure).toHaveProperty('code', 'REALTIME_PUBSUB_UNAVAILABLE')
    expect(failure).toHaveProperty(
      'message',
      expect.stringContaining("the revocation of a user's connections could not be published"),
    )
    expect(String((failure as Error).message)).not.toContain('secret-user')
    expect(connections.byUser('secret-user')).toEqual([])
  })

  // Scenario: the onDisconnect hook of a local stream has not settled. Expected: the revocation
  // is already on the bus, so a slow hook here cannot keep a stream open elsewhere.
  it('publishes without waiting for a local disconnect hook', async () => {
    let finish = (): void => {}
    const onDisconnect = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const { transport, connections, publish } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    let resolved = false

    const call = transport.disconnectUser('u1').then(() => (resolved = true))
    await new Promise((resolve) => setImmediate(resolve))

    expect(publish).toHaveBeenCalledTimes(1)
    expect(resolved).toBe(false)
    finish()
    await call
  })

  // Scenario: a userId that is empty or not a string. Expected: the call rejects before the
  // transport is asked, and nothing is counted.
  it.each([[''], [undefined], [['u1', 'u2']]])('refuses %p as a userId', async (userId) => {
    const { transport, publish } = build()
    const tally = new RealtimeMetricsTally()
    const evicted = jest.spyOn(tally, 'evicted')
    const service = new RealtimeService(transport, undefined, tally)

    await expect(service.disconnectUser(userId as string)).rejects.toHaveProperty(
      'message',
      expect.stringContaining('disconnectUser: `userId` must be a non-empty string'),
    )
    expect(publish).not.toHaveBeenCalled()
    expect(evicted).not.toHaveBeenCalled()
  })

  // Scenario: a revocation that succeeds. Expected: counted once as 'revoked', as `disconnect` is.
  it('counts one revocation for each call', async () => {
    const { transport } = build()
    const tally = new RealtimeMetricsTally()
    const evicted = jest.spyOn(tally, 'evicted')

    await new RealtimeService(transport, undefined, tally).disconnectUser('u1')

    expect(evicted.mock.calls).toEqual([['revoked']])
  })

  // Scenario: another instance publishes the revocation. Expected: this one closes its streams of
  // that user with the reason, and publishes nothing back.
  it('closes local streams on a remote revocation without publishing', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined)
    const { transport, connections, publish, subscribe } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    const subscriber = new RealtimePubSubSubscriber(
      { publish, subscribe } as never,
      'inst-1',
      transport,
    )
    await subscriber.onModuleInit()
    const handle = subscribe.mock.calls[0][0] as (message: unknown) => void

    handle({ op: 'disconnectUser', args: { userId: 'u1', reason: 'logout' }, origin: 'inst-2' })
    await new Promise((resolve) => setImmediate(resolve))

    expect(connections.byUser('u1')).toEqual([])
    expect(onDisconnect.mock.calls[0]?.[0]).toHaveProperty('reason', 'logout')
    expect(publish).not.toHaveBeenCalled()
  })
})
