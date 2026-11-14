/**
 * @fileoverview The replay buffer keeps only the users that have, or lately had, a connection here,
 * and no more of the idle ones than it is told to.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { EventReplayBuffer } from './event-replay-buffer'

const event = (id: string): MessageEvent => ({ id, type: 'evt', data: {} })

function bufferWith(sse: BymaxRealtimeModuleOptions['sse'] = {}): EventReplayBuffer {
  return new EventReplayBuffer({
    transport: 'sse',
    authenticator: { authenticate: async () => null },
    sse,
  })
}

/** Every Map the buffer holds: what it keeps per user lives in one of them. */
function held(buffer: object): Array<Map<unknown, unknown>> {
  return Object.values(buffer).filter(
    (value): value is Map<unknown, unknown> => value instanceof Map,
  )
}

const sizes = (buffer: object): number[] => held(buffer).map((map) => map.size)

describe('EventReplayBuffer: the users it keeps', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  // A user that never connected here has nothing to be replayed to, so nothing of theirs is kept.
  it('keeps nothing for 20,000 users that never connected', () => {
    const buffer = bufferWith()

    for (let user = 0; user < 20_000; user++) {
      for (let n = 0; n < 10; n++) buffer.append(`user-${user}`, event(`e${n}`))
    }

    expect(sizes(buffer)).toStrictEqual(sizes(buffer).map(() => 0))
    expect(buffer.size('user-0')).toBe(0)
    expect(buffer.since('user-0', 'e0')).toStrictEqual([])
  })

  it('keeps the events of a user with a connection open, and replays what came after an id', () => {
    const buffer = bufferWith()
    buffer.open('u1')

    for (const id of ['a', 'b', 'c']) buffer.append('u1', event(id))

    expect(buffer.since('u1', 'a').map((e) => e.id)).toStrictEqual(['b', 'c'])
  })

  it('keeps a user until their last connection closes, however many they have open', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000, replayMaxIdleUsers: 1 })
    buffer.open('u1')
    buffer.open('u1')
    buffer.append('u1', event('a'))

    buffer.close('u1')
    jest.advanceTimersByTime(10_000)

    expect(buffer.size('u1')).toBe(1)
  })

  // A user with two tabs open stays live while one of them is: only the last close starts the clock.
  it('starts ageing an entry only when the last of the connections closes', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.open('u1')
    buffer.append('u1', event('a'))

    buffer.close('u1')
    jest.advanceTimersByTime(900)
    buffer.close('u1')
    jest.advanceTimersByTime(999)
    expect(buffer.size('u1')).toBe(1)
    jest.advanceTimersByTime(1)

    expect(buffer.size('u1')).toBe(0)
  })

  // A close the buffer was never told an open for must not count against the connections that
  // are open: a user with one tab left is still live, however many times a close was repeated.
  it('keeps a user with an open connection live after a repeated close', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')
    buffer.close('u1')

    buffer.open('u1')
    buffer.open('u1')
    buffer.close('u1')
    jest.advanceTimersByTime(5_000)

    expect(buffer.size('u1')).toBe(1)
  })

  // The wall clock can be stepped by the host (NTP, a manual change); the idle time is elapsed time.
  it('measures the idle time by elapsed time, not by the wall clock', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')

    jest.setSystemTime(Date.now() + 3_600_000)
    expect(buffer.size('u1')).toBe(1)

    jest.advanceTimersByTime(1_000)
    expect(buffer.size('u1')).toBe(0)
  })

  it('does not expire sooner when the wall clock is stepped back', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')

    jest.setSystemTime(Date.now() - 3_600_000)
    jest.advanceTimersByTime(1_000)

    expect(buffer.size('u1')).toBe(0)
  })

  // Opening on an idle entry revives the ring it already has, with its events; it does not start over.
  it('revives the ring of an idle user who reconnects, with the events it had', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')
    buffer.append('u1', event('b'))

    buffer.open('u1')

    expect(buffer.since('u1', 'a').map((e) => e.id)).toStrictEqual(['b'])
    expect(buffer.size('u1')).toBe(2)
  })

  it('does not expire the entry of a user whose connection is open, however long it stays open', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))

    jest.advanceTimersByTime(3_600_000)
    buffer.append('u1', event('b'))

    expect(buffer.since('u1', 'a').map((e) => e.id)).toStrictEqual(['b'])
  })

  it('keeps the events of a user whose last connection closed for 5 minutes by default, and not longer', () => {
    const buffer = bufferWith()
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')

    jest.advanceTimersByTime(299_999)
    expect(buffer.size('u1')).toBe(1)
    jest.advanceTimersByTime(1)

    expect(buffer.size('u1')).toBe(0)
    expect(sizes(buffer)).toStrictEqual(sizes(buffer).map(() => 0))
  })

  it('keeps events that arrive while the user is away, for a reconnect within the time', () => {
    const buffer = bufferWith({ replayTtlMs: 60_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')
    jest.advanceTimersByTime(30_000)

    buffer.append('u1', event('b'))

    expect(buffer.since('u1', 'a').map((e) => e.id)).toStrictEqual(['b'])
  })

  it('stops ageing an entry whose user reconnects', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')
    jest.advanceTimersByTime(900)

    buffer.open('u1')
    jest.advanceTimersByTime(10_000)

    expect(buffer.size('u1')).toBe(1)
  })

  it('ages an entry from the moment its last connection closed, not from when it was opened', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    jest.advanceTimersByTime(5_000)

    buffer.close('u1')
    jest.advanceTimersByTime(999)

    expect(buffer.size('u1')).toBe(1)
  })

  it('uses sse.replayTtlMs when it is set', () => {
    const buffer = bufferWith({ replayTtlMs: 50 })
    buffer.open('u1')
    buffer.append('u1', event('a'))
    buffer.close('u1')

    jest.advanceTimersByTime(50)

    expect(buffer.size('u1')).toBe(0)
  })

  it('leaves no timer behind: expiry is checked when the buffer is used', () => {
    const buffer = bufferWith({ replayTtlMs: 1_000 })
    for (let user = 0; user < 100; user++) {
      buffer.open(`u${user}`)
      buffer.append(`u${user}`, event('a'))
      buffer.close(`u${user}`)
    }

    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(5_000)
    expect(buffer.size('u0')).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('EventReplayBuffer: the idle users it keeps', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  /** Open a user, give them an event and close them, one millisecond after the last. */
  function visit(buffer: EventReplayBuffer, user: string): void {
    buffer.open(user)
    buffer.append(user, event('a'))
    buffer.close(user)
    jest.advanceTimersByTime(1)
  }

  it('keeps at most replayMaxIdleUsers idle users, the one that closed longest ago going first', () => {
    const buffer = bufferWith({ replayMaxIdleUsers: 3 })

    for (const user of ['u1', 'u2', 'u3', 'u4', 'u5']) visit(buffer, user)

    expect(['u1', 'u2', 'u3', 'u4', 'u5'].map((user) => buffer.size(user))).toStrictEqual([
      0, 0, 1, 1, 1,
    ])
  })

  it('keeps 1,000 idle users by default', () => {
    const buffer = bufferWith()

    for (let user = 0; user < 1_001; user++) visit(buffer, `u${user}`)

    expect(buffer.size('u0')).toBe(0)
    expect(buffer.size('u1')).toBe(1)
    expect(buffer.size('u1000')).toBe(1)
  })

  it('does not count a user with a connection open toward the idle limit', () => {
    const buffer = bufferWith({ replayMaxIdleUsers: 1 })
    buffer.open('live')
    buffer.append('live', event('a'))

    visit(buffer, 'idle')

    expect(buffer.size('live')).toBe(1)
    expect(buffer.size('idle')).toBe(1)
  })

  // The idle limit is about idle entries: a ring with a connection behind it is bounded by the
  // connections, and is never evicted to make room.
  it('opens a new live user, and evicts neither a live ring nor the idle entry, when the idle limit is full', () => {
    const buffer = bufferWith({ replayMaxIdleUsers: 1 })
    visit(buffer, 'idle')
    const live = ['u1', 'u2', 'u3', 'u4', 'u5']
    for (const user of live) {
      buffer.open(user)
      buffer.append(user, event('a'))
    }

    buffer.open('u6')
    buffer.append('u6', event('a'))

    expect(['idle', ...live, 'u6'].map((user) => buffer.size(user))).toStrictEqual([
      1, 1, 1, 1, 1, 1, 1,
    ])
  })

  it('evicts the oldest idle entry, not a live one, when a user goes idle past the limit', () => {
    const buffer = bufferWith({ replayMaxIdleUsers: 1 })
    buffer.open('live')
    buffer.append('live', event('a'))
    visit(buffer, 'first')

    visit(buffer, 'second')

    expect(buffer.size('live')).toBe(1)
    expect(buffer.size('first')).toBe(0)
    expect(buffer.size('second')).toBe(1)
  })

  it('takes a user that reconnects out of the idle entries', () => {
    const buffer = bufferWith({ replayMaxIdleUsers: 2 })
    visit(buffer, 'u1')
    visit(buffer, 'u2')
    buffer.open('u1')

    visit(buffer, 'u3')
    visit(buffer, 'u4')

    expect(['u1', 'u2', 'u3', 'u4'].map((user) => buffer.size(user))).toStrictEqual([1, 0, 1, 1])
  })

  it('ignores the closing of a user it has no entry for', () => {
    const buffer = bufferWith()

    expect(() => buffer.close('nobody')).not.toThrow()
    expect(sizes(buffer)).toStrictEqual(sizes(buffer).map(() => 0))
  })

  it('still keeps no more than replayBufferSize events of a user', () => {
    const buffer = bufferWith({ replayBufferSize: 2 })
    buffer.open('u1')

    for (const id of ['a', 'b', 'c']) buffer.append('u1', event(id))

    expect(buffer.since('u1', 'b').map((e) => e.id)).toStrictEqual(['c'])
    expect(buffer.since('u1', 'a')).toStrictEqual([])
  })
})
