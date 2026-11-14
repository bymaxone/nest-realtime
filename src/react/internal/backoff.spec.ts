/**
 * @fileoverview Unit tests for the reconnect backoff.
 * @layer react
 */
import { MAX_TIMER_MS, nextBackoff, validDelay } from './backoff'

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

describe('validDelay', () => {
  // A delay that is not a positive whole number reaches a timer as 1 ms, and a reconnect every
  // millisecond is a loop against the server: it is replaced by the default.
  it.each([Number.NaN, Infinity, -Infinity, -1, 0, 0.5, 1.5])(
    'replaces %s with the default',
    (bad) => {
      expect(validDelay(bad, 1_000)).toBe(1_000)
    },
  )

  it('replaces an absent delay with the default', () => {
    expect(validDelay(undefined, 30_000)).toBe(30_000)
  })

  it('keeps a positive whole number', () => {
    expect(validDelay(1, 1_000)).toBe(1)
    expect(validDelay(45_000, 1_000)).toBe(45_000)
  })
})
