/**
 * @fileoverview A built-in replaced after admission, or while a message is delivered, does not widen who is reached on SSE.
 * @layer transport
 *
 * The handler admits a connection and then awaits (the replay, the queue) before the transport registers it and joins its
 * rooms; delivery to a room, a user, a tenant or everyone walks the registries. A host that replaces a built-in in that
 * window must be refused, not served with a room it was never admitted to.
 */
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { addConn, build } from '../../../../test/fixtures/sse/transport-harness'

const CODE = 'REALTIME_TRANSPORT_UNAVAILABLE'

/** Runs `run` with `Object.keys` replaced, and puts it back; whatever `run` throws is returned. */
function whileKeysReplaced(run: () => unknown): { thrown?: unknown } {
  const original = Object.getOwnPropertyDescriptor(Object, 'keys') as PropertyDescriptor
  Object.defineProperty(Object, 'keys', { value: () => [], configurable: true, writable: true })
  const outcome: { thrown?: unknown } = {}
  try {
    run()
  } catch (caught) {
    outcome.thrown = caught
  } finally {
    Object.defineProperty(Object, 'keys', original)
  }
  return outcome
}

/** The same for a call that returns a promise: the rejection is awaited before the built-in is put back. */
async function whileKeysReplacedAsync(run: () => Promise<unknown>): Promise<{ thrown?: unknown }> {
  const original = Object.getOwnPropertyDescriptor(Object, 'keys') as PropertyDescriptor
  Object.defineProperty(Object, 'keys', { value: () => [], configurable: true, writable: true })
  const outcome: { thrown?: unknown } = {}
  try {
    await run()
  } catch (caught) {
    outcome.thrown = caught
  } finally {
    Object.defineProperty(Object, 'keys', original)
  }
  return outcome
}

describe('SseTransport, with a built-in replaced after admission', () => {
  // Scenario: the iterator of arrays is replaced, after admission and before the connection is registered, by one that yields
  // a room of another tenant for the admitted list. Expected: the connection is refused with the count-only code, is not
  // registered, and is in no room.
  it('does not join a room an iterator yields after admission', async () => {
    const { transport, connections, rooms } = build()
    const admitted = Object.freeze(['workspace:w1'])
    const original = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    ) as PropertyDescriptor
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      value: function (this: unknown[]): Iterator<string> {
        const source = this === (admitted as unknown) ? ['tenant:t2'] : this
        return (original.value as () => Iterator<string>).call(source)
      },
      configurable: true,
      writable: true,
    })
    let error: unknown
    try {
      await transport.registerConnection({
        connectionId: 'c1',
        auth: { userId: 'u1', tenantId: 't1', rooms: admitted },
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        ip: '127.0.0.1',
        userAgent: undefined,
      })
    } catch (caught) {
      error = caught
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, original)
    }

    expect(rooms.members('tenant:t2')).toStrictEqual([])
    expect(rooms.roomsOf('c1')).toStrictEqual([])
    expect(connections.get('c1')).toBeUndefined()
    expect((error as { code?: string } | undefined)?.code).toBe(CODE)
  })

  // Scenario: a built-in is replaced and a connection with several rooms is registered. Expected: refused before any join.
  it('joins no room of a connection registered while a built-in is replaced', async () => {
    const { transport, rooms } = build()
    const outcome = await whileKeysReplacedAsync(() =>
      transport.registerConnection({
        connectionId: 'c1',
        auth: {
          userId: 'u1',
          tenantId: 't1',
          rooms: Object.freeze(['workspace:w1', 'workspace:w2']),
        },
        subject: new Subject<MessageEvent>(),
        close$: new Subject<void>(),
        ip: '127.0.0.1',
        userAgent: undefined,
      }),
    )

    expect((outcome.thrown as { code?: string } | undefined)?.code).toBe(CODE)
    expect(rooms.roomsOf('c1')).toStrictEqual([])
  })
})

describe('SseTransport, with a built-in replaced while a message is sent', () => {
  // Scenario: each entry that sends, joins, leaves or disconnects is called while a built-in is replaced. Expected: each
  // refuses with the count-only code, and nothing is delivered.
  it.each([
    ['emitToUser', (t: ReturnType<typeof build>['transport']) => t.emitToUser('u1', 'e', {})],
    ['emitToTenant', (t: ReturnType<typeof build>['transport']) => t.emitToTenant('t1', 'e', {})],
    [
      'emitToRoom',
      (t: ReturnType<typeof build>['transport']) => t.emitToRoom('workspace:w1', 'e', {}),
    ],
    ['broadcast', (t: ReturnType<typeof build>['transport']) => t.broadcast('e', {})],
    ['joinRoom', (t: ReturnType<typeof build>['transport']) => t.joinRoom('c1', 'workspace:w1')],
    ['leaveRoom', (t: ReturnType<typeof build>['transport']) => t.leaveRoom('c1', 'workspace:w1')],
    ['disconnect', (t: ReturnType<typeof build>['transport']) => t.disconnect('c1')],
    ['disconnectLocal', (t: ReturnType<typeof build>['transport']) => t.disconnectLocal('c1')],
  ])('%s refuses first', async (_name, call) => {
    const { transport, connections, rooms, publish } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1', tenantId: 't1' })
    rooms.join('c1', 'workspace:w1')

    const outcome = await whileKeysReplacedAsync(() => call(transport))

    expect((outcome.thrown as { code?: string } | undefined)?.code).toBe(CODE)
    expect(received).toHaveLength(0)
    expect(publish).not.toHaveBeenCalled()
    expect(rooms.members('workspace:w1')).toStrictEqual(['c1'])
  })

  // Scenario: the entries a message from another instance goes through are called while a built-in is replaced. Expected:
  // each throws the count-only code before it reads a registry, and delivers nothing.
  it.each([
    [
      'emitToUserLocal',
      (t: ReturnType<typeof build>['transport']) => t.emitToUserLocal('u1', 'e', {}, 'id-1'),
    ],
    [
      'emitToTenantLocal',
      (t: ReturnType<typeof build>['transport']) => t.emitToTenantLocal('t1', 'e', {}, 'id-1'),
    ],
    [
      'emitToRoomLocal',
      (t: ReturnType<typeof build>['transport']) =>
        t.emitToRoomLocal('workspace:w1', 'e', {}, 'id-1'),
    ],
    [
      'broadcastLocal',
      (t: ReturnType<typeof build>['transport']) => t.broadcastLocal('e', {}, 'id-1'),
    ],
  ])('%s throws first', (_name, call) => {
    const { transport, connections, rooms } = build()
    const { received } = addConn(connections, { connectionId: 'c1', userId: 'u1', tenantId: 't1' })
    rooms.join('c1', 'workspace:w1')

    const outcome = whileKeysReplaced(() => call(transport))

    expect((outcome.thrown as { code?: string } | undefined)?.code).toBe(CODE)
    expect(received).toHaveLength(0)
  })
})
