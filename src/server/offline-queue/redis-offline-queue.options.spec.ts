/**
 * @fileoverview `RedisOfflineQueue` refuses a `maxPerUser` or `ttlSeconds` that is not a usable integer.
 * @layer infrastructure
 *
 * Measured against Redis 7: `EXPIRE` with 0 or a negative deletes the key, so every append is
 * dropped; a `maxPerUser` of 0 or a negative makes the trim remove every entry; and `NaN`, a
 * fraction, `Infinity` or a value past what Redis accepts make the command fail after `ZADD` ran,
 * which leaves untrimmed entries or a key with no expiry. A numeric string concatenates in
 * `-(maxPerUser + 1)`. Each is refused at construction instead, where the host can see it.
 */
import type { Redis } from 'ioredis'
import { RedisOfflineQueue } from './redis-offline-queue'

const client = {} as unknown as Redis

/** The ceilings: what Redis accepts for `EXPIRE` is measured, and a queue past 100,000 events per user is memory, not a queue. */
const MAX_PER_USER_CEILING = 100_000
const TTL_CEILING = 2_147_483_647

const CASES = [
  { name: 'maxPerUser', least: 1, most: MAX_PER_USER_CEILING },
  { name: 'ttlSeconds', least: 1, most: TTL_CEILING },
] as const

const REFUSED: readonly unknown[] = [Number.NaN, Infinity, -1, 0, 1.5, '3', 1e300, 2 ** 53]

describe.each(CASES)('RedisOfflineQueue $name', ({ name, least, most }) => {
  const make = (value: unknown): RedisOfflineQueue =>
    new RedisOfflineQueue({ client, [name]: value } as never)

  // Scenario: a value that is not an integer in range. Expected: construction throws the typed
  // refusal naming the option, its range and the value, so no queue exists that drops or corrupts.
  it.each([...REFUSED, most + 1])('refuses %p at construction', (value) => {
    expect(() => make(value)).toThrow(
      `[RedisOfflineQueue] REALTIME_INVALID_OPTIONS: options.${name} must be an integer >= ${least} and <= ${most}, got ${String(value)}`,
    )
  })

  // Scenario: the values the option exists for, and leaving it unset. Expected: accepted.
  it.each([least, 3, most])('accepts %p', (value) => {
    expect(() => make(value)).not.toThrow()
  })

  it('accepts the option unset', () => {
    expect(() => make(undefined)).not.toThrow()
  })
})
