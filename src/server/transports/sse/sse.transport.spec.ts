/**
 * @fileoverview Unit tests for the SSE transport (delivery, fan-out, teardown).
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import type { IConnectionAuthenticator } from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type {
  IRealtimePubSub,
  RealtimePubSubMessage,
} from '../../interfaces/realtime-pubsub.interface'
import type {
  BymaxRealtimeModuleOptions,
  SseOptions,
} from '../../interfaces/realtime-module-options.interface'
import { HeartbeatService } from './heartbeat.service'
import { EventReplayBuffer } from './event-replay-buffer'
import { SseTransport } from './sse.transport'

type RemoteHandler = (message: RealtimePubSubMessage) => void

function makeOptions(sse?: SseOptions): BymaxRealtimeModuleOptions {
  return {
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    ...(sse ? { sse } : {}),
  }
}

function build(opts?: {
  sse?: SseOptions
  hooks?: IConnectionLifecycleHooks
  instanceId?: string
}) {
  const connections = new ConnectionRegistry()
  const rooms = new RoomRegistry()
  const options = makeOptions(opts?.sse)
  const replay = new EventReplayBuffer(options)
  const idGen = new EventIdGenerator()
  const heartbeat = new HeartbeatService()
  const authenticate = jest.fn()
  const auth = { authenticate } as unknown as IConnectionAuthenticator
  const publish = jest.fn().mockResolvedValue(undefined)
  const unsubscribe = jest.fn().mockResolvedValue(undefined)
  const subscribe = jest.fn().mockResolvedValue(unsubscribe)
  const pubsub = { publish, subscribe } as unknown as IRealtimePubSub
  const hooks = opts?.hooks ?? {}
  const transport = new SseTransport(
    connections,
    rooms,
    replay,
    idGen,
    heartbeat,
    auth,
    pubsub,
    hooks,
    options,
    opts?.instanceId ?? 'inst-1',
  )
  return { transport, connections, rooms, replay, authenticate, publish, subscribe, unsubscribe }
}

function addConn(
  connections: ConnectionRegistry,
  params: {
    connectionId: string
    userId: string
    tenantId?: string
    transport?: 'sse' | 'websocket'
  },
): { received: MessageEvent[]; close$: Subject<void> } {
  const received: MessageEvent[] = []
  const transport = params.transport ?? 'sse'
  const subject = new Subject<MessageEvent>()
  const close$ = new Subject<void>()
  subject.subscribe((m) => received.push(m))
  const record: ConnectionRecord = {
    connectionId: params.connectionId,
    userId: params.userId,
    tenantId: params.tenantId,
    transport,
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: new Date(),
    subject: transport === 'sse' ? subject : null,
    close$: transport === 'sse' ? close$ : null,
    originalAuth: { userId: params.userId, tenantId: params.tenantId, roles: undefined },
  }
  connections.register(record)
  return { received, close$ }
}

describe('SseTransport', () => {
  // The transport reports a fixed kind of 'sse'.
  it('reports kind "sse"', () => {
    expect(build().transport.kind).toBe('sse')
  })

  // emitToUser delivers to the user's SSE connections, buffers, and publishes once.
  it('emits to a user, buffers, and publishes exactly once', async () => {
    const { transport, connections, replay, publish } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.emitToUser('u1', 'foo', { x: 1 })
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('foo')
    expect(replay.size('u1')).toBe(1)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'emitToUser', origin: 'inst-1' }),
    )
  })

  // SSE delivery never reaches WebSocket connections of the same user.
  it('does not deliver to websocket connections', async () => {
    const { transport, connections } = build()
    const sse = addConn(connections, { connectionId: 'c1', userId: 'u1', transport: 'sse' })
    const ws = addConn(connections, { connectionId: 'c2', userId: 'u1', transport: 'websocket' })
    await transport.emitToUser('u1', 'foo', {})
    expect(sse.received).toHaveLength(1)
    expect(ws.received).toHaveLength(0)
  })

  // emitToTenant delivers only to the tenant's SSE connections.
  it('emits to a tenant', async () => {
    const { transport, connections, publish } = build()
    const a = addConn(connections, { connectionId: 'c1', userId: 'u1', tenantId: 't1' })
    const b = addConn(connections, { connectionId: 'c2', userId: 'u2', tenantId: 't2' })
    await transport.emitToTenant('t1', 'foo', {})
    expect(a.received).toHaveLength(1)
    expect(b.received).toHaveLength(0)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ op: 'emitToTenant' }))
  })

  // emitToRoom delivers to SSE members only, skipping ws and unknown members.
  it('emits to room members, skipping non-sse and unknown members', async () => {
    const { transport, connections, rooms } = build()
    const sse = addConn(connections, { connectionId: 'c_sse', userId: 'u1' })
    const ws = addConn(connections, { connectionId: 'c_ws', userId: 'u2', transport: 'websocket' })
    rooms.join('c_sse', 'room:a')
    rooms.join('c_ws', 'room:a')
    rooms.join('c_ghost', 'room:a')
    await transport.emitToRoom('room:a', 'foo', {})
    expect(sse.received).toHaveLength(1)
    expect(ws.received).toHaveLength(0)
  })

  // broadcast reaches every SSE connection.
  it('broadcasts to all sse connections', async () => {
    const { transport, connections, publish } = build()
    const a = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    const b = addConn(connections, { connectionId: 'c2', userId: 'u2' })
    const ws = addConn(connections, { connectionId: 'c3', userId: 'u3', transport: 'websocket' })
    await transport.broadcast('foo', {})
    expect(a.received).toHaveLength(1)
    expect(b.received).toHaveLength(1)
    expect(ws.received).toHaveLength(0)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ op: 'broadcast' }))
  })

  // A failing connection is isolated so other connections still receive events.
  it('isolates a failing connection from the others', async () => {
    const { transport, connections } = build()
    const throwing = {
      next: () => {
        throw new Error('boom')
      },
    } as unknown as Subject<MessageEvent>
    connections.register({
      connectionId: 'bad',
      userId: 'u1',
      tenantId: undefined,
      transport: 'sse',
      ip: 'x',
      userAgent: undefined,
      connectedAt: new Date(),
      subject: throwing,
      close$: new Subject<void>(),
      originalAuth: { userId: 'u1', tenantId: undefined, roles: undefined },
    })
    const good = addConn(connections, { connectionId: 'good', userId: 'u1' })
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
    expect(good.received).toHaveLength(1)
  })

  // pub/sub failures are swallowed and never break the live emit path.
  it('swallows pub/sub publish failures', async () => {
    const { transport, connections, publish } = build()
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    publish.mockRejectedValueOnce(new Error('redis down'))
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
  })

  // Remote bus messages are delivered locally without being re-published.
  it('dispatches a remote message to *Local without re-publishing', async () => {
    const { transport, connections, publish, subscribe } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.onModuleInit()
    const handler = subscribe.mock.calls[0]?.[0] as RemoteHandler
    handler({
      op: 'emitToUser',
      args: { userId: 'u1', event: 'foo', data: {}, id: 'x-1' },
      origin: 'other',
    })
    expect(received).toHaveLength(1)
    expect(publish).not.toHaveBeenCalled()
  })

  // Self-originated remote messages are filtered out (no double delivery).
  it('ignores remote messages from its own origin', async () => {
    const { transport, connections, subscribe } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.onModuleInit()
    const handler = subscribe.mock.calls[0]?.[0] as RemoteHandler
    handler({
      op: 'emitToUser',
      args: { userId: 'u1', event: 'foo', data: {}, id: 'x' },
      origin: 'inst-1',
    })
    expect(received).toHaveLength(0)
  })

  // Every remote op routes to the matching local handler.
  it('routes every remote op to its local handler', async () => {
    const { transport, connections, rooms, publish, subscribe } = build()
    const user = addConn(connections, { connectionId: 'cu', userId: 'u1', tenantId: 't1' })
    rooms.join('cu', 'room:a')
    await transport.onModuleInit()
    const handler = subscribe.mock.calls[0]?.[0] as RemoteHandler
    handler({
      op: 'emitToTenant',
      args: { tenantId: 't1', event: 'e', data: {}, id: '1' },
      origin: 'o',
    })
    handler({
      op: 'emitToRoom',
      args: { roomId: 'room:a', event: 'e', data: {}, id: '2' },
      origin: 'o',
    })
    handler({ op: 'broadcast', args: { event: 'e', data: {}, id: '3' }, origin: 'o' })
    expect(user.received).toHaveLength(3)
    handler({ op: 'disconnect', args: { connectionId: 'cu', reason: 'x' }, origin: 'o' })
    expect(connections.get('cu')).toBeUndefined()
    expect(publish).not.toHaveBeenCalled()
  })

  // A local disconnect completes close$ and unregisters the connection.
  it('disconnects a local connection via close$', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    const { close$ } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    let completed = false
    close$.subscribe({ complete: () => (completed = true) })
    await transport.disconnect('c1', 'revoked')
    expect(completed).toBe(true)
    expect(connections.get('c1')).toBeUndefined()
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revoked' }))
  })

  // Disconnecting a connection not owned here publishes a cross-instance revocation.
  it('publishes op:disconnect for a non-local connection', async () => {
    const { transport, connections, publish } = build()
    addConn(connections, { connectionId: 'ws1', userId: 'u1', transport: 'websocket' })
    await transport.disconnect('missing')
    await transport.disconnect('ws1')
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ op: 'disconnect' }))
  })

  // disconnectLocal on an unknown/non-sse connection is a no-op.
  it('disconnectLocal is a no-op for unknown connections', async () => {
    const { transport } = build()
    await expect(transport.disconnectLocal('nope')).resolves.toBeUndefined()
  })

  // joinRoom and leaveRoom delegate to the room registry.
  it('joins and leaves rooms', async () => {
    const { transport, rooms } = build()
    await transport.joinRoom('c1', 'room:x')
    expect(rooms.members('room:x')).toEqual(['c1'])
    await transport.leaveRoom('c1', 'room:x')
    expect(rooms.members('room:x')).toEqual([])
  })

  // Public *Local methods deliver without publishing.
  it('does not publish from *Local methods', async () => {
    const { transport, connections, publish } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    transport.emitToUserLocal('u1', 'foo', {}, 'id-1')
    expect(received).toHaveLength(1)
    expect(publish).not.toHaveBeenCalled()
  })

  // registerConnection auto-joins the user and tenant rooms and runs onConnect.
  it('registers a connection, auto-joins rooms, and runs onConnect', async () => {
    const onConnect = jest.fn()
    const { transport, rooms } = build({ hooks: { onConnect } })
    await transport.registerConnection({
      connectionId: 'c1',
      auth: { userId: 'u1', tenantId: 't1' },
      subject: new Subject<MessageEvent>(),
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: 'jest',
    })
    expect(rooms.roomsOf('c1')).toEqual(expect.arrayContaining(['user:u1', 'tenant:t1']))
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tenantId: 't1' }),
    )
  })

  // A tenant-less registration auto-joins only the user room.
  it('auto-joins only the user room when there is no tenant', async () => {
    const { transport, rooms } = build()
    await transport.registerConnection({
      connectionId: 'c1',
      auth: { userId: 'u1' },
      subject: new Subject<MessageEvent>(),
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: undefined,
    })
    expect(rooms.roomsOf('c1')).toEqual(['user:u1'])
  })

  // unregisterConnection runs onDisconnect once and is idempotent.
  it('unregisters once and is idempotent', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.unregisterConnection('c1')
    await transport.unregisterConnection('c1')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith(
      expect.not.objectContaining({ reason: expect.anything() }),
    )
  })

  // FIFO eviction removes the oldest connection beyond the per-user cap.
  it('evicts the oldest connection beyond maxConnectionsPerUser', async () => {
    const { transport, connections } = build({ sse: { maxConnectionsPerUser: 2 } })
    for (const id of ['c1', 'c2', 'c3']) {
      await transport.registerConnection({
        connectionId: id,
        auth: { userId: 'u1' },
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        ip: '127.0.0.1',
        userAgent: undefined,
      })
    }
    expect(connections.byUser('u1', 'sse')).toHaveLength(2)
    expect(connections.get('c1')).toBeUndefined()
  })

  // No eviction happens when the per-user cap is unset.
  it('does not evict when maxConnectionsPerUser is unset', async () => {
    const { transport, connections } = build()
    for (const id of ['c1', 'c2', 'c3']) {
      await transport.registerConnection({
        connectionId: id,
        auth: { userId: 'u1' },
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        ip: '127.0.0.1',
        userAgent: undefined,
      })
    }
    expect(connections.byUser('u1', 'sse')).toHaveLength(3)
  })

  // A non-positive cap disables eviction.
  it('does not evict when maxConnectionsPerUser <= 0', async () => {
    const { transport, connections } = build({ sse: { maxConnectionsPerUser: 0 } })
    for (const id of ['c1', 'c2']) {
      await transport.registerConnection({
        connectionId: id,
        auth: { userId: 'u1' },
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        ip: '127.0.0.1',
        userAgent: undefined,
      })
    }
    expect(connections.byUser('u1', 'sse')).toHaveLength(2)
  })

  // getReplayEvents delegates to the replay buffer.
  it('returns replay events after a last-event id', async () => {
    const { transport, connections } = build()
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.emitToUser('u1', 'a', {})
    const all = transport.getReplayEvents('u1', 'missing')
    expect(all).toEqual([])
  })

  // onModuleInit subscribes and onApplicationShutdown unsubscribes and tears down.
  it('wires and tears down the bus subscription', async () => {
    const { transport, connections, subscribe, unsubscribe } = build()
    const { close$ } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    let completed = false
    close$.subscribe({ complete: () => (completed = true) })
    await transport.onModuleInit()
    expect(subscribe).toHaveBeenCalledTimes(1)
    await transport.onApplicationShutdown()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(completed).toBe(true)
  })

  // onApplicationShutdown without a prior subscription does not throw.
  it('shuts down cleanly without a subscription', async () => {
    const { transport } = build()
    await expect(transport.onApplicationShutdown()).resolves.toBeUndefined()
  })

  // The heartbeat interval getter honors config and falls back to the default.
  it('resolves the heartbeat interval', () => {
    expect(build({ sse: { heartbeatMs: 5_000 } }).transport.heartbeatMs).toBe(5_000)
    expect(build().transport.heartbeatMs).toBe(30_000)
  })

  // The connection-event flag getter honors config and defaults to enabled.
  it('resolves the connection-event flag', () => {
    expect(build({ sse: { emitConnectionEvent: false } }).transport.emitConnectionEvent).toBe(false)
    expect(build().transport.emitConnectionEvent).toBe(true)
  })

  // authenticate delegates to the injected authenticator.
  it('delegates authentication to the authenticator', async () => {
    const { transport, authenticate } = build()
    const result = { userId: 'u1' }
    authenticate.mockResolvedValue(result)
    const ctx = {
      cookies: {},
      headers: {},
      query: {},
      ip: '127.0.0.1',
      userAgent: undefined,
      transport: 'sse' as const,
    }
    await expect(transport.authenticate(ctx)).resolves.toBe(result)
    expect(authenticate).toHaveBeenCalledWith(ctx)
  })
})
