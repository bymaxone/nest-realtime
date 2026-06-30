/**
 * @fileoverview Cross-instance fan-out e2e — two in-process SSE transports sharing InMemoryPubSub.
 * @layer e2e
 */
import { createTestInstances } from '../helpers/create-test-instance'

/**
 * Wait for `condition` to become true (polls every 5ms up to 500ms).
 * Used to allow the async pub/sub deferred microtask to propagate.
 */
async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('Cross-instance fan-out', () => {
  // An emit on instance A reaches a connection registered on instance B.
  it('delivers emitToUser from instance A to a connection on instance B', async () => {
    const { instances } = createTestInstances(2)
    const [a, b] = instances as [typeof instances[0], typeof instances[0]]
    await a.subscriber.onModuleInit()
    await b.subscriber.onModuleInit()

    const received = b.addConnection('c1', 'u1')
    await a.transport.emitToUser('u1', 'hello', { text: 'hi' })

    await waitFor(() => received.length > 0)
    expect(received[0]?.type).toBe('hello')

    await a.shutdown()
    await b.shutdown()
  })

  // broadcast from instance A reaches connections on both instances.
  it('broadcast from A reaches connections on both A and B', async () => {
    const { instances } = createTestInstances(2)
    const [a, b] = instances as [typeof instances[0], typeof instances[0]]
    await a.subscriber.onModuleInit()
    await b.subscriber.onModuleInit()

    const recvA = a.addConnection('c-a', 'u1')
    const recvB = b.addConnection('c-b', 'u2')

    await a.transport.broadcast('ping', {})

    await waitFor(() => recvA.length > 0 && recvB.length > 0)
    expect(recvA[0]?.type).toBe('ping')
    expect(recvB[0]?.type).toBe('ping')

    await a.shutdown()
    await b.shutdown()
  })

  // Echo prevention: messages originating from instance B are not re-delivered on B.
  it('does not echo messages back to the originating instance', async () => {
    const { instances } = createTestInstances(2)
    const [a, b] = instances as [typeof instances[0], typeof instances[0]]
    await a.subscriber.onModuleInit()
    await b.subscriber.onModuleInit()

    const recvB = b.addConnection('c-b', 'u1')
    await b.transport.emitToUser('u1', 'x', {})

    // Allow the pub/sub microtask to propagate.
    await new Promise((r) => setTimeout(r, 20))
    // Connection on B receives one event directly (local), never twice (no echo).
    expect(recvB).toHaveLength(1)

    await a.shutdown()
    await b.shutdown()
  })

  // A cross-instance disconnect closes the remote connection.
  it('disconnect from A closes a connection registered on B', async () => {
    const { instances } = createTestInstances(2)
    const [a, b] = instances as [typeof instances[0], typeof instances[0]]
    await a.subscriber.onModuleInit()
    await b.subscriber.onModuleInit()

    b.addConnection('c-remote', 'u1')
    await a.transport.disconnect('c-remote')

    await waitFor(() => b.transport.getConnection('c-remote') === undefined)
    expect(b.transport.getConnection('c-remote')).toBeUndefined()

    await a.shutdown()
    await b.shutdown()
  })
})
