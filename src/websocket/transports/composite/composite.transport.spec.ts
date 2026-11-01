/**
 * @fileoverview Unit tests for CompositeTransport fan-out and failure tolerance.
 * @layer transport
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { SseTransport } from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from '../websocket/websocket.transport'
import { CompositeTransport } from './composite.transport'

/** Build a minimal mock of the methods we need from a transport. */
function makeTransportMock() {
  return {
    kind: 'sse' as const,
    emitToUser: jest.fn().mockResolvedValue(undefined),
    emitToTenant: jest.fn().mockResolvedValue(undefined),
    emitToRoom: jest.fn().mockResolvedValue(undefined),
    broadcast: jest.fn().mockResolvedValue(undefined),
    joinRoom: jest.fn().mockResolvedValue(undefined),
    leaveRoom: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  }
}

describe('CompositeTransport', () => {
  let composite: CompositeTransport
  let sseMock: ReturnType<typeof makeTransportMock>
  let wsMock: ReturnType<typeof makeTransportMock>
  let warnSpy: jest.SpyInstance

  beforeEach(async () => {
    sseMock = makeTransportMock()
    wsMock = makeTransportMock()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeTransport,
        { provide: SseTransport, useValue: sseMock },
        { provide: WebSocketTransport, useValue: wsMock },
      ],
    }).compile()

    composite = module.get(CompositeTransport)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('kind is sse (dominant transport — not both)', () => {
    // CompositeTransport always reports the dominant transport as sse (spec §6.3).
    expect(composite.kind).toBe('sse')
  })

  it('emitToUser calls both sse and ws with identical args', async () => {
    // Both transports must be called on every emit.
    await composite.emitToUser('u-1', 'evt', { v: 1 })
    expect(sseMock.emitToUser).toHaveBeenCalledWith('u-1', 'evt', { v: 1 })
    expect(wsMock.emitToUser).toHaveBeenCalledWith('u-1', 'evt', { v: 1 })
  })

  it('emitToTenant calls both transports with identical args', async () => {
    // Both transports get the same tenantId, event, data.
    await composite.emitToTenant('t-1', 'my-event', [1, 2])
    expect(sseMock.emitToTenant).toHaveBeenCalledWith('t-1', 'my-event', [1, 2])
    expect(wsMock.emitToTenant).toHaveBeenCalledWith('t-1', 'my-event', [1, 2])
  })

  it('emitToRoom calls both transports with identical args', async () => {
    // Both transports get the same roomId, event, data.
    await composite.emitToRoom('room:r', 'upd', null)
    expect(sseMock.emitToRoom).toHaveBeenCalledWith('room:r', 'upd', null)
    expect(wsMock.emitToRoom).toHaveBeenCalledWith('room:r', 'upd', null)
  })

  it('broadcast calls both transports with identical args', async () => {
    // broadcast fans out to both.
    await composite.broadcast('ping', { ts: 1 })
    expect(sseMock.broadcast).toHaveBeenCalledWith('ping', { ts: 1 })
    expect(wsMock.broadcast).toHaveBeenCalledWith('ping', { ts: 1 })
  })

  it('SSE emit rejection does not abort WS emit', async () => {
    // allSettled means a failure in SSE still allows WS to proceed.
    sseMock.emitToUser.mockRejectedValue(new Error('SSE down'))
    await composite.emitToUser('u-1', 'evt', {})
    expect(wsMock.emitToUser).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SSE down'))
  })

  it('WS emit rejection does not abort SSE emit', async () => {
    // allSettled means a failure in WS still allows SSE to proceed.
    wsMock.emitToUser.mockRejectedValue(new Error('WS down'))
    await composite.emitToUser('u-1', 'evt', {})
    expect(sseMock.emitToUser).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WS down'))
  })

  it('joinRoom and leaveRoom reach both transports', async () => {
    // Each transport decides whether it holds the connection; the composite asks both.
    await composite.joinRoom('conn-1', 'room:x')
    await composite.leaveRoom('conn-1', 'room:x')
    expect(sseMock.joinRoom).toHaveBeenCalledWith('conn-1', 'room:x')
    expect(wsMock.joinRoom).toHaveBeenCalledWith('conn-1', 'room:x')
    expect(sseMock.leaveRoom).toHaveBeenCalledWith('conn-1', 'room:x')
    expect(wsMock.leaveRoom).toHaveBeenCalledWith('conn-1', 'room:x')
  })

  it('joinRoom rejects with the failure of the transport that failed', async () => {
    // A failing owner must reach the caller: a client left out of a room it was added to
    // would otherwise be reported as joined.
    wsMock.joinRoom.mockRejectedValue(new Error('ws join failed'))
    await expect(composite.joinRoom('conn-1', 'room:x')).rejects.toThrow('ws join failed')
    expect(sseMock.joinRoom).toHaveBeenCalledWith('conn-1', 'room:x')
  })

  it('leaveRoom rejects with the failure of the transport that failed', async () => {
    // A client that stays in a room it was removed from keeps receiving that room's events.
    wsMock.leaveRoom.mockRejectedValue(new Error('ws leave failed'))
    await expect(composite.leaveRoom('conn-1', 'room:x')).rejects.toThrow('ws leave failed')
    expect(sseMock.leaveRoom).toHaveBeenCalledWith('conn-1', 'room:x')
  })

  it('disconnect asks both transports and resolves when neither fails', async () => {
    // The transport that holds the connection closes it; the other is a no-op.
    await expect(composite.disconnect('conn-1', 'revoked')).resolves.toBeUndefined()
    expect(sseMock.disconnect).toHaveBeenCalledWith('conn-1', 'revoked')
    expect(wsMock.disconnect).toHaveBeenCalledWith('conn-1', 'revoked')
  })

  it('disconnect rejects with the failure of the transport that failed', async () => {
    // A revocation that did not reach the connection is not a success.
    sseMock.disconnect.mockRejectedValue(new Error('sse fail'))
    await expect(composite.disconnect('conn-1')).rejects.toThrow('sse fail')
    expect(wsMock.disconnect).toHaveBeenCalledWith('conn-1', undefined)
  })

  it('disconnect names both failures when both transports fail', async () => {
    sseMock.disconnect.mockRejectedValue(new Error('sse fail'))
    wsMock.disconnect.mockRejectedValue(new Error('ws fail'))
    const failure = await composite.disconnect('conn-1').catch((error: unknown) => error)
    expect((failure as Error).message).toContain('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(((failure as Error).cause as AggregateError).errors.map(String)).toEqual([
      'Error: sse fail',
      'Error: ws fail',
    ])
  })

  it('fanOut logs warn using reason directly when rejected value has no .message', async () => {
    // When the rejection reason is not an Error, the reason itself is used in the warn.
    sseMock.emitToUser.mockRejectedValue('raw-string-reason')
    await composite.emitToUser('u-1', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('partially failed'))
  })

  it('fanOut warn includes the op name emitToTenant', async () => {
    sseMock.emitToTenant.mockRejectedValue(new Error('sse-tenant-down'))
    await composite.emitToTenant('t-1', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('emitToTenant'))
  })

  it('fanOut warn includes the op name emitToRoom', async () => {
    sseMock.emitToRoom.mockRejectedValue(new Error('sse-room-down'))
    await composite.emitToRoom('room:x', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('emitToRoom'))
  })

  it('fanOut warn includes the op name broadcast', async () => {
    sseMock.broadcast.mockRejectedValue(new Error('sse-broadcast-down'))
    await composite.broadcast('evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broadcast'))
  })

  it('fanOut warn includes the op name emitToUser', async () => {
    sseMock.emitToUser.mockRejectedValue(new Error('sse-user-down'))
    await composite.emitToUser('u-1', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('emitToUser'))
  })

  // Kills L89 StringLiteral: `'broadcast'` → `""`.
  // Existing test error contains 'broadcast' so passes mutation; this one uses neutral error msg.
  it('fanOut warn for broadcast names the operation even when the error message does not contain broadcast', async () => {
    sseMock.broadcast.mockRejectedValue(new Error('transport-down'))
    await composite.broadcast('evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broadcast'))
  })

  it('fanOut warn contains the raw rejection reason when the reason has no .message', async () => {
    // Kills ?? → && mutation: without ??, undefined && reason = undefined, not the reason string.
    sseMock.emitToUser.mockRejectedValue('sentinel-reason-value')
    await composite.emitToUser('u-1', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sentinel-reason-value'))
  })
})
