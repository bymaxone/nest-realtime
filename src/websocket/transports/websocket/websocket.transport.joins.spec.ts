/**
 * @fileoverview A built-in replaced while a connection is being joined to its rooms, or while a message is sent, does not widen who is reached.
 * @layer transport
 *
 * Admission checks the rooms once, and the join happens after `await`s: a host that replaces the iterator, or a method the
 * join reads, between two of them would otherwise change what the loop yields, after the check.
 */
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import {
  AuthenticationGate,
  ConnectionRegistry,
  RoomRegistry,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from './websocket.transport'

type Joined = string[]

/** A socket whose `join` records the room, and runs `between` once, inside the first `await`, as a host's code could. */
function makeSocket(joined: Joined, between: () => void) {
  let calls = 0
  return {
    id: 'sock-1',
    handshake: { address: '127.0.0.1', headers: { 'user-agent': 'test' } },
    join: async (room: string): Promise<void> => {
      joined[joined.length] = room
      calls += 1
      if (calls === 1) between()
      await Promise.resolve()
    },
    leave: async (): Promise<void> => undefined,
    disconnect: () => undefined,
  }
}

describe('WebSocketTransport, with a built-in replaced after admission', () => {
  let transport: WebSocketTransport
  let rooms: RoomRegistry

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WebSocketTransport,
        ConnectionRegistry,
        RoomRegistry,
        AuthenticationGate,
        { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: { authenticate: async () => null } },
        { provide: REALTIME_HOOKS_TOKEN, useValue: {} },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: {} },
      ],
    }).compile()
    transport = module.get(WebSocketTransport)
    rooms = module.get(RoomRegistry)
  })

  // Scenario: the iterator of arrays is replaced, inside the first `await` of the join, by one that yields a room of another
  // tenant for the admitted list. Expected: that room is never joined, in the socket or in the registry, and the join is
  // refused with the count-only error.
  it('does not join a room an iterator yields after admission', async () => {
    const admitted = Object.freeze(['workspace:w1'])
    const original = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    ) as PropertyDescriptor
    const joined: Joined = []
    const socket = makeSocket(joined, () => {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        value: function (this: unknown[]): Iterator<string> {
          const source = this === (admitted as unknown) ? ['tenant:t2'] : this
          return (original.value as () => Iterator<string>).call(source)
        },
        configurable: true,
        writable: true,
      })
    })
    let error: unknown
    try {
      await transport.registerSocket(socket as never, {
        userId: 'u-1',
        tenantId: 't1',
        rooms: admitted,
      })
    } catch (caught) {
      error = caught
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, original)
    }

    expect(joined).not.toContain('tenant:t2')
    expect(rooms.roomsOf('sock-1')).not.toContain('tenant:t2')
    expect((error as { code?: string } | undefined)?.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })

  // Scenario: a built-in the library calls is replaced after the first join of the list and the rest follow. Expected: each
  // `join` is preceded by the check, so none of the remaining rooms is joined once something was replaced.
  it('stops joining the rest of the list once a built-in was replaced', async () => {
    const joined: Joined = []
    const original = Object.getOwnPropertyDescriptor(
      String.prototype,
      'startsWith',
    ) as PropertyDescriptor
    const socket = makeSocket(joined, () => {
      Object.defineProperty(String.prototype, 'startsWith', {
        value: () => false,
        configurable: true,
        writable: true,
      })
    })
    let error: unknown
    try {
      await transport.registerSocket(socket as never, {
        userId: 'u-1',
        tenantId: 't1',
        rooms: Object.freeze(['workspace:w1', 'workspace:w2']),
      })
    } catch (caught) {
      error = caught
    } finally {
      Object.defineProperty(String.prototype, 'startsWith', original)
    }

    expect(joined).toHaveLength(1)
    expect((error as { code?: string } | undefined)?.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })

  // Scenario: a built-in is replaced and a room is joined by the API. Expected: refused before either join.
  it('joinRoom refuses while a built-in is replaced, and joins nothing', async () => {
    const joined: Joined = []
    const socket = makeSocket(joined, () => undefined)
    transport.setServer({ sockets: { sockets: new Map([['sock-1', socket]]) } } as never)
    const original = Object.getOwnPropertyDescriptor(
      Array.prototype,
      'includes',
    ) as PropertyDescriptor
    let code: unknown
    Object.defineProperty(Array.prototype, 'includes', {
      value: () => false,
      configurable: true,
      writable: true,
    })
    try {
      await transport.joinRoom('sock-1', 'workspace:w9')
    } catch (caught) {
      code = (caught as { code?: string }).code
    } finally {
      Object.defineProperty(Array.prototype, 'includes', original)
    }

    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(joined).toHaveLength(0)
  })

  // Scenario: a built-in is replaced and a message is sent through each emit entry of the transport. Expected: each refuses,
  // and none reaches the server.
  it.each([
    ['emitToUser', (): Promise<void> => transport.emitToUser('u-1', 'e', {})],
    ['emitToTenant', (): Promise<void> => transport.emitToTenant('t1', 'e', {})],
    ['emitToRoom', (): Promise<void> => transport.emitToRoom('workspace:w1', 'e', {})],
    ['broadcast', (): Promise<void> => transport.broadcast('e', {})],
  ])('%s refuses while a built-in is replaced', async (_name, send) => {
    const to = jest.fn().mockReturnValue({ emit: jest.fn() })
    const emit = jest.fn()
    transport.setServer({ to, emit, sockets: { sockets: new Map() } } as never)
    const original = Object.getOwnPropertyDescriptor(Object, 'keys') as PropertyDescriptor
    let code: unknown
    Object.defineProperty(Object, 'keys', { value: () => [], configurable: true, writable: true })
    try {
      await send()
    } catch (caught) {
      code = (caught as { code?: string }).code
    } finally {
      Object.defineProperty(Object, 'keys', original)
    }

    expect(code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(to).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
