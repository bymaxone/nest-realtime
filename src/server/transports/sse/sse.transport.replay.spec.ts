/**
 * @fileoverview What the SSE transport keeps for replay: the events of users that have, or lately had,
 * a connection on this instance.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { build } from '../../../../test/fixtures/sse/transport-harness'
import type { SseTransport } from './sse.transport'

async function register(transport: SseTransport, id: string, userId: string): Promise<void> {
  await transport.registerConnection({
    connectionId: id,
    auth: { userId },
    subject: new Subject<MessageEvent>(),
    close$: new Subject<void>(),
    ip: '127.0.0.1',
    userAgent: undefined,
  })
}

describe('SseTransport: the events it keeps for replay', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  // Nothing would ever replay it to them: a user that never connected here is not buffered, however
  // many events are emitted to them (or reach this instance from the others).
  it('keeps nothing for a user that has no connection here', async () => {
    const { transport, replay } = build()

    for (let n = 0; n < 5; n++) await transport.emitToUser('nobody', 'e', { n })
    transport.emitToUserLocal('nobody', 'e', {}, 'remote-1')

    expect(replay.size('nobody')).toBe(0)
  })

  it('keeps the events of a user with a connection here', async () => {
    const { transport, replay } = build()
    await register(transport, 'c1', 'u1')

    await transport.emitToUser('u1', 'e', { n: 1 })
    await transport.emitToUser('u1', 'e', { n: 2 })

    expect(replay.size('u1')).toBe(2)
  })

  it('keeps the events of a user whose connection closed, for a reconnect within the time', async () => {
    const { transport, replay } = build()
    await register(transport, 'c1', 'u1')
    const first = replay.size('u1')
    await transport.emitToUser('u1', 'e', { n: 1 })
    const before = transport.getReplayEvents('u1', 'nothing')
    await transport.disconnectLocal('c1')

    await transport.emitToUser('u1', 'e', { n: 2 })

    expect(first).toBe(0)
    expect(before).toStrictEqual([])
    expect(replay.size('u1')).toBe(2)
  })

  it('stops keeping them once the connection has been closed for the time', async () => {
    const { transport, replay } = build({ sse: { replayTtlMs: 1_000 } })
    await register(transport, 'c1', 'u1')
    await transport.emitToUser('u1', 'e', { n: 1 })
    await transport.disconnectLocal('c1')

    jest.advanceTimersByTime(1_000)

    expect(replay.size('u1')).toBe(0)
  })

  it('keeps a user while any of their connections is open', async () => {
    const { transport, replay } = build({ sse: { replayTtlMs: 1_000 } })
    await register(transport, 'c1', 'u1')
    await register(transport, 'c2', 'u1')
    await transport.emitToUser('u1', 'e', { n: 1 })

    await transport.disconnectLocal('c1')
    jest.advanceTimersByTime(60_000)

    expect(replay.size('u1')).toBe(1)
  })

  it('closes a user once, not once for each way the connection can be closed', async () => {
    const { transport, replay } = build({ sse: { replayTtlMs: 1_000 } })
    await register(transport, 'c1', 'u1')
    await register(transport, 'c2', 'u1')
    await transport.emitToUser('u1', 'e', { n: 1 })

    await transport.disconnectLocal('c1')
    await transport.unregisterConnection('c1')
    await transport.disconnectLocal('c1')
    jest.advanceTimersByTime(60_000)

    expect(replay.size('u1')).toBe(1)
  })

  it('stops keeping the events of a user whose connection shutdown closed, once the time has passed', async () => {
    const { transport, replay } = build({ sse: { replayTtlMs: 1_000 } })
    await register(transport, 'c1', 'u1')
    await transport.emitToUser('u1', 'e', { n: 1 })

    await transport.beforeApplicationShutdown()
    jest.advanceTimersByTime(1_000)

    expect(replay.size('u1')).toBe(0)
  })
})
