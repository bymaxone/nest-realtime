/**
 * @fileoverview RedisRealtimePubSub with a payload that is valid JSON but not an object: it is
 * dropped as malformed and reported, never handed to a handler, over ioredis-mock.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import RedisMock from 'ioredis-mock'
import type { Redis } from 'ioredis'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

function build() {
  const client = new RedisMock() as unknown as Redis
  return { pubsub: new RedisRealtimePubSub({ client }), client }
}

describe('a payload that parses to something other than an object', () => {
  /*
   * Given a subscribed handler
   * When a payload that is valid JSON but not an object is published
   * Then no handler receives it, and the malformed-payload report counts it
   */
  it.each([['null'], ['42'], ['"text"'], ['true'], ['[1]']])(
    'drops %s as malformed',
    async (payload) => {
      const { pubsub, client } = build()
      const handler = jest.fn()
      await pubsub.subscribe(handler)
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
      try {
        await client.publish('bymax:realtime', payload)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(handler).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'dropped 1 malformed payload(s) since the last report',
          }),
        )
      } finally {
        now.mockRestore()
        warn.mockRestore()
      }
    },
  )

  /*
   * Given a subscribed handler
   * When an object payload is published
   * Then the handler receives it
   */
  it('still delivers an object', async () => {
    const { pubsub, client } = build()
    const handler = jest.fn()
    await pubsub.subscribe(handler)

    await client.publish('bymax:realtime', JSON.stringify({ op: 'broadcast', args: {} }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(handler).toHaveBeenCalledWith({ op: 'broadcast', args: {} })
  })
})
