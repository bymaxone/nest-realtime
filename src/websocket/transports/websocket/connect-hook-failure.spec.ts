/**
 * @fileoverview The error a connection that `onConnect` failed for is closed with.
 * @layer transport
 */
import { ConnectHookFailure } from './connect-hook-failure'

describe('ConnectHookFailure', () => {
  // Scenario: the transport raises it for a failed onConnect. Expected: the library's fixed message, a name a log
  // can group by, and the host's error as the cause, none of its text in the message.
  it('carries the host error as its cause and none of its text in the message', () => {
    const cause = new Error('presence store down')
    const failure = new ConnectHookFailure(cause)

    expect(failure).toBeInstanceOf(Error)
    expect(failure.name).toBe('ConnectHookFailure')
    expect(failure.message).toBe('onConnect hook failed')
    expect(failure.cause).toBe(cause)
  })
})
