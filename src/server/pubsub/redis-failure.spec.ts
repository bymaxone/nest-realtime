/**
 * @fileoverview Which raised values `isErrorReply` takes for an error reply of the server: the ones
 * whose name is exactly `ReplyError`.
 * @layer infrastructure
 */
import { isErrorReply } from './redis-failure'

const named = (name: unknown): unknown => ({ name })

describe('isErrorReply', () => {
  // The name ioredis gives a refusal of the server.
  it('takes a value named ReplyError', () => {
    expect(isErrorReply(named('ReplyError'))).toBe(true)
  })

  // A name that only contains it is another error, and its message must not be read as a reply.
  it.each(['XReplyError', 'ReplyErrorX', 'replyerror', ''])('refuses the name %j', (name) => {
    expect(isErrorReply(named(name))).toBe(false)
  })

  // Nothing to read, or a name that is not text.
  it.each([undefined, null, {}, named(1), named(['ReplyError'])])('refuses %j', (raised) => {
    expect(isErrorReply(raised)).toBe(false)
  })
})
