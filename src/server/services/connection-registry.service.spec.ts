/**
 * @fileoverview Unit tests for the indexed connection registry.
 * @layer infrastructure
 */
import { ConnectionRegistry, type ConnectionRecord } from './connection-registry.service'

function mkRecord(
  over: Partial<ConnectionRecord> & { connectionId: string; userId: string },
): ConnectionRecord {
  return {
    connectionId: over.connectionId,
    userId: over.userId,
    tenantId: over.tenantId,
    transport: over.transport ?? 'sse',
    ip: over.ip ?? '127.0.0.1',
    userAgent: over.userAgent,
    connectedAt: over.connectedAt ?? new Date(),
    subject: over.subject ?? null,
    close$: over.close$ ?? null,
    originalAuth: over.originalAuth ?? {
      userId: over.userId,
      tenantId: over.tenantId,
      roles: undefined,
    },
  }
}

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry

  beforeEach(() => {
    registry = new ConnectionRegistry()
  })

  // Registering indexes the connection by id, user and tenant.
  it('registers a connection across all three indices', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', tenantId: 't1' }))
    expect(registry.get('c1')?.connectionId).toBe('c1')
    expect(registry.byUser('u1')).toHaveLength(1)
    expect(registry.byTenant('t1')).toHaveLength(1)
    expect(registry.count()).toBe(1)
    expect(registry.countUsers()).toBe(1)
  })

  // A connection without a tenant is indexed by user only.
  it('indexes a tenant-less connection by user only', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1' }))
    expect(registry.byUser('u1')).toHaveLength(1)
    expect(registry.byTenant('t1')).toEqual([])
  })

  // byUser filters by transport when a transport is supplied.
  it('filters byUser by transport', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', transport: 'sse' }))
    registry.register(mkRecord({ connectionId: 'c2', userId: 'u1', transport: 'websocket' }))
    expect(registry.byUser('u1', 'sse')).toHaveLength(1)
    expect(registry.byUser('u1', 'websocket')).toHaveLength(1)
    expect(registry.byUser('u1')).toHaveLength(2)
  })

  // byTenant filters by transport when a transport is supplied.
  it('filters byTenant by transport', () => {
    registry.register(
      mkRecord({ connectionId: 'c1', userId: 'u1', tenantId: 't1', transport: 'sse' }),
    )
    registry.register(
      mkRecord({ connectionId: 'c2', userId: 'u2', tenantId: 't1', transport: 'websocket' }),
    )
    expect(registry.byTenant('t1', 'sse')).toHaveLength(1)
    expect(registry.byTenant('t1')).toHaveLength(2)
  })

  // allByTransport returns only connections of the requested transport.
  it('returns connections by transport', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', transport: 'sse' }))
    registry.register(mkRecord({ connectionId: 'c2', userId: 'u2', transport: 'websocket' }))
    expect(registry.allByTransport('sse')).toHaveLength(1)
    expect(registry.allByTransport('websocket')).toHaveLength(1)
  })

  // Unregistering removes the connection from every index and returns the record.
  it('unregisters from all indices', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1', tenantId: 't1' }))
    const removed = registry.unregister('c1')
    expect(removed?.connectionId).toBe('c1')
    expect(registry.get('c1')).toBeUndefined()
    expect(registry.byUser('u1')).toEqual([])
    expect(registry.byTenant('t1')).toEqual([])
    expect(registry.countUsers()).toBe(0)
  })

  // Unregistering an unknown connection is a no-op returning undefined.
  it('returns undefined when unregistering an unknown connection', () => {
    expect(registry.unregister('missing')).toBeUndefined()
  })

  // Multiple connections for the same user coexist under one user index entry.
  it('supports multiple connections per user', () => {
    registry.register(mkRecord({ connectionId: 'c1', userId: 'u1' }))
    registry.register(mkRecord({ connectionId: 'c2', userId: 'u1' }))
    expect(registry.byUser('u1')).toHaveLength(2)
    expect(registry.countUsers()).toBe(1)
    registry.unregister('c1')
    expect(registry.byUser('u1')).toHaveLength(1)
    expect(registry.countUsers()).toBe(1)
  })

  // Unknown lookups return empty arrays.
  it('returns empty arrays for unknown user/tenant', () => {
    expect(registry.byUser('nope')).toEqual([])
    expect(registry.byTenant('nope')).toEqual([])
  })
})
