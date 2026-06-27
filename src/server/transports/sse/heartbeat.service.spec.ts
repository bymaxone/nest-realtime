/**
 * @fileoverview Unit tests for the SSE keepalive heartbeat service.
 * @layer transport
 */
import { HeartbeatService, type HeartbeatWritable } from './heartbeat.service'

describe('HeartbeatService', () => {
  let heartbeat: HeartbeatService
  let write: jest.Mock
  let res: HeartbeatWritable

  beforeEach(() => {
    jest.useFakeTimers()
    heartbeat = new HeartbeatService()
    write = jest.fn()
    res = { write }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // Each interval writes a raw SSE keepalive comment to the response.
  it('writes ": keepalive" on every interval', () => {
    heartbeat.start('c1', res, 1_000)
    jest.advanceTimersByTime(3_000)
    expect(write).toHaveBeenCalledTimes(3)
    expect(write).toHaveBeenLastCalledWith(': keepalive\n\n')
  })

  // stop clears the timer so no further keepalives are written.
  it('stops writing after stop()', () => {
    heartbeat.start('c1', res, 1_000)
    jest.advanceTimersByTime(1_000)
    heartbeat.stop('c1')
    jest.advanceTimersByTime(5_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // stop on an unknown connection is a safe no-op.
  it('is a no-op when stopping an unknown connection', () => {
    expect(() => heartbeat.stop('ghost')).not.toThrow()
  })

  // Restarting the same connection replaces the prior timer (no duplicates).
  it('replaces an existing timer on restart', () => {
    heartbeat.start('c1', res, 1_000)
    heartbeat.start('c1', res, 1_000)
    jest.advanceTimersByTime(1_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // stopAll clears every active timer.
  it('clears all timers on stopAll', () => {
    heartbeat.start('c1', res, 1_000)
    heartbeat.start('c2', res, 1_000)
    heartbeat.stopAll()
    jest.advanceTimersByTime(5_000)
    expect(write).not.toHaveBeenCalled()
  })

  // A throwing write (client gone / stream closed) stops the timer, never crashes.
  it('stops the timer when a write throws', () => {
    write.mockImplementation(() => {
      throw new Error('stream closed')
    })
    heartbeat.start('c1', res, 1_000)
    expect(() => jest.advanceTimersByTime(1_000)).not.toThrow()
    expect(write).toHaveBeenCalledTimes(1)
    // The timer was cleared on failure, so no further keepalives are attempted.
    jest.advanceTimersByTime(5_000)
    expect(write).toHaveBeenCalledTimes(1)
  })
})
