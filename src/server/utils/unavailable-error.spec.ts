/**
 * @fileoverview Tests for unavailableError, the rejection for a call that could not reach its target.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { unavailableError } from './unavailable-error'

describe('unavailableError', () => {
  // Scenario: a revocation that could not be published. Expected: the stable code leads the
  // message, after the class that raised it, and the reason underneath is both in the text and
  // in `cause`. Why: callers match on the code and operators read the cause.
  it('leads with the code, names the raiser and keeps the cause', () => {
    const cause = new Error('redis down')
    const error = unavailableError(
      REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
      'SseTransport',
      'the revocation of c1 could not be published',
      cause,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(
      '[SseTransport] REALTIME_PUBSUB_UNAVAILABLE: the revocation of c1 could not be published (redis down)',
    )
    expect(error.cause).toBe(cause)
  })

  // Scenario: whatever was thrown is not an Error. Expected: it still produces a readable
  // message and is kept as `cause`. Why: a rejection can carry any value.
  it.each([
    ['a string', 'plain reason', 'plain reason'],
    ['null', null, 'null'],
  ])('describes %s as the reason', (_label, reason, text) => {
    const error = unavailableError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      'WebSocketTransport',
      'the server is not attached',
      reason,
    )

    expect(error.message).toContain(`(${text})`)
    expect(error.cause).toBe(reason)
  })
})
