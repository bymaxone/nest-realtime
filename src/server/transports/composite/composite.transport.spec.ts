/**
 * @fileoverview Unit tests for CompositeTransport fan-out and failure tolerance.
 * @layer transport
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { SseTransport } from '../sse/sse.transport'
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

  it('joinRoom resolves when SSE rejects and WS succeeds', async () => {
    // Only the owning transport succeeds; the other rejection is tolerated.
    sseMock.joinRoom.mockRejectedValue(new Error('not SSE'))
    await expect(composite.joinRoom('conn-1', 'room:x')).resolves.toBeUndefined()
    expect(wsMock.joinRoom).toHaveBeenCalledWith('conn-1', 'room:x')
  })

  it('joinRoom resolves even when both transports reject', async () => {
    // Both failing is tolerated — the composite never throws from joinRoom.
    sseMock.joinRoom.mockRejectedValue(new Error('sse fail'))
    wsMock.joinRoom.mockRejectedValue(new Error('ws fail'))
    await expect(composite.joinRoom('conn-1', 'room:x')).resolves.toBeUndefined()
  })

  it('leaveRoom resolves when one side rejects', async () => {
    // Tolerance applies to leaveRoom too.
    wsMock.leaveRoom.mockRejectedValue(new Error('ws fail'))
    await expect(composite.leaveRoom('conn-1', 'room:x')).resolves.toBeUndefined()
    expect(sseMock.leaveRoom).toHaveBeenCalledWith('conn-1', 'room:x')
  })

  it('disconnect resolves when one side rejects', async () => {
    // Tolerance applies to disconnect.
    sseMock.disconnect.mockRejectedValue(new Error('sse fail'))
    await expect(composite.disconnect('conn-1')).resolves.toBeUndefined()
    expect(wsMock.disconnect).toHaveBeenCalledWith('conn-1', undefined)
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

  it('fanOut warn contains the raw rejection reason when the reason has no .message', async () => {
    // Kills ?? → && mutation: without ??, undefined && reason = undefined, not the reason string.
    sseMock.emitToUser.mockRejectedValue('sentinel-reason-value')
    await composite.emitToUser('u-1', 'evt', {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sentinel-reason-value'))
  })
})
