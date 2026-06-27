/**
 * @fileoverview Unit tests asserting RealtimeService delegates to the transport.
 * @layer application
 */
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeService } from './realtime.service'

function mockTransport(): jest.Mocked<ITransport> {
  return {
    kind: 'sse',
    emitToUser: jest.fn().mockResolvedValue(undefined),
    emitToTenant: jest.fn().mockResolvedValue(undefined),
    emitToRoom: jest.fn().mockResolvedValue(undefined),
    broadcast: jest.fn().mockResolvedValue(undefined),
    joinRoom: jest.fn().mockResolvedValue(undefined),
    leaveRoom: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ITransport>
}

describe('RealtimeService', () => {
  let transport: jest.Mocked<ITransport>
  let service: RealtimeService

  beforeEach(() => {
    transport = mockTransport()
    service = new RealtimeService(transport)
  })

  // emitToUser forwards its arguments unchanged.
  it('delegates emitToUser', async () => {
    await service.emitToUser('u1', 'evt', { a: 1 })
    expect(transport.emitToUser).toHaveBeenCalledWith('u1', 'evt', { a: 1 })
  })

  // emitToTenant forwards its arguments unchanged.
  it('delegates emitToTenant', async () => {
    await service.emitToTenant('t1', 'evt', { a: 1 })
    expect(transport.emitToTenant).toHaveBeenCalledWith('t1', 'evt', { a: 1 })
  })

  // emitToRoom forwards its arguments unchanged.
  it('delegates emitToRoom', async () => {
    await service.emitToRoom('room:a', 'evt', { a: 1 })
    expect(transport.emitToRoom).toHaveBeenCalledWith('room:a', 'evt', { a: 1 })
  })

  // broadcast forwards its arguments unchanged.
  it('delegates broadcast', async () => {
    await service.broadcast('evt', { a: 1 })
    expect(transport.broadcast).toHaveBeenCalledWith('evt', { a: 1 })
  })

  // joinRoom forwards its arguments unchanged.
  it('delegates joinRoom', async () => {
    await service.joinRoom('c1', 'room:a')
    expect(transport.joinRoom).toHaveBeenCalledWith('c1', 'room:a')
  })

  // leaveRoom forwards its arguments unchanged.
  it('delegates leaveRoom', async () => {
    await service.leaveRoom('c1', 'room:a')
    expect(transport.leaveRoom).toHaveBeenCalledWith('c1', 'room:a')
  })

  // disconnect forwards the connection id and optional reason.
  it('delegates disconnect', async () => {
    await service.disconnect('c1', 'bye')
    expect(transport.disconnect).toHaveBeenCalledWith('c1', 'bye')
  })
})
