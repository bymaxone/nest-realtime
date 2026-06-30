/**
 * @fileoverview Unit tests for RealtimePubSubSubscriber.
 * @layer infrastructure
 */
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import type { SseTransport } from '../transports/sse/sse.transport'
import { RealtimePubSubSubscriber } from './realtime-pubsub-subscriber'

type Handler = (msg: RealtimePubSubMessage) => void

function buildPubSub() {
  let capturedHandler: Handler | null = null
  const unsubscribe = jest.fn().mockResolvedValue(undefined)
  const subscribe = jest.fn().mockImplementation(async (h: Handler) => {
    capturedHandler = h
    return unsubscribe
  })
  const publish = jest.fn().mockResolvedValue(undefined)
  return {
    pubsub: { subscribe, publish },
    unsubscribe,
    getHandler: () => capturedHandler,
  }
}

function buildSse() {
  return {
    emitToUserLocal: jest.fn(),
    emitToTenantLocal: jest.fn(),
    emitToRoomLocal: jest.fn(),
    broadcastLocal: jest.fn(),
    disconnectLocal: jest.fn().mockResolvedValue(undefined),
  } as unknown as SseTransport
}

function build(instanceId = 'inst-1') {
  const { pubsub, unsubscribe, getHandler } = buildPubSub()
  const sse = buildSse()
  const subscriber = new RealtimePubSubSubscriber(pubsub as never, instanceId, sse)
  return { subscriber, pubsub, unsubscribe, getHandler, sse }
}

describe('RealtimePubSubSubscriber', () => {
  // onModuleInit subscribes to the bus so the subscriber handles messages.
  it('subscribes to the bus on init', async () => {
    const { subscriber, pubsub } = build()
    await subscriber.onModuleInit()
    expect(pubsub.subscribe).toHaveBeenCalledTimes(1)
  })

  // onApplicationShutdown calls the unsubscribe handle returned by subscribe.
  it('calls unsubscribe on shutdown', async () => {
    const { subscriber, unsubscribe } = build()
    await subscriber.onModuleInit()
    await subscriber.onApplicationShutdown()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  // A second shutdown call is a no-op — unsubscribe is called exactly once.
  it('shutdown is idempotent', async () => {
    const { subscriber, unsubscribe } = build()
    await subscriber.onModuleInit()
    await subscriber.onApplicationShutdown()
    await subscriber.onApplicationShutdown()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  // Messages from this instance are dropped to prevent echo.
  it('drops messages where origin === instanceId', async () => {
    const { subscriber, getHandler, sse } = build('self')
    await subscriber.onModuleInit()
    getHandler()!({ op: 'broadcast', args: { event: 'x', data: {}, id: '1' }, origin: 'self' })
    expect(sse.broadcastLocal).not.toHaveBeenCalled()
  })

  // Remote emitToUser is dispatched to sse.emitToUserLocal.
  it('dispatches remote emitToUser to emitToUserLocal', async () => {
    const { subscriber, getHandler, sse } = build()
    await subscriber.onModuleInit()
    getHandler()!({
      op: 'emitToUser',
      args: { userId: 'u1', event: 'foo', data: { x: 1 }, id: 'id-1' },
      origin: 'remote',
    })
    expect(sse.emitToUserLocal).toHaveBeenCalledWith('u1', 'foo', { x: 1 }, 'id-1')
  })

  // Remote emitToTenant is dispatched to sse.emitToTenantLocal.
  it('dispatches remote emitToTenant to emitToTenantLocal', async () => {
    const { subscriber, getHandler, sse } = build()
    await subscriber.onModuleInit()
    getHandler()!({
      op: 'emitToTenant',
      args: { tenantId: 't1', event: 'foo', data: {}, id: 'id-2' },
      origin: 'remote',
    })
    expect(sse.emitToTenantLocal).toHaveBeenCalledWith('t1', 'foo', {}, 'id-2')
  })

  // Remote emitToRoom is dispatched to sse.emitToRoomLocal.
  it('dispatches remote emitToRoom to emitToRoomLocal', async () => {
    const { subscriber, getHandler, sse } = build()
    await subscriber.onModuleInit()
    getHandler()!({
      op: 'emitToRoom',
      args: { roomId: 'room:a', event: 'foo', data: {}, id: 'id-3' },
      origin: 'remote',
    })
    expect(sse.emitToRoomLocal).toHaveBeenCalledWith('room:a', 'foo', {}, 'id-3')
  })

  // Remote broadcast is dispatched to sse.broadcastLocal.
  it('dispatches remote broadcast to broadcastLocal', async () => {
    const { subscriber, getHandler, sse } = build()
    await subscriber.onModuleInit()
    getHandler()!({
      op: 'broadcast',
      args: { event: 'foo', data: {}, id: 'id-4' },
      origin: 'remote',
    })
    expect(sse.broadcastLocal).toHaveBeenCalledWith('foo', {}, 'id-4')
  })

  // Remote disconnect is dispatched to sse.disconnectLocal with the reason.
  it('dispatches remote disconnect to disconnectLocal', async () => {
    const { subscriber, getHandler, sse } = build()
    await subscriber.onModuleInit()
    getHandler()!({
      op: 'disconnect',
      args: { connectionId: 'c1', reason: 'revoked' },
      origin: 'remote',
    })
    await Promise.resolve()
    expect(sse.disconnectLocal).toHaveBeenCalledWith('c1', 'revoked')
  })

  // An unknown op is logged and does not throw.
  it('logs and swallows an unknown op', async () => {
    const { subscriber, getHandler } = build()
    await subscriber.onModuleInit()
    expect(() =>
      getHandler()!({ op: 'unknown' as never, args: {}, origin: 'remote' }),
    ).not.toThrow()
  })

  // A throwing SSE method is logged and does not propagate.
  it('swallows a throwing SSE dispatch', async () => {
    const { subscriber, getHandler, sse } = build()
    ;(sse.broadcastLocal as jest.Mock).mockImplementation(() => {
      throw new Error('boom')
    })
    await subscriber.onModuleInit()
    expect(() =>
      getHandler()!({ op: 'broadcast', args: { event: 'x', data: {}, id: '1' }, origin: 'remote' }),
    ).not.toThrow()
  })

  // A subscribe failure is swallowed so the module still starts.
  it('swallows a subscribe failure and continues without a bus', async () => {
    const { pubsub } = buildPubSub()
    pubsub.subscribe.mockRejectedValueOnce(new Error('redis down'))
    const sse = buildSse()
    const subscriber = new RealtimePubSubSubscriber(pubsub as never, 'inst-1', sse)
    await expect(subscriber.onModuleInit()).resolves.toBeUndefined()
  })

  // A failing unsubscribe on shutdown is swallowed.
  it('swallows an unsubscribe failure on shutdown', async () => {
    const { subscriber, unsubscribe } = build()
    await subscriber.onModuleInit()
    unsubscribe.mockRejectedValueOnce(new Error('network error'))
    await expect(subscriber.onApplicationShutdown()).resolves.toBeUndefined()
  })
})
