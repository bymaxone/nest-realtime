/**
 * @fileoverview Unit tests for WebSocketTransport — all emit, join, leave, disconnect, register paths.
 * @layer transport
 */
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RoomRegistry } from '../../services/room-registry.service'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../../constants/injection-tokens.constants'
import type { AuthenticationResult } from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { WebSocketTransport } from './websocket.transport'

/** Minimal mocked socket.io Socket. */
function makeSocket(id = 'sock-1') {
  return {
    id,
    handshake: {
      address: '127.0.0.1',
      headers: { 'user-agent': 'test' },
    },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  }
}

/** Minimal mocked socket.io Server. */
function makeServer(sockets: Map<string, ReturnType<typeof makeSocket>> = new Map()) {
  const toChain = { emit: jest.fn() }
  const inChain = { disconnectSockets: jest.fn() }
  return {
    to: jest.fn().mockReturnValue(toChain),
    in: jest.fn().mockReturnValue(inChain),
    emit: jest.fn(),
    sockets: { sockets },
    _toChain: toChain,
    _inChain: inChain,
  }
}

describe('WebSocketTransport', () => {
  let transport: WebSocketTransport
  let connectionRegistry: ConnectionRegistry
  let roomRegistry: RoomRegistry
  let hooks: jest.Mocked<IConnectionLifecycleHooks>

  const auth: AuthenticationResult = {
    userId: 'u-1',
    tenantId: 'tenant-1',
    roles: ['user'],
  }

  /** Build the test module with optional module options override. */
  async function buildModule(
    opts: Partial<BymaxRealtimeModuleOptions> = {},
  ): Promise<TestingModule> {
    hooks = {
      onConnect: jest.fn().mockResolvedValue(undefined),
      onDisconnect: jest.fn().mockResolvedValue(undefined),
    }
    return Test.createTestingModule({
      providers: [
        WebSocketTransport,
        ConnectionRegistry,
        RoomRegistry,
        { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: { authenticate: jest.fn() } },
        { provide: REALTIME_HOOKS_TOKEN, useValue: hooks },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: opts },
      ],
    }).compile()
  }

  beforeEach(async () => {
    const module = await buildModule()
    transport = module.get(WebSocketTransport)
    connectionRegistry = module.get(ConnectionRegistry)
    roomRegistry = module.get(RoomRegistry)
  })

  it('has kind === websocket', () => {
    // Transport identifier must be websocket (spec §5.1).
    expect(transport.kind).toBe('websocket')
  })

  it('authenticator() returns the injected IConnectionAuthenticator', () => {
    // The gateway uses authenticator() to get the auth instance without circular injection.
    const auth = transport.authenticator()
    expect(auth).toBeDefined()
    expect(typeof auth.authenticate).toBe('function')
  })

  it('emitToUser is a safe no-op when server is unset', async () => {
    // Emits before setServer must not throw.
    await expect(transport.emitToUser('u-1', 'evt', {})).resolves.toBeUndefined()
  })

  it('emitToUser calls server.to(user:{id}).emit(event, data)', async () => {
    // emitToUser targets the user:{userId} room.
    const server = makeServer()
    transport.setServer(server as never)
    await transport.emitToUser('u-1', 'my-event', { ok: true })
    expect(server.to).toHaveBeenCalledWith('user:u-1')
    expect(server._toChain.emit).toHaveBeenCalledWith('my-event', { ok: true })
  })

  it('emitToTenant calls server.to(tenant:{id}).emit(event, data)', async () => {
    // emitToTenant targets the tenant:{tenantId} room.
    const server = makeServer()
    transport.setServer(server as never)
    await transport.emitToTenant('t-1', 'evt', 42)
    expect(server.to).toHaveBeenCalledWith('tenant:t-1')
    expect(server._toChain.emit).toHaveBeenCalledWith('evt', 42)
  })

  it('emitToRoom calls server.to(roomId).emit(event, data)', async () => {
    // emitToRoom targets the specified arbitrary room.
    const server = makeServer()
    transport.setServer(server as never)
    await transport.emitToRoom('custom:room', 'evt', null)
    expect(server.to).toHaveBeenCalledWith('custom:room')
    expect(server._toChain.emit).toHaveBeenCalledWith('evt', null)
  })

  it('broadcast calls server.emit(event, data)', async () => {
    // broadcast sends to all connected clients.
    const server = makeServer()
    transport.setServer(server as never)
    await transport.broadcast('global', { msg: 'hi' })
    expect(server.emit).toHaveBeenCalledWith('global', { msg: 'hi' })
  })

  it('registerSocket adds to ConnectionRegistry and auto-joins canonical rooms', async () => {
    // registerSocket stores the record and joins user:{id} + tenant:{id}.
    const socket = makeSocket()
    const server = makeServer()
    transport.setServer(server as never)
    await transport.registerSocket(socket as never, auth)

    const record = connectionRegistry.get('sock-1')
    expect(record).toBeDefined()
    expect(record?.userId).toBe('u-1')
    expect(record?.transport).toBe('websocket')
    expect(record?.subject).toBeNull()
    expect(socket.join).toHaveBeenCalledWith('user:u-1')
    expect(socket.join).toHaveBeenCalledWith('tenant:tenant-1')
  })

  it('registerSocket joins the per-connection room for cross-node revocation', async () => {
    // Each socket joins connection:{id} so disconnect() can target it via the adapter.
    const socket = makeSocket()
    await transport.registerSocket(socket as never, auth)
    expect(socket.join).toHaveBeenCalledWith('connection:sock-1')
  })

  it('registerSocket fires hooks.onConnect', async () => {
    // The onConnect lifecycle hook must be called after registration.
    const socket = makeSocket()
    await transport.registerSocket(socket as never, auth)
    expect(hooks.onConnect).toHaveBeenCalledTimes(1)
    expect(hooks.onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', transport: 'websocket' }),
    )
  })

  it('registerSocket skips tenant room when tenantId is absent', async () => {
    // No tenant room is joined when auth.tenantId is undefined.
    const socket = makeSocket()
    const noTenantAuth: AuthenticationResult = { userId: 'u-2' }
    await transport.registerSocket(socket as never, noTenantAuth)
    expect(socket.join).toHaveBeenCalledWith('user:u-2')
    expect(socket.join).not.toHaveBeenCalledWith(expect.stringContaining('tenant:'))
  })

  it('unregisterSocket removes from registry and fires onDisconnect', async () => {
    // unregisterSocket cleans up and fires the disconnect hook.
    const socket = makeSocket()
    await transport.registerSocket(socket as never, auth)
    await transport.unregisterSocket('sock-1', 'test-reason')

    expect(connectionRegistry.get('sock-1')).toBeUndefined()
    expect(hooks.onDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'sock-1',
        reason: 'test-reason',
        durationMs: expect.any(Number),
      }),
    )
  })

  it('unregisterSocket without reason omits reason from onDisconnect meta', async () => {
    // When no reason is provided, the disconnectMeta does not include reason.
    const socket = makeSocket()
    await transport.registerSocket(socket as never, auth)
    await transport.unregisterSocket('sock-1')
    expect(hooks.onDisconnect).toHaveBeenCalledWith(
      expect.not.objectContaining({ reason: expect.anything() }),
    )
  })

  it('unregisterSocket is a no-op for unknown connectionId', async () => {
    // Unregistering a non-existent connection must not throw.
    await expect(transport.unregisterSocket('unknown', 'r')).resolves.toBeUndefined()
    expect(hooks.onDisconnect).not.toHaveBeenCalled()
  })

  it('joinRoom calls socket.join + RoomRegistry.join', async () => {
    // joinRoom updates both Socket.IO and the internal registry.
    const socket = makeSocket()
    const server = makeServer(new Map([['sock-1', socket]]))
    transport.setServer(server as never)
    await transport.registerSocket(socket as never, auth)
    socket.join.mockClear()

    await transport.joinRoom('sock-1', 'room:x')
    expect(socket.join).toHaveBeenCalledWith('room:x')
    expect(roomRegistry.roomsOf('sock-1')).toContain('room:x')
  })

  it('joinRoom is a no-op when socket not found', async () => {
    // Joining a room for an unknown socket must not throw.
    const server = makeServer()
    transport.setServer(server as never)
    await expect(transport.joinRoom('missing', 'room:x')).resolves.toBeUndefined()
  })

  it('leaveRoom calls socket.leave + RoomRegistry.leave', async () => {
    // leaveRoom updates both Socket.IO and the internal registry.
    const socket = makeSocket()
    const server = makeServer(new Map([['sock-1', socket]]))
    transport.setServer(server as never)
    await transport.registerSocket(socket as never, auth)
    await transport.joinRoom('sock-1', 'room:y')
    socket.leave.mockClear()

    await transport.leaveRoom('sock-1', 'room:y')
    expect(socket.leave).toHaveBeenCalledWith('room:y')
    expect(roomRegistry.roomsOf('sock-1')).not.toContain('room:y')
  })

  it('disconnect closes the local socket and broadcasts adapter-aware revocation', async () => {
    // A socket on this node is closed directly (fast path) AND disconnectSockets
    // is broadcast to connection:{id} so remote nodes revoke it too.
    const socket = makeSocket()
    const server = makeServer(new Map([['sock-1', socket]]))
    transport.setServer(server as never)

    await transport.disconnect('sock-1')
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(server.in).toHaveBeenCalledWith('connection:sock-1')
    expect(server._inChain.disconnectSockets).toHaveBeenCalledWith(true)
  })

  it('disconnect revokes cross-node even when the socket is not local', async () => {
    // No local socket → the adapter-aware disconnectSockets still fans out to the
    // node that holds the connection. The test fails if cross-node revocation is dropped.
    const server = makeServer()
    transport.setServer(server as never)
    await expect(transport.disconnect('remote-id')).resolves.toBeUndefined()
    expect(server.in).toHaveBeenCalledWith('connection:remote-id')
    expect(server._inChain.disconnectSockets).toHaveBeenCalledWith(true)
  })

  it('disconnect is a safe no-op when the server is unset', async () => {
    // Without a wired server there is nothing to revoke; it must not throw.
    await expect(transport.disconnect('sock-1')).resolves.toBeUndefined()
  })

  describe('evictBeyondLimit (maxConnectionsPerUser)', () => {
    it('does not evict when maxConnectionsPerUser is not set', async () => {
      // No eviction occurs when the limit is not configured.
      const socket1 = makeSocket('s-1')
      const socket2 = makeSocket('s-2')
      const server = makeServer(
        new Map([
          ['s-1', socket1],
          ['s-2', socket2],
        ]),
      )

      const module = await buildModule({})
      const t = module.get(WebSocketTransport)
      t.setServer(server as never)

      await t.registerSocket(socket1 as never, { userId: 'u-1', tenantId: 'tenant-1' })
      await t.registerSocket(socket2 as never, { userId: 'u-1', tenantId: 'tenant-1' })

      // Both connections should remain.
      expect(socket1.disconnect).not.toHaveBeenCalled()
      expect(socket2.disconnect).not.toHaveBeenCalled()
    })

    it('evicts the oldest connection when maxConnectionsPerUser is exceeded', async () => {
      // When limit = 1, registering a second connection evicts the first (FIFO).
      const socket1 = makeSocket('s-1')
      const socket2 = makeSocket('s-2')
      const server = makeServer(
        new Map([
          ['s-1', socket1],
          ['s-2', socket2],
        ]),
      )

      const module = await buildModule({ websocket: { maxConnectionsPerUser: 1 } })
      const t = module.get(WebSocketTransport)
      t.setServer(server as never)

      // Register s-1 first (oldest), then s-2 which should evict s-1.
      await t.registerSocket(socket1 as never, { userId: 'u-1', tenantId: 'tenant-1' })
      await t.registerSocket(socket2 as never, { userId: 'u-1', tenantId: 'tenant-1' })

      expect(socket1.disconnect).toHaveBeenCalledWith(true)
    })

    it('does not evict when count is within limit', async () => {
      // No eviction when the number of connections is within the allowed limit.
      const socket1 = makeSocket('s-1')
      const server = makeServer(new Map([['s-1', socket1]]))

      const module = await buildModule({ websocket: { maxConnectionsPerUser: 2 } })
      const t = module.get(WebSocketTransport)
      t.setServer(server as never)

      await t.registerSocket(socket1 as never, { userId: 'u-1', tenantId: 'tenant-1' })

      expect(socket1.disconnect).not.toHaveBeenCalled()
    })

    it('evicts the connection at index [1] when it has an earlier connectedAt (reduce b-branch)', async () => {
      // When byUser returns [newer, older], the reduce must pick the older (b-path).
      const socket1 = makeSocket('s-a')
      const socket2 = makeSocket('s-b')
      const socket3 = makeSocket('s-c')
      const server = makeServer(
        new Map([
          ['s-a', socket1],
          ['s-b', socket2],
          ['s-c', socket3],
        ]),
      )

      const module = await buildModule({ websocket: { maxConnectionsPerUser: 1 } })
      const t = module.get(WebSocketTransport)
      const reg = module.get(ConnectionRegistry)
      t.setServer(server as never)

      // Register s-a and s-b; after s-b is added s-a gets evicted (limit=1).
      await t.registerSocket(socket1 as never, { userId: 'u-br', tenantId: 't-1' })
      await t.registerSocket(socket2 as never, { userId: 'u-br', tenantId: 't-1' })

      // At this point only s-b remains. Inject a synthetic record for s-a with a
      // LATER connectedAt than s-b so that when s-c triggers eviction, byUser
      // returns [s-a(newer), s-b(older)] and the reduce `b` path picks s-b.
      const recB = reg.get('s-b')
      if (recB) {
        // Re-register s-a with a future connectedAt directly in the registry.
        reg.register({
          connectionId: 's-a',
          userId: 'u-br',
          tenantId: 't-1',
          transport: 'websocket',
          ip: '127.0.0.1',
          userAgent: 'test',
          connectedAt: new Date(Date.now() + 1_000),
          subject: null,
          close$: null,
          originalAuth: { userId: 'u-br', tenantId: 't-1', roles: [] },
        })
      }

      // Now byUser('u-br') = [s-b(older), s-a(newer)] with insertion order.
      // Registering s-c triggers eviction → reduce picks s-b (b-path) as oldest.
      await t.registerSocket(socket3 as never, { userId: 'u-br', tenantId: 't-1' })

      // The oldest connection (s-b) must have been disconnected.
      expect(socket2.disconnect).toHaveBeenCalledWith(true)
    })

    it('does not evict when limit is zero or negative (disabled)', async () => {
      // A zero or negative limit is treated as disabled.
      const socket1 = makeSocket('s-1')
      const socket2 = makeSocket('s-2')
      const server = makeServer(
        new Map([
          ['s-1', socket1],
          ['s-2', socket2],
        ]),
      )

      const module = await buildModule({ websocket: { maxConnectionsPerUser: 0 } })
      const t = module.get(WebSocketTransport)
      t.setServer(server as never)

      await t.registerSocket(socket1 as never, { userId: 'u-1', tenantId: 'tenant-1' })
      await t.registerSocket(socket2 as never, { userId: 'u-1', tenantId: 'tenant-1' })

      expect(socket1.disconnect).not.toHaveBeenCalled()
      expect(socket2.disconnect).not.toHaveBeenCalled()
    })
  })
})
