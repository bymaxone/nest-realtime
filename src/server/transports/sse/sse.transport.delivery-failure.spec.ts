/**
 * @fileoverview Delivery-failure reporting of SseTransport: what an emit logs, what it hands to
 * `onDeliveryFailure`, and when it rejects. Split from `sse.transport.spec.ts`, which covers the
 * transport's delivery, registry and lifecycle behaviour.
 * @layer test
 */
import { Logger } from '@nestjs/common'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import type { IConnectionAuthenticator } from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { IOfflineQueueStorage } from '../../interfaces/offline-queue-storage.interface'
import type { IRealtimePubSub } from '../../interfaces/realtime-pubsub.interface'
import { InMemoryPubSub } from '../../pubsub/in-memory-pubsub'
import { HeartbeatService } from './heartbeat.service'
import { EventReplayBuffer } from './event-replay-buffer'
import { SseTransport } from './sse.transport'

function build(opts?: {
  hooks?: IConnectionLifecycleHooks
  offlineQueue?: IOfflineQueueStorage
  pubsub?: IRealtimePubSub
}) {
  const options = {
    transport: 'sse' as const,
    authenticator: { authenticate: async () => null },
  }
  const publish = jest.fn().mockResolvedValue(undefined)
  const subscribe = jest.fn().mockResolvedValue(jest.fn().mockResolvedValue(undefined))
  const pubsub = opts?.pubsub ?? ({ publish, subscribe } as unknown as IRealtimePubSub)
  const transport = new SseTransport(
    new ConnectionRegistry(),
    new RoomRegistry(),
    new EventReplayBuffer(options),
    new EventIdGenerator(),
    new HeartbeatService(),
    { authenticate: jest.fn() } as unknown as IConnectionAuthenticator,
    pubsub,
    opts?.hooks ?? {},
    options,
    'inst-1',
    opts?.offlineQueue,
  )
  return { transport, publish }
}

describe('SseTransport delivery failures', () => {
  // The user-targeted emit names its own operation when its publish fails behind a resolved call.
  it('reports a failed emitToUser publish with its own operation', async () => {
    const onDeliveryFailure = jest.fn()
    const { transport, publish } = build({ hooks: { onDeliveryFailure } })
    publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
    await new Promise((resolve) => setImmediate(resolve))
    expect(onDeliveryFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'REALTIME_PUBSUB_UNAVAILABLE', op: 'emitToUser' }),
    )
  })

  // A failed publish of an emit stays best-effort and visible: the log line carries the stable code
  // and the operation, and the consumer's hook receives the failure.
  it('reports a failed emit publish to the log and to onDeliveryFailure', async () => {
    const onDeliveryFailure = jest.fn()
    const { transport, publish } = build({ hooks: { onDeliveryFailure } })
    publish.mockRejectedValueOnce(new Error('redis down'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await expect(transport.emitToTenant('t1', 'foo', {})).resolves.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
      expect(warnSpy).toHaveBeenCalledWith(
        'REALTIME_PUBSUB_UNAVAILABLE op=emitToTenant: pubsub.publish failed: redis down',
      )
      expect(onDeliveryFailure).toHaveBeenCalledTimes(1)
      expect(onDeliveryFailure).toHaveBeenCalledWith({
        code: 'REALTIME_PUBSUB_UNAVAILABLE',
        op: 'emitToTenant',
        error: expect.objectContaining({ message: 'redis down' }),
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  // The hook is the consumer's; whatever it does cannot fail the emit.
  it.each([
    [
      'throws',
      () => {
        throw new Error('hook boom')
      },
    ],
    ['rejects', () => Promise.reject(new Error('hook boom'))],
  ])(
    'an onDeliveryFailure hook that %s does not fail the emit',
    async (_label, onDeliveryFailure) => {
      const { transport, publish } = build({ hooks: { onDeliveryFailure } })
      publish.mockRejectedValueOnce(new Error('redis down'))
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
        await new Promise((resolve) => setImmediate(resolve))
        expect(warnSpy).toHaveBeenCalledWith('onDeliveryFailure hook failed: hook boom')
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
        warnSpy.mockRestore()
      }
    },
  )

  // The offline append is awaited: the emit does not resolve before the queue has answered.
  it('waits for the offline queue to answer before the emit resolves', async () => {
    let finish: () => void = () => undefined
    const append = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const offlineQueue = {
      append,
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport } = build({ offlineQueue })
    let resolved = false
    const emit = transport.emitToUser('u1', 'foo', {}).then(() => {
      resolved = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(append).toHaveBeenCalledTimes(1)
    expect(resolved).toBe(false)
    finish()
    await emit
    expect(resolved).toBe(true)
  })

  // A user who is offline here and whose event the queue could not keep has no delivery path
  // unless a bus can carry it to another instance: with the in-memory bus there is no other
  // instance, so the emit rejects instead of reporting a delivery that cannot happen.
  it('rejects an offline emit the queue could not keep when nothing else can carry it', async () => {
    const offlineQueue = {
      append: jest.fn().mockRejectedValue(new Error('queue down')),
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport } = build({ offlineQueue, pubsub: new InMemoryPubSub() })
    const failure = await transport.emitToUser('u1', 'foo', {}).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      '[SseTransport] REALTIME_TRANSPORT_UNAVAILABLE: foo for u1 has no delivery path: the user is offline here and the offline queue failed (queue down)',
    )
    expect(((failure as Error).cause as Error).message).toBe('queue down')
  })

  it('rejects an offline emit when the queue and the bus both failed', async () => {
    const offlineQueue = {
      append: jest.fn().mockRejectedValue(new Error('queue down')),
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport, publish } = build({ offlineQueue })
    publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(transport.emitToUser('u1', 'foo', {})).rejects.toThrow(
      '[SseTransport] REALTIME_TRANSPORT_UNAVAILABLE: foo for u1 has no delivery path: the user is offline here and the offline queue failed (queue down)',
    )
  })

  // A rejected emit already tells its caller; reporting it through the hook as well would count the
  // same failure twice, so the hook hears only about failures behind a call that resolved.
  it.each([
    ['the bus cannot reach another instance', 'memory'],
    ['the bus failed too', 'failed'],
  ])('does not call onDeliveryFailure when the emit rejects because %s', async (_label, bus) => {
    const onDeliveryFailure = jest.fn()
    const offlineQueue = {
      append: jest.fn().mockRejectedValue(new Error('queue down')),
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport, publish } = build({
      offlineQueue,
      hooks: { onDeliveryFailure },
      ...(bus === 'memory' ? { pubsub: new InMemoryPubSub() } : {}),
    })
    if (bus === 'failed') publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(transport.emitToUser('u1', 'foo', {})).rejects.toThrow(
      '[SseTransport] REALTIME_TRANSPORT_UNAVAILABLE: foo for u1 has no delivery path: the user is offline here and the offline queue failed (queue down)',
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(onDeliveryFailure).not.toHaveBeenCalled()
  })

  // With a bus that can reach other instances the user may be online there, where the publish
  // delivers the event live: the emit resolves, and the queue failure is reported.
  it('resolves an offline emit the queue could not keep when the bus accepted it', async () => {
    const onDeliveryFailure = jest.fn()
    const offlineQueue = {
      append: jest.fn().mockRejectedValue(new Error('queue down')),
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport } = build({ offlineQueue, hooks: { onDeliveryFailure } })
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
    await new Promise((resolve) => setImmediate(resolve))
    expect(onDeliveryFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'REALTIME_TRANSPORT_UNAVAILABLE', op: 'offlineAppend' }),
    )
  })
})
