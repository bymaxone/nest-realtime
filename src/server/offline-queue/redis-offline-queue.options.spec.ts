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

const DEFAULT_MAX_PER_USER = 500
const DEFAULT_TTL_SECONDS = 3600
const SENTINEL = 'SENTINEL-3b7e90'

/** What a host could pass by mistake, and how the refusal names it: a finite number is printed, the rest by type. */
const REFUSED: ReadonlyArray<readonly [unknown, string]> = [
  [Number.NaN, 'a number that is not finite'],
  [Infinity, 'a number that is not finite'],
  [-1, '-1'],
  [0, '0'],
  [1.5, '1.5'],
  ['3', 'a string'],
  [1e300, '1e+300'],
  [2 ** 53, '9007199254740992'],
  [SENTINEL, 'a string'],
  [Symbol(SENTINEL), 'a symbol'],
  [() => SENTINEL, 'a function'],
  [{ toString: () => SENTINEL }, 'an object'],
  [Object.create(null), 'an object'],
  [[SENTINEL], 'an array'],
  [true, 'a boolean'],
]

describe.each(CASES)('RedisOfflineQueue $name', ({ name, least, most }) => {
  const make = (value: unknown): RedisOfflineQueue =>
    new RedisOfflineQueue({ client, [name]: value } as never)

  // Scenario: a value that is not an integer in range. Expected: construction throws the typed refusal
  // naming the option, its range and what it received by type, so no queue exists that drops or corrupts
  // and nothing the value held is echoed.
  it.each([...REFUSED, [most + 1, String(most + 1)] as const])(
    'refuses %p at construction',
    (value, received) => {
      let message = ''
      try {
        make(value)
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).toBe(
        `[RedisOfflineQueue] REALTIME_INVALID_OPTIONS: options.${name} must be an integer >= ${least} and <= ${most}, received ${received}`,
      )
      expect(message).not.toContain(SENTINEL)
    },
  )

  // Scenario: the values the option exists for, and leaving it unset. Expected: accepted.
  it.each([least, 3, most])('accepts %p', (value) => {
    expect(() => make(value)).not.toThrow()
  })

  // Scenario: the option is present and holds nothing. Expected: it is read as unset, so the pipeline the
  // queue builds on append carries the default: the trim keeps 500 and the key expires after 3600 s.
  it.each([undefined, null])('reads %p as unset and uses the default', async (value) => {
    const pipeline = {
      zadd: jest.fn(),
      zremrangebyrank: jest.fn(),
      expire: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    }
    const queue = new RedisOfflineQueue({
      client: { pipeline: jest.fn().mockReturnValue(pipeline) } as unknown as Redis,
      [name]: value,
    } as never)

    await queue.append('u', { id: '100-0', event: 'e', data: {}, emittedAt: new Date(0) })

    if (name === 'maxPerUser') {
      expect(pipeline.zremrangebyrank).toHaveBeenCalledWith(
        'bymax:oq:u',
        0,
        -(DEFAULT_MAX_PER_USER + 1),
      )
    } else {
      expect(pipeline.expire).toHaveBeenCalledWith('bymax:oq:u', DEFAULT_TTL_SECONDS)
    }
  })
})
