/**
 * @fileoverview What `revalidate` is handed: the result the authenticator originally returned, as the
 * service rebuilds it from the connection's record.
 * @layer application
 */
import {
  mkRecord,
  mkConnections,
  mkRealtime,
  mkAuth,
  mkOptions,
  build,
} from '../../../test/fixtures/reauthentication/harness'
import type { ConnectionRecord } from './connection-registry.service'

/** The second argument every call carries: the signal a call can stop its work on. */
const WITH_SIGNAL = { signal: expect.any(AbortSignal) }

describe('ReauthenticationService: the result handed to revalidate', () => {
  // revalidate is handed back the original result, metadata included — an
  // authenticator that stored a trace id at connect time can read it here.
  it('passes the stored metadata back to revalidate', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const record: ConnectionRecord = {
      ...mkRecord(),
      originalAuth: {
        userId: 'u1',
        tenantId: 't1',
        roles: undefined,
        metadata: { traceId: 'trace-1' },
      },
    }
    const connections = mkConnections([record])
    const svc = build(
      connections,
      mkRealtime(),
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60 }),
    )
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ metadata: { traceId: 'trace-1' } }),
      WITH_SIGNAL,
    )
  })

  // The absent branch of the metadata spread: the key must be omitted, not set to
  // undefined, so the reconstructed result stays valid under exactOptionalPropertyTypes.
  it('omits metadata from the revalidate result when the connection has none', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()])
    const svc = build(
      connections,
      mkRealtime(),
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60 }),
    )
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c1',
      expect.not.objectContaining({ metadata: undefined }),
      WITH_SIGNAL,
    )
  })

  // Covers the spread branches in originalAuth construction: tenantId absent + roles present.
  it('passes originalAuth without tenantId and with roles when those fields are set accordingly', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    // tenantId: undefined → spread emits {}; roles: defined → spread emits { roles }
    const record: ConnectionRecord = {
      connectionId: 'c-spread',
      userId: 'u-spread',
      tenantId: undefined,
      transport: 'sse',
      ip: '127.0.0.1',
      userAgent: undefined,
      connectedAt: new Date(),
      subject: null,
      close$: null,
      originalAuth: {
        userId: 'u-spread',
        tenantId: undefined,
        roles: ['admin'],
        metadata: undefined,
      },
    }
    const connections = mkConnections([record])
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c-spread',
      expect.objectContaining({ userId: 'u-spread', roles: ['admin'] }),
      WITH_SIGNAL,
    )
    // tenantId should be absent (not present as undefined) on the passed object.
    const passedAuth = revalidate.mock.calls[0][1] as Record<string, unknown>
    expect('tenantId' in passedAuth).toBe(false)
  })

  // revalidate receives the tenantId from originalAuth when it is defined.
  it('passes tenantId to revalidate when originalAuth.tenantId is set', async () => {
    // Kills ObjectLiteral mutation { tenantId: conn.originalAuth.tenantId } → {}.
    const revalidate = jest.fn().mockResolvedValue(true)
    const connections = mkConnections([mkRecord()]) // mkRecord sets tenantId: 't1'
    const realtime = mkRealtime()
    const auth = mkAuth(revalidate)
    const svc = build(connections, realtime, auth, mkOptions({ intervalSeconds: 60 }))
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ tenantId: 't1' }),
      WITH_SIGNAL,
    )
  })

  // The rooms joined at admission are handed back to revalidate with the rest of the original result.
  it('passes the admission rooms to revalidate, and none when the connection has none', async () => {
    const revalidate = jest.fn().mockResolvedValue(true)
    const withRooms: ConnectionRecord = {
      ...mkRecord('c-rooms', 'u1'),
      originalAuth: {
        userId: 'u1',
        tenantId: 't1',
        roles: undefined,
        rooms: ['w:1'],
        metadata: undefined,
      },
    }
    const connections = mkConnections([withRooms, mkRecord('c-plain', 'u2')])
    const svc = build(
      connections,
      mkRealtime(),
      mkAuth(revalidate),
      mkOptions({ intervalSeconds: 60 }),
    )
    await svc.runCycle()
    expect(revalidate).toHaveBeenCalledWith(
      'c-rooms',
      expect.objectContaining({ rooms: ['w:1'] }),
      WITH_SIGNAL,
    )
    expect(revalidate.mock.calls.find((c) => c[0] === 'c-plain')?.[1]).not.toHaveProperty('rooms')
  })
})
