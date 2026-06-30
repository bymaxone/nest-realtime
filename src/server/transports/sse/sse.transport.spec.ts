/**
 * @fileoverview Unit tests for the SSE transport (delivery, fan-out, teardown).
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import type { IOfflineQueueStorage } from '../../interfaces/offline-queue-storage.interface'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import type { ConnectionRecord } from '../../services/connection-registry.service'
import { EventIdGenerator } from '../../services/event-id-generator.service'
import { RoomRegistry } from '../../services/room-registry.service'
import type { IConnectionAuthenticator } from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { IRealtimePubSub } from '../../interfaces/realtime-pubsub.interface'
import type {
  BymaxRealtimeModuleOptions,
  SseOptions,
} from '../../interfaces/realtime-module-options.interface'
import { HeartbeatService } from './heartbeat.service'
import { EventReplayBuffer } from './event-replay-buffer'
import { SseTransport } from './sse.transport'

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
  offlineQueue?: IOfflineQueueStorage
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
    opts?.offlineQueue,
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
      expect.objectContaining({
        op: 'emitToUser',
        origin: 'inst-1',
        args: expect.objectContaining({ userId: 'u1', event: 'foo', data: { x: 1 } }),
      }),
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
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'emitToTenant',
        args: expect.objectContaining({ tenantId: 't1', event: 'foo' }),
      }),
    )
  })

  // emitToRoom delivers to SSE members only, skipping ws and unknown members.
  it('emits to room members, skipping non-sse and unknown members', async () => {
    const { transport, connections, rooms, publish } = build()
    const sse = addConn(connections, { connectionId: 'c_sse', userId: 'u1' })
    const ws = addConn(connections, { connectionId: 'c_ws', userId: 'u2', transport: 'websocket' })
    rooms.join('c_sse', 'room:a')
    rooms.join('c_ws', 'room:a')
    rooms.join('c_ghost', 'room:a')
    await transport.emitToRoom('room:a', 'foo', { val: 1 })
    expect(sse.received).toHaveLength(1)
    expect(ws.received).toHaveLength(0)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'emitToRoom',
        args: expect.objectContaining({ roomId: 'room:a', event: 'foo', data: { val: 1 } }),
      }),
    )
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
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'broadcast',
        args: expect.objectContaining({ event: 'foo', data: {} }),
      }),
    )
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
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'disconnect',
        args: expect.objectContaining({ connectionId: expect.any(String) }),
      }),
    )
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

  // registerConnection auto-joins the user and tenant rooms (onConnect is fired by the handler).
  it('registers a connection and auto-joins user and tenant rooms', async () => {
    const { transport, rooms } = build()
    await transport.registerConnection({
      connectionId: 'c1',
      auth: { userId: 'u1', tenantId: 't1' },
      subject: new Subject<MessageEvent>(),
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: 'jest',
    })
    expect(rooms.roomsOf('c1')).toEqual(expect.arrayContaining(['user:u1', 'tenant:t1']))
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

  // shutdown tears down all SSE connections and stops the heartbeat.
  it('tears down all SSE connections on shutdown', async () => {
    const { transport, connections } = build()
    const { close$ } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    let completed = false
    close$.subscribe({ complete: () => (completed = true) })
    await transport.onApplicationShutdown()
    expect(completed).toBe(true)
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

  // FIFO eviction picks the genuine oldest even when insertion order differs from age.
  it('evicts the genuine oldest regardless of insertion order', async () => {
    const { transport, connections } = build({ sse: { maxConnectionsPerUser: 2 } })
    const registerAged = (connectionId: string, ageMs: number): void => {
      connections.register({
        connectionId,
        userId: 'u1',
        tenantId: undefined,
        transport: 'sse',
        ip: 'x',
        userAgent: undefined,
        connectedAt: new Date(Date.now() - ageMs),
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        originalAuth: { userId: 'u1', tenantId: undefined, roles: undefined },
      })
    }
    registerAged('younger', 0)
    registerAged('oldest', 10_000)
    await transport.registerConnection({
      connectionId: 'newest',
      auth: { userId: 'u1' },
      subject: new Subject<MessageEvent>(),
      close$: new Subject<void>(),
      ip: 'x',
      userAgent: undefined,
    })
    expect(connections.get('oldest')).toBeUndefined()
    expect(connections.get('younger')).toBeDefined()
    expect(connections.get('newest')).toBeDefined()
  })

  // connectionsForUser exposes a user's SSE connections without accessing private fields.
  it('connectionsForUser returns the SSE connections for a user', () => {
    const { transport, connections } = build()
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    addConn(connections, { connectionId: 'c2', userId: 'u1' })
    addConn(connections, { connectionId: 'c3', userId: 'u2' })
    const result = transport.connectionsForUser('u1')
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.connectionId)).toEqual(expect.arrayContaining(['c1', 'c2']))
  })

  // getConnection exposes a single connection record by id.
  it('getConnection returns the record when present, undefined when absent', () => {
    const { transport, connections } = build()
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    expect(transport.getConnection('c1')).toBeDefined()
    expect(transport.getConnection('missing')).toBeUndefined()
  })

  // emitToUser with an offline queue and zero local connections calls append once.
  it('calls offlineQueue.append when user has no local SSE connections', async () => {
    // Covers: offline queue is configured and user is fully offline on this instance.
    const append = jest.fn().mockResolvedValue(undefined)
    const offlineQueue = {
      append,
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport } = build({ offlineQueue })
    await transport.emitToUser('u1', 'foo', { x: 1 })
    expect(append).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ event: 'foo', data: { x: 1 }, emittedAt: expect.any(Date) }),
    )
  })

  // emitToUser with an offline queue but >=1 live connection does not call append.
  it('does not call offlineQueue.append when the user has a live local connection', async () => {
    // Covers: user has an active SSE connection — offline queue must not be written.
    const append = jest.fn().mockResolvedValue(undefined)
    const offlineQueue = {
      append,
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const { transport, connections } = build({ offlineQueue })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.emitToUser('u1', 'foo', {})
    expect(append).not.toHaveBeenCalled()
  })

  // emitToUser without an offline queue resolves normally with no side effects.
  it('resolves normally when no offline queue is configured', async () => {
    // Covers: baseline — no offlineQueue injected; emitToUser must not throw.
    const { transport } = build()
    await expect(transport.emitToUser('u1', 'foo', {})).resolves.toBeUndefined()
  })

  // emitToUser swallows an offlineQueue.append rejection and logs a warn.
  it('swallows offlineQueue.append rejections and logs a warn', async () => {
    // Covers: fire-and-forget .catch swallows the error so the live emit path is unaffected.
    const append = jest.fn().mockRejectedValue(new Error('queue down'))
    const offlineQueue = {
      append,
      retrieveSince: jest.fn(),
      acknowledge: jest.fn(),
    } as unknown as IOfflineQueueStorage
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { transport } = build({ offlineQueue })
      await transport.emitToUser('u1', 'foo', {})
      // One microtask flush to let the fire-and-forget .catch run.
      await Promise.resolve()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Offline queue append failed'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  // A rejecting onDisconnect hook is isolated (logged, never an unhandled rejection).
  it('isolates a throwing onDisconnect hook', async () => {
    const onDisconnect = jest.fn().mockRejectedValue(new Error('boom'))
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await expect(transport.unregisterConnection('c1')).resolves.toBeUndefined()
  })

  // When the onDisconnect hook throws, the error is logged via logger.error.
  // Kills BlockStatement and StringLiteral mutations on the error call.
  it('logs the hook error when onDisconnect throws', async () => {
    const onDisconnect = jest.fn().mockRejectedValue(new Error('hook-error'))
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      await transport.unregisterConnection('c1')
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('hook-error'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  // onDisconnect hook receives the connection metadata: transport type, userId, and connectedAt.
  // Kills mutations that replace the transport field or durationMs arithmetic.
  it('passes transport, userId, and a non-negative durationMs to the onDisconnect hook', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.unregisterConnection('c1')
    const meta = (onDisconnect as jest.Mock).mock.calls[0]?.[0] as {
      transport: string
      userId: string
      durationMs: number
    }
    expect(meta.transport).toBe('sse')
    expect(meta.userId).toBe('u1')
    expect(meta.durationMs).toBeGreaterThanOrEqual(0)
  })

  // disconnectLocal forwards the reason before any finalize-style cleanup runs.
  it('forwards the disconnect reason before the stream finalize cleanup', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    await transport.disconnectLocal('c1', 'revoked')
    // Simulates the @Sse stream's finalize firing after disconnectLocal: the record
    // is already gone, so this is a no-op and the reason was delivered exactly once.
    await transport.unregisterConnection('c1')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revoked' }))
  })

  // disconnectLocal calls close$.next() so downstream takeUntil operators see the emission.
  // Kills BlockStatement mutations that remove the .next() call.
  it('emits on close$ (next) before completing it in disconnectLocal', async () => {
    const { transport, connections } = build()
    const { close$ } = addConn(connections, { connectionId: 'c1', userId: 'u1' })
    let nexted = false
    close$.subscribe({
      next: () => {
        nexted = true
      },
    })
    await transport.disconnectLocal('c1')
    expect(nexted).toBe(true)
  })

  // A pub/sub publish failure is logged with the error text.
  // Kills BlockStatement and StringLiteral mutations on the warn call in publish.
  it('logs the error message when pubsub.publish fails', async () => {
    const { transport, connections, publish } = build()
    addConn(connections, { connectionId: 'c1', userId: 'u1' })
    publish.mockRejectedValueOnce(new Error('redis-down'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await transport.emitToUser('u1', 'foo', {})
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redis-down'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  // A failing connection (throwing subject.next) is logged with the error text.
  // Kills BlockStatement and StringLiteral mutations on the warn call in deliver.
  it('logs the error when a connection subject.next throws', async () => {
    const { transport, connections } = build()
    connections.register({
      connectionId: 'bad',
      userId: 'u1',
      tenantId: undefined,
      transport: 'sse',
      ip: 'x',
      userAgent: undefined,
      connectedAt: new Date(),
      subject: {
        next: () => {
          throw new Error('deliver-error')
        },
      } as unknown as Subject<MessageEvent>,
      close$: new Subject<void>(),
      originalAuth: { userId: 'u1', tenantId: undefined, roles: undefined },
    })
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await transport.emitToUser('u1', 'foo', {})
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deliver-error'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  // durationMs must be the difference between now and connectedAt, not their sum.
  it('durationMs in onDisconnect hook is a small elapsed value, not a timestamp sum', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    const past = new Date(Date.now() - 50)
    connections.register({
      connectionId: 'c1',
      userId: 'u1',
      tenantId: undefined,
      transport: 'sse',
      ip: '127.0.0.1',
      userAgent: undefined,
      connectedAt: past,
      subject: new Subject<MessageEvent>(),
      close$: new Subject<void>(),
      originalAuth: { userId: 'u1', tenantId: undefined, roles: undefined },
    })
    await transport.unregisterConnection('c1')
    const meta = (onDisconnect as jest.Mock).mock.calls[0]?.[0] as { durationMs: number }
    expect(meta.durationMs).toBeGreaterThanOrEqual(50)
    expect(meta.durationMs).toBeLessThan(60000)
  })

  // disconnectLocal must be a no-op for WebSocket connections — only SSE connections are torn down here.
  it('disconnectLocal is a no-op for a WebSocket connection', async () => {
    const onDisconnect = jest.fn()
    const { transport, connections } = build({ hooks: { onDisconnect } })
    addConn(connections, { connectionId: 'ws1', userId: 'u1', transport: 'websocket' })
    await transport.disconnectLocal('ws1')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(connections.get('ws1')).toBeDefined()
  })
})
