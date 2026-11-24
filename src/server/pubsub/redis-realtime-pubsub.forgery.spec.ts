/**
 * @fileoverview A revocation is a decision: the publish wait reads no Promise static, so a replaced built-in cannot
 * report a publish the server refused as handed off.
 * @layer test
 */
import { withPromiseForged } from '../../../test/support/forged-promise'
import type { RealtimePubSubMessage } from '../interfaces/realtime-pubsub.interface'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

const message: RealtimePubSubMessage = {
  op: 'disconnect',
  args: { connectionId: 'c-1' },
  origin: 'inst-1',
}

describe('RedisRealtimePubSub.publish: a revocation the server refused', () => {
  // Scenario: a client that is ready and whose server answers READONLY, while a Promise built-in is replaced so that
  // every promise appears to settle with success. Expected: the publish rejects; it does not report a hand-off.
  it.each(['race', 'resolve'] as const)('rejects when Promise %s is replaced', async (kind) => {
    const realThen = Promise.prototype.then
    const client = {
      status: 'ready',
      publish: () => {
        const refused = Promise.reject(
          new Error('READONLY You cannot write against a read only replica.'),
        )
        realThen.call(refused, undefined, () => undefined)
        return refused
      },
    }
    const pubsub = new RedisRealtimePubSub({ client: client as never })
    let handedOff = false
    let failure: unknown

    await withPromiseForged(kind, undefined, async () => {
      try {
        await pubsub.publish(message)
        handedOff = true
      } catch (error) {
        failure = error
      }
    })

    expect(handedOff).toBe(false)
    expect(failure).toBeInstanceOf(Error)
  })
})
