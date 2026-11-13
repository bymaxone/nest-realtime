/**
 * @fileoverview Unit tests for the SSE transport closing a connection whose client does not read.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { build } from '../../../../test/fixtures/sse/transport-harness'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import type { OutboundProbe } from './outbound-backlog'

/** A response that has taken nothing and holds `held` bytes, as one whose client stopped reading does. */
function stuck(held = 10): OutboundProbe {
  return { written: () => 0, buffered: () => held }
}

describe('SseTransport: a client that does not read', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  async function register(
    transport: ReturnType<typeof build>['transport'],
    connectionId: string,
    outbound?: OutboundProbe,
  ): Promise<MessageEvent[]> {
    const received: MessageEvent[] = []
    const subject = new Subject<MessageEvent>()
    subject.subscribe((event) => received.push(event))
    await transport.registerConnection({
      connectionId,
      auth: { userId: 'u1' },
      subject,
      close$: new Subject<void>(),
      ip: '127.0.0.1',
      userAgent: undefined,
      outbound,
    })
    return received
  }

  // The event that would cross the bound is not queued: what is held stays at the bound.
  it('refuses the event that crosses the bound, closes with the slow-consumer reason, and logs it', async () => {
    const reasons: Array<string | undefined> = []
    const { transport, connections } = build({
      sse: { maxQueuedEvents: 2 },
      hooks: { onDisconnect: (meta) => void reasons.push(meta.reason) },
    })
    const received = await register(transport, 'slow', stuck())

    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToUser('u1', 'e', 2)
    await transport.emitToUser('u1', 'e', 3)

    expect(received).toHaveLength(2)
    expect(connections.get('slow')).toBeUndefined()
    expect(reasons).toStrictEqual([REALTIME_ERROR_CODES.SLOW_CONSUMER])
    expect(warn).toHaveBeenCalledWith(
      `${REALTIME_ERROR_CODES.SLOW_CONSUMER}: closing SSE connection slow, its client has not read what was sent ` +
        '(2 events, 44 bytes queued, 10 bytes held by the response)',
    )
  })

  it('closes only that connection: another receives the event', async () => {
    const { transport, connections } = build({ sse: { maxQueuedEvents: 1 } })
    await register(transport, 'slow', stuck())
    const fine: MessageEvent[] = await register(transport, 'fine', undefined)

    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToUser('u1', 'e', 2)

    expect(connections.get('slow')).toBeUndefined()
    expect(fine).toHaveLength(2)
  })

  it('does not bound a connection whose response cannot be measured', async () => {
    const { transport, connections } = build({ sse: { maxQueuedEvents: 1, maxQueuedBytes: 1 } })
    const received = await register(transport, 'unmeasured', undefined)

    for (let i = 0; i < 50; i++) await transport.emitToUser('u1', 'e', i)

    expect(received).toHaveLength(50)
    expect(connections.get('unmeasured')).toBeDefined()
  })

  it('does not bound a connection when no bound is configured', async () => {
    const { transport, connections } = build()
    await register(transport, 'open', stuck())

    for (let i = 0; i < 50; i++) await transport.emitToUser('u1', 'e', i)

    expect(connections.get('open')).toBeDefined()
  })

  // `JSON.stringify(undefined)` is `undefined`, not a string: an event with no data weighs nothing.
  it('takes an event that has no data', async () => {
    const { transport, connections } = build({ sse: { maxQueuedBytes: 42 } })
    const received = await register(transport, 'c1', stuck())

    await transport.emitToUser('u1', 'e', undefined)
    await transport.emitToUser('u1', 'e', undefined)

    expect(received).toHaveLength(2)
    expect(connections.get('c1')).toBeDefined()
  })

  // The size is read from the payload, which a consumer controls: one that cannot be serialised
  // fails for the connection whose backlog is bounded, is logged, and does not stop the event
  // reaching the other connections.
  it('isolates a payload that cannot be serialised: it fails for the bounded connection and the others still receive it', async () => {
    const { transport } = build({ sse: { maxQueuedBytes: 1_000_000 } })
    const bounded = await register(transport, 'a', stuck())
    const unbounded = await register(transport, 'b', undefined)
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(transport.emitToUser('u1', 'e', circular)).resolves.toBeUndefined()

    expect(bounded).toHaveLength(0)
    expect(unbounded).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SSE delivery failed for a'))
  })

  // Nest writes a string as it is, so its quotes and escapes are not on the wire and must not be counted.
  it('counts a string payload as it is written, not as JSON', async () => {
    const { transport, connections } = build({ sse: { maxQueuedBytes: 48 } })
    const received = await register(transport, 'c1', stuck())

    await transport.emitToUser('u1', 'e', 'a"b')
    await transport.emitToUser('u1', 'e', 'a"b')

    expect(received).toHaveLength(2)
    expect(connections.get('c1')).toBeDefined()
  })

  // The frame carries the event name and the id as well as the data, so they count toward the bound.
  it('counts the event name and the id, which are written, with line breaks removed as they are', async () => {
    const { transport, connections } = build({ sse: { maxQueuedBytes: 6000 } })
    await register(transport, 'a', stuck())
    await register(transport, 'b', stuck())

    await transport.emitToUser('u1', 'x'.repeat(5000), 1)
    await transport.emitToUser('u1', 'y'.repeat(5000), 1)

    expect(connections.get('a')).toBeUndefined()
    expect(connections.get('b')).toBeUndefined()
  })

  it('counts an event name written without its line breaks', async () => {
    const { transport, connections } = build({ sse: { maxQueuedBytes: 46 } })
    const received = await register(transport, 'a', stuck())

    await transport.emitToUser('u1', 'a\r\nb', 1)
    await transport.emitToUser('u1', 'a\r\nb', 1)

    expect(received).toHaveLength(2)
    expect(connections.get('a')).toBeDefined()
  })

  it('counts an event once however many connections receive it', async () => {
    const { transport } = build({ sse: { maxQueuedBytes: 1_000_000 } })
    const spy = jest.spyOn(JSON, 'stringify')
    for (let i = 0; i < 5; i++) await register(transport, `c${i}`, stuck())

    await transport.broadcast('e', { a: 1 })

    expect(spy.mock.calls.filter(([value]) => JSON.stringify(value) === '{"a":1}')).toHaveLength(1)
  })

  describe('checkStall', () => {
    it('closes the connection after the configured number of heartbeats with nothing taken', async () => {
      const reasons: Array<string | undefined> = []
      const { transport, connections } = build({
        sse: { stallHeartbeats: 2 },
        hooks: { onDisconnect: (meta) => void reasons.push(meta.reason) },
      })
      await register(transport, 'slow', stuck())

      transport.checkStall('slow')
      transport.checkStall('slow')
      expect(connections.get('slow')).toBeDefined()
      transport.checkStall('slow')
      await new Promise((resolve) => setImmediate(resolve))

      expect(connections.get('slow')).toBeUndefined()
      expect(reasons).toStrictEqual([REALTIME_ERROR_CODES.SLOW_CONSUMER])
      expect(warn).toHaveBeenCalledWith(
        `${REALTIME_ERROR_CODES.SLOW_CONSUMER}: closing SSE connection slow, its socket has taken nothing for several heartbeats ` +
          '(0 events, 0 bytes queued, 10 bytes held by the response)',
      )
    })

    it('does nothing for a connection it does not track', async () => {
      const { transport } = build({ sse: { stallHeartbeats: 1 } })

      expect(() => transport.checkStall('unknown')).not.toThrow()
    })

    it('stops tracking a connection once it is unregistered', async () => {
      const { transport } = build({ sse: { stallHeartbeats: 1 } })
      await register(transport, 'gone', stuck())
      await transport.unregisterConnection('gone')

      transport.checkStall('gone')
      transport.checkStall('gone')

      expect(warn).not.toHaveBeenCalled()
    })
  })

  it('reports a failure to close a slow connection instead of throwing', async () => {
    const { transport } = build({ sse: { maxQueuedEvents: 1 } })
    jest.spyOn(transport, 'disconnectLocal').mockRejectedValue(new Error('close failed'))
    await register(transport, 'slow', stuck())

    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToUser('u1', 'e', 2)
    await new Promise((resolve) => setImmediate(resolve))

    expect(warn).toHaveBeenCalledWith('Closing slow SSE connection slow failed: close failed')
  })
})
