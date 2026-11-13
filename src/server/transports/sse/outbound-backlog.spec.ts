/**
 * @fileoverview Unit tests for the bound on what an SSE client may leave unread.
 * @layer transport
 */
import { OutboundBacklog, StallWatch } from './outbound-backlog'
import type { OutboundProbe } from './outbound-backlog'

/** A response whose socket has taken `written` bytes and whose client is, or is not, reading. */
function probe(initial = 0): OutboundProbe & { take(bytes: number): void; hold: number } {
  const state = { written: initial, hold: 0 }
  return {
    written: () => state.written,
    buffered: () => state.hold,
    take: (bytes) => {
      state.written += bytes
    },
    set hold(bytes: number) {
      state.hold = bytes
    },
    get hold() {
      return state.hold
    },
  }
}

describe('OutboundBacklog', () => {
  // The count is the bytes sent and not yet taken by the socket.
  it('refuses an event that would take the queue past the byte bound, and counts nothing for it', () => {
    const backlog = new OutboundBacklog({ maxBytes: 100, maxEvents: 0 }, probe())

    expect(backlog.admit(60)).toBe(true)
    expect(backlog.admit(40)).toBe(true)
    expect(backlog.admit(1)).toBe(false)
    expect(backlog.queuedBytes).toBe(100)
    expect(backlog.queuedEvents).toBe(2)
  })

  it('refuses an event that would take the queue past the event bound', () => {
    const backlog = new OutboundBacklog({ maxBytes: 0, maxEvents: 2 }, probe())

    expect(backlog.admit(1)).toBe(true)
    expect(backlog.admit(1)).toBe(true)
    expect(backlog.admit(1)).toBe(false)
    expect(backlog.queuedEvents).toBe(2)
  })

  // A client that reads is never cut, whatever it receives in total.
  it('forgets what the socket has taken, so a client that keeps up is not cut', () => {
    const socket = probe()
    const backlog = new OutboundBacklog({ maxBytes: 100, maxEvents: 3 }, socket)

    for (let i = 0; i < 1000; i++) {
      expect(backlog.admit(50)).toBe(true)
      socket.take(50)
    }
    expect(backlog.queuedBytes).toBe(0)
    expect(backlog.queuedEvents).toBe(0)
  })

  it('counts an event as taken only once the socket has taken all of it', () => {
    const socket = probe()
    const backlog = new OutboundBacklog({ maxBytes: 0, maxEvents: 0 }, socket)
    backlog.admit(10)
    backlog.admit(10)

    socket.take(15)

    expect(backlog.queuedEvents).toBe(1)
    expect(backlog.queuedBytes).toBe(5)
  })

  // What was written before the connection was tracked (headers, the first events) is not its backlog.
  it('counts from what the socket had taken when tracking began', () => {
    const socket = probe(500)
    const backlog = new OutboundBacklog({ maxBytes: 100, maxEvents: 0 }, socket)

    expect(backlog.admit(80)).toBe(true)
    expect(backlog.queuedBytes).toBe(80)
  })

  // An event that is alone in the queue is always taken, however large.
  it('takes an event larger than the byte bound when nothing else is queued', () => {
    const backlog = new OutboundBacklog({ maxBytes: 100, maxEvents: 0 }, probe())

    expect(backlog.admit(10_000)).toBe(true)
    expect(backlog.admit(1)).toBe(false)
  })

  it('does not bound what has no bound set', () => {
    const backlog = new OutboundBacklog({ maxBytes: 0, maxEvents: 0 }, probe())

    for (let i = 0; i < 5000; i++) expect(backlog.admit(1_000_000)).toBe(true)
    expect(backlog.queuedEvents).toBe(5000)
  })

  it('never reports a negative backlog when the socket has taken more than was sent', () => {
    const socket = probe()
    const backlog = new OutboundBacklog({ maxBytes: 100, maxEvents: 0 }, socket)
    backlog.admit(10)

    socket.take(1000)

    expect(backlog.queuedBytes).toBe(0)
  })

  // The queue is compacted so a long-lived connection does not keep every offset it ever sent.
  it('keeps counting correctly across a long run of events', () => {
    const socket = probe()
    const backlog = new OutboundBacklog({ maxBytes: 0, maxEvents: 0 }, socket)
    for (let i = 0; i < 5000; i++) backlog.admit(1)

    socket.take(4990)

    expect(backlog.queuedEvents).toBe(10)
    expect(backlog.queuedBytes).toBe(10)
    backlog.admit(1)
    expect(backlog.queuedEvents).toBe(11)
  })
})

describe('OutboundBacklog: what it keeps', () => {
  function sendAndTake(sent: number, taken: number): OutboundBacklog {
    const socket = probe()
    const backlog = new OutboundBacklog({ maxBytes: 0, maxEvents: 0 }, socket)
    for (let i = 0; i < sent; i++) backlog.admit(1)
    socket.take(taken)
    backlog.queuedEvents
    return backlog
  }

  // The settled prefix is dropped once it is both long and the larger part of the queue.
  it('drops the settled offsets once they are more than 1024 and more than half of what is held', () => {
    expect(sendAndTake(5000, 4990).retained).toBe(10)
  })

  it('keeps them while they number 1024 or fewer', () => {
    expect(sendAndTake(1030, 1024).retained).toBe(1030)
  })

  it('keeps them while they are no more than half of what is held', () => {
    expect(sendAndTake(4000, 2000).retained).toBe(4000)
    expect(sendAndTake(5000, 1100).retained).toBe(5000)
  })

  it('keeps a short queue whole', () => {
    expect(sendAndTake(15, 10).retained).toBe(15)
  })
})

describe('StallWatch', () => {
  // The first check has nothing to compare with, so it cannot find the socket stuck.
  it('does not count the first check, whatever the socket has already taken', () => {
    const socket = probe(1)
    socket.hold = 10
    const watch = new StallWatch(1)

    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(true)
  })

  // Several checks in a row, not one: a client that is only a little slow is not stalled.
  it('reports a stall only after the configured number of checks with nothing taken and bytes held', () => {
    const socket = probe()
    socket.hold = 10
    const watch = new StallWatch(3)

    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(true)
  })

  it('starts over when the socket takes anything', () => {
    const socket = probe()
    socket.hold = 10
    const watch = new StallWatch(2)
    watch.stalled(socket)
    watch.stalled(socket)

    socket.take(1)

    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(false)
    expect(watch.stalled(socket)).toBe(true)
  })

  it('does not report a stall while the response holds nothing', () => {
    const socket = probe()
    const watch = new StallWatch(1)

    for (let i = 0; i < 10; i++) expect(watch.stalled(socket)).toBe(false)
  })

  it('never reports a stall when the number of checks is 0', () => {
    const socket = probe()
    socket.hold = 10
    const watch = new StallWatch(0)

    for (let i = 0; i < 10; i++) expect(watch.stalled(socket)).toBe(false)
  })
})
