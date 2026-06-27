/**
 * @fileoverview Unit tests for the per-user replay ring buffer.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { EventReplayBuffer } from './event-replay-buffer'

const authenticator = { authenticate: async () => null }

function mkEvent(id: string): MessageEvent {
  return { id, type: 'evt', data: {} }
}

function bufferWith(replayBufferSize?: number): EventReplayBuffer {
  const options = {
    transport: 'sse',
    authenticator,
    ...(replayBufferSize === undefined ? {} : { sse: { replayBufferSize } }),
  } as BymaxRealtimeModuleOptions
  return new EventReplayBuffer(options)
}

describe('EventReplayBuffer', () => {
  // append stores events and size reports the count.
  it('appends events for a user', () => {
    const buf = bufferWith(10)
    buf.append('u1', mkEvent('a'))
    buf.append('u1', mkEvent('b'))
    expect(buf.size('u1')).toBe(2)
  })

  // since returns the events emitted after the given id.
  it('returns events after the given id', () => {
    const buf = bufferWith(10)
    buf.append('u1', mkEvent('a'))
    buf.append('u1', mkEvent('b'))
    buf.append('u1', mkEvent('c'))
    expect(buf.since('u1', 'a').map((e) => e.id)).toEqual(['b', 'c'])
  })

  // A missing last-event id (gap) returns an empty array.
  it('returns [] on a buffer miss', () => {
    const buf = bufferWith(10)
    buf.append('u1', mkEvent('a'))
    expect(buf.since('u1', 'missing')).toEqual([])
  })

  // since on an unknown user returns an empty array.
  it('returns [] for an unknown user', () => {
    const buf = bufferWith(10)
    expect(buf.since('nobody', 'a')).toEqual([])
    expect(buf.size('nobody')).toBe(0)
  })

  // The buffer evicts the oldest event once it exceeds the configured cap.
  it('evicts FIFO beyond the configured cap', () => {
    const buf = bufferWith(3)
    for (const id of ['a', 'b', 'c', 'd', 'e']) buf.append('u1', mkEvent(id))
    expect(buf.size('u1')).toBe(3)
    // 'a' and 'b' were evicted, so since('a') is a miss.
    expect(buf.since('u1', 'a')).toEqual([])
    expect(buf.since('u1', 'c').map((e) => e.id)).toEqual(['d', 'e'])
  })

  // With no sse options configured, the default cap of 100 applies.
  it('applies the default cap when sse options are absent', () => {
    const buf = bufferWith(undefined)
    for (let i = 0; i < 150; i += 1) buf.append('u1', mkEvent(`id-${i}`))
    expect(buf.size('u1')).toBe(100)
  })

  // Buffers are isolated per user.
  it('isolates users from each other', () => {
    const buf = bufferWith(10)
    buf.append('u1', mkEvent('a'))
    buf.append('u2', mkEvent('b'))
    expect(buf.size('u1')).toBe(1)
    expect(buf.since('u2', 'b')).toEqual([])
  })
})
