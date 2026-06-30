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
    heartbeat.start('c1', res, 5_000)
    jest.advanceTimersByTime(15_000)
    expect(write).toHaveBeenCalledTimes(3)
    expect(write).toHaveBeenLastCalledWith(': keepalive\n\n')
  })

  // stop clears the timer so no further keepalives are written.
  it('stops writing after stop()', () => {
    heartbeat.start('c1', res, 5_000)
    jest.advanceTimersByTime(5_000)
    heartbeat.stop('c1')
    jest.advanceTimersByTime(25_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // stop on an unknown connection is a safe no-op.
  it('is a no-op when stopping an unknown connection', () => {
    expect(() => heartbeat.stop('ghost')).not.toThrow()
  })

  // Restarting the same connection replaces the prior timer (no duplicates).
  it('replaces an existing timer on restart', () => {
    heartbeat.start('c1', res, 5_000)
    heartbeat.start('c1', res, 5_000)
    jest.advanceTimersByTime(5_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // stopAll clears every active timer.
  it('clears all timers on stopAll', () => {
    heartbeat.start('c1', res, 5_000)
    heartbeat.start('c2', res, 5_000)
    heartbeat.stopAll()
    jest.advanceTimersByTime(25_000)
    expect(write).not.toHaveBeenCalled()
  })

  // A throwing write (client gone / stream closed) stops the timer, never crashes.
  it('stops the timer when a write throws', () => {
    write.mockImplementation(() => {
      throw new Error('stream closed')
    })
    heartbeat.start('c1', res, 5_000)
    expect(() => jest.advanceTimersByTime(5_000)).not.toThrow()
    expect(write).toHaveBeenCalledTimes(1)
    // The timer was cleared on failure, so no further keepalives are attempted.
    jest.advanceTimersByTime(25_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // An interval below the 5 000 ms minimum throws REALTIME_INVALID_OPTIONS.
  it('throws when the interval is below the minimum (5 000 ms)', () => {
    expect(() => heartbeat.start('c1', res, 4_999)).toThrow('REALTIME_INVALID_OPTIONS')
  })

  // An interval above the 90 000 ms maximum throws REALTIME_INVALID_OPTIONS.
  it('throws when the interval is above the maximum (90 000 ms)', () => {
    expect(() => heartbeat.start('c1', res, 90_001)).toThrow('REALTIME_INVALID_OPTIONS')
  })

  // Boundary value: exactly 5 000 ms must be accepted.
  it('accepts the minimum boundary value (5 000 ms)', () => {
    expect(() => heartbeat.start('c1', res, 5_000)).not.toThrow()
  })

  // Boundary value: exactly 90 000 ms must be accepted.
  it('accepts the maximum boundary value (90 000 ms)', () => {
    expect(() => heartbeat.start('c1', res, 90_000)).not.toThrow()
  })

  // Kills L84 ConditionalExpression mutation (condition → true).
  // stop() for a connection that has NO timer must NOT call clearInterval.
  // With the mutation the guard is always true, so clearInterval is called with
  // undefined — wrong and detectable via a spy on the global function.
  it('does not call clearInterval when stopping an unregistered connection', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval')
    heartbeat.stop('never-started')
    expect(clearSpy).not.toHaveBeenCalled()
  })
})
