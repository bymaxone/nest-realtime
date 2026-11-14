/**
 * @fileoverview Unit tests for the per-user connection cap of WebSocketTransport.
 * @layer transport
 */
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  AuthenticationGate,
  ConnectionAdmission,
  ConnectionLimitError,
  ConnectionRegistry,
  RoomRegistry,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
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

/** Minimal mocked socket.io Server — `.sockets` is the root Namespace. */
function makeServer(sockets: Map<string, ReturnType<typeof makeSocket>> = new Map()) {
  return {
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    in: jest.fn().mockReturnValue({ disconnectSockets: jest.fn() }),
    emit: jest.fn(),
    sockets: { sockets },
  }
}

/** Build the test module with optional module options override. */
async function buildModule(opts: Partial<BymaxRealtimeModuleOptions> = {}): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      WebSocketTransport,
      ConnectionRegistry,
      RoomRegistry,
      AuthenticationGate,
      { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: { authenticate: jest.fn() } },
      {
        provide: REALTIME_HOOKS_TOKEN,
        useValue: {
          onConnect: jest.fn().mockResolvedValue(undefined),
          onDisconnect: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: REALTIME_OPTIONS_TOKEN, useValue: opts },
    ],
  }).compile()
}

describe('evictBeyondLimit (maxConnectionsPerUser)', () => {
  it('keeps two connections of a user when maxConnectionsPerUser is not set', async () => {
    // Two connections are within the default bound of five.
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

  it('keeps five connections of a user and evicts the oldest on the sixth when the option is not set', async () => {
    // The default bound is five, the SSE default: the sixth connection closes the first only.
    const sockets = ['d-1', 'd-2', 'd-3', 'd-4', 'd-5', 'd-6'].map((id) => makeSocket(id))
    const server = makeServer(new Map(sockets.map((socket) => [socket.id, socket])))
    const module = await buildModule({})
    const t = module.get(WebSocketTransport)
    t.setServer(server as never)

    for (const socket of sockets.slice(0, 5)) {
      await t.registerSocket(socket as never, { userId: 'u-default', tenantId: 'tenant-1' })
    }
    for (const socket of sockets.slice(0, 5)) expect(socket.disconnect).not.toHaveBeenCalled()

    await t.registerSocket(sockets[5] as never, { userId: 'u-default', tenantId: 'tenant-1' })

    expect(sockets[0]?.disconnect).toHaveBeenCalledWith(true)
    for (const socket of sockets.slice(1)) expect(socket.disconnect).not.toHaveBeenCalled()
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

  it('does not evict when connection count equals the exact maximum', async () => {
    // With >=, the while condition fires for length==max, evicting one too many.
    const socket1 = makeSocket('e-1')
    const socket2 = makeSocket('e-2')
    const server = makeServer(
      new Map([
        ['e-1', socket1],
        ['e-2', socket2],
      ]),
    )
    const module = await buildModule({ websocket: { maxConnectionsPerUser: 2 } })
    const t = module.get(WebSocketTransport)
    t.setServer(server as never)
    await t.registerSocket(socket1 as never, { userId: 'u-exact', tenantId: 'tenant-1' })
    await t.registerSocket(socket2 as never, { userId: 'u-exact', tenantId: 'tenant-1' })
    expect(socket1.disconnect).not.toHaveBeenCalled()
    expect(socket2.disconnect).not.toHaveBeenCalled()
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
        originalAuth: { userId: 'u-br', tenantId: 't-1', roles: [], metadata: undefined },
      })
    }

    // Now byUser('u-br') = [s-b(older), s-a(newer)] with insertion order.
    // Registering s-c triggers eviction → reduce picks s-b (b-path) as oldest.
    await t.registerSocket(socket3 as never, { userId: 'u-br', tenantId: 't-1' })

    // The oldest connection (s-b) must have been disconnected.
    expect(socket2.disconnect).toHaveBeenCalledWith(true)
  })

  it('evicts the oldest connection when it appears at index 1 in the reduce', async () => {
    // With limit=2: register a-newer first (index 0), manually inject b-older with an
    // earlier connectedAt (index 1). Registering c-trigger (3rd) must evict b-older,
    // not a-newer. If reduce always picks 'a' (first), a-newer would be evicted instead.
    const sockA = makeSocket('a-newer')
    const sockB = makeSocket('b-older')
    const sockC = makeSocket('c-trigger')
    const server = makeServer(
      new Map([
        ['a-newer', sockA],
        ['b-older', sockB],
        ['c-trigger', sockC],
      ]),
    )
    const module = await buildModule({ websocket: { maxConnectionsPerUser: 2 } })
    const t = module.get(WebSocketTransport)
    const reg = module.get(ConnectionRegistry)
    t.setServer(server as never)

    // Register a-newer so it is at index 0 in the byUser set.
    await t.registerSocket(sockA as never, { userId: 'u-ord2', tenantId: 't-2' })
    // Directly inject b-older with a connectedAt 2 s before a-newer (index 1, but older).
    const recA = reg.get('a-newer')!
    reg.register({
      connectionId: 'b-older',
      userId: 'u-ord2',
      tenantId: 't-2',
      transport: 'websocket',
      ip: '127.0.0.1',
      userAgent: 'test',
      connectedAt: new Date(recA.connectedAt.getTime() - 2000),
      subject: null,
      close$: null,
      originalAuth: { userId: 'u-ord2', tenantId: 't-2', roles: [], metadata: undefined },
    })
    // Register c-trigger: 3 connections > limit 2 → evict once → b-older must be chosen.
    await t.registerSocket(sockC as never, { userId: 'u-ord2', tenantId: 't-2' })
    expect(sockB.disconnect).toHaveBeenCalledWith(true)
    expect(sockA.disconnect).not.toHaveBeenCalled()
  })

  // Kills L266 EqualityOperator: `a.connectedAt <= b.connectedAt` → `<`.
  // When timestamps are equal, `<=` picks index-0 (first-registered) to evict; `<` picks index-1 instead.
  it('evicts the first-registered connection when two connections share the same connectedAt', async () => {
    jest.useFakeTimers()
    try {
      const sockFirst = makeSocket('s-first')
      const sockSecond = makeSocket('s-second')
      const sockTrigger = makeSocket('s-trigger')
      const server = makeServer(
        new Map([
          ['s-first', sockFirst],
          ['s-second', sockSecond],
          ['s-trigger', sockTrigger],
        ]),
      )
      const module = await buildModule({ websocket: { maxConnectionsPerUser: 2 } })
      const t = module.get(WebSocketTransport)
      t.setServer(server as never)

      // Both register at the same frozen timestamp → identical connectedAt.
      await t.registerSocket(sockFirst as never, { userId: 'u-tie', tenantId: 't-1' })
      await t.registerSocket(sockSecond as never, { userId: 'u-tie', tenantId: 't-1' })

      // Trigger eviction: 3 connections > limit 2.
      await t.registerSocket(sockTrigger as never, { userId: 'u-tie', tenantId: 't-1' })

      // With `<=`, equal timestamps → first (index 0) is "oldest" and gets evicted.
      // With mutation `<`, T < T = false → second (index 1) is picked instead.
      expect(sockFirst.disconnect).toHaveBeenCalledWith(true)
      expect(sockSecond.disconnect).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
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

  describe('admit', () => {
    it('takes a place from the instance admission when the module provides one', async () => {
      const module = await Test.createTestingModule({
        providers: [
          WebSocketTransport,
          ConnectionRegistry,
          RoomRegistry,
          AuthenticationGate,
          ConnectionAdmission,
          { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: { authenticate: jest.fn() } },
          { provide: REALTIME_HOOKS_TOKEN, useValue: {} },
          { provide: REALTIME_OPTIONS_TOKEN, useValue: { maxConnections: 1 } },
        ],
      }).compile()
      const t = module.get(WebSocketTransport)
      const ticket = t.admit()

      expect(() => t.admit()).toThrow(ConnectionLimitError)
      ticket.release()
      expect(() => t.admit()).not.toThrow()
    })

    it('holds nothing, and bounds nothing, when the transport was built without an admission', async () => {
      const t = (await buildModule({})).get(WebSocketTransport)

      for (let i = 0; i < 5; i += 1) t.admit().release()
      expect(() => t.admit()).not.toThrow()
    })
  })
})
