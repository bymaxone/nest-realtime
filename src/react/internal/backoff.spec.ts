/**
 * @fileoverview Unit tests for the reconnect backoff.
 * @layer react
 */
import { MAX_TIMER_MS, nextBackoff } from './backoff'

describe('nextBackoff', () => {
  it('doubles the last delay', () => {
    expect(nextBackoff(1_000, 30_000)).toBe(2_000)
  })

  it('stops at the maximum it is given', () => {
    expect(nextBackoff(20_000, 30_000)).toBe(30_000)
  })

  // A delay longer than this runs as 1 ms, which would reconnect at once and in a loop.
  it('stops at what a timer can run, whatever the maximum asks for', () => {
    expect(nextBackoff(2_000_000_000, 9_000_000_000)).toBe(2_147_483_647)
    expect(MAX_TIMER_MS).toBe(2_147_483_647)
  })

  it('keeps a delay that is exactly what a timer can run', () => {
    expect(nextBackoff(1_073_741_823, Number.MAX_SAFE_INTEGER)).toBe(2_147_483_646)
  })
})
