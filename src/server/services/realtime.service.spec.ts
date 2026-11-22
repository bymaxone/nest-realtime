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

describe('RealtimeService readiness', () => {
  // The instance is ready when the bus says it is subscribed, and not ready when it says not.
  it.each([true, false])('reports the bus state %s', (state) => {
    const service = new RealtimeService(mockTransport(), { isSubscribed: () => state } as never)
    expect(service.isPubSubReady()).toBe(state)
  })

  // The bus is asked without arguments: its answer is its own state, not a function of what the caller passes.
  it('asks the bus for its state with no arguments', () => {
    const isSubscribed = jest.fn().mockReturnValue(true)

    new RealtimeService(mockTransport(), { isSubscribed } as never).isPubSubReady()

    expect(isSubscribed).toHaveBeenCalledWith()
  })

  // WebSocket-only wiring never subscribes to the bus, so a bus passed there is not a reason to
  // report the instance unready.
  it('is ready on the websocket transport even when the bus reports not subscribed', () => {
    const transport = {
      ...mockTransport(),
      kind: 'websocket',
    } as unknown as jest.Mocked<ITransport>
    const service = new RealtimeService(transport, { isSubscribed: () => false } as never)
    expect(service.isPubSubReady()).toBe(true)
  })

  // A bus that reports no state (the in-memory one), or none at all, never holds the instance back.
  it.each([
    ['a bus without isSubscribed', {}],
    ['no bus', undefined],
  ])('is ready with %s', (_label, pubsub) => {
    const service = new RealtimeService(mockTransport(), pubsub as never)
    expect(service.isPubSubReady()).toBe(true)
  })
})

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

describe('RealtimeService, with a built-in the library calls replaced', () => {
  // Scenario: each entry that sends, joins, leaves or disconnects is called while one built-in is replaced. Expected: each
  // refuses with the count-only code before the transport is asked, so nothing is delivered or joined.
  it.each([
    ['emitToUser', (s: RealtimeService): Promise<void> => s.emitToUser('u1', 'e', {})],
    ['emitToTenant', (s: RealtimeService): Promise<void> => s.emitToTenant('t1', 'e', {})],
    ['emitToRoom', (s: RealtimeService): Promise<void> => s.emitToRoom('workspace:w1', 'e', {})],
    ['broadcast', (s: RealtimeService): Promise<void> => s.broadcast('e', {})],
    ['joinRoom', (s: RealtimeService): Promise<void> => s.joinRoom('c1', 'workspace:w1')],
    ['leaveRoom', (s: RealtimeService): Promise<void> => s.leaveRoom('c1', 'workspace:w1')],
    ['disconnect', (s: RealtimeService): Promise<void> => s.disconnect('c1')],
  ])('%s refuses first', async (_name, call) => {
    const transport = mockTransport()
    const original = Object.getOwnPropertyDescriptor(Object, 'keys') as PropertyDescriptor
    let code: unknown
    Object.defineProperty(Object, 'keys', { value: () => [], configurable: true, writable: true })
    try {
      await call(new RealtimeService(transport))
    } catch (caught) {
      code = (caught as { code?: string }).code
    } finally {
      Object.defineProperty(Object, 'keys', original)
    }

    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    for (const method of [
      'emitToUser',
      'emitToTenant',
      'emitToRoom',
      'broadcast',
      'joinRoom',
      'leaveRoom',
      'disconnect',
    ] as const) {
      expect(transport[method]).not.toHaveBeenCalled()
    }
  })
})
