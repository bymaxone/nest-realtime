/**
 * @fileoverview Disconnects an ioredis client at the end of a test without leaving its disconnect
 * timer behind. ioredis arms one on every `disconnect()` and clears it when the stream closes, so a
 * stream that has already closed keeps it, and Jest, for two seconds.
 * @layer test
 */
import type Redis from 'ioredis'

/**
 * Disconnect `redis` while `setTimeout` is faked, so the timer ioredis arms never reaches the event
 * loop. `clearTimeout` stays real, which is what cancels a reconnect already scheduled.
 */
export function disconnectWithoutTimer(redis: Redis): void {
  jest.useFakeTimers({
    doNotFake: ['clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  })
  try {
    redis.disconnect()
  } finally {
    jest.useRealTimers()
  }
}
