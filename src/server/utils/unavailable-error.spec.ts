/**
 * @fileoverview Tests for unavailableError, the rejection for a call that could not reach its target.
 * @layer utils
 */
import {
  expectGenericServiceUnavailable,
  GENERIC_503_BODY,
} from '../../../test/fixtures/service-unavailable'
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
    expect(error.code).toBe('REALTIME_PUBSUB_UNAVAILABLE')
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

  // Scenario: a consumer's controller lets the rejection escape. Expected: Nest answers 503 with
  // the generic body, and nothing the operator reads (the call's text, the raiser, the cause with
  // its host and credentials) is in what the client is sent. Why: a driver's error text leaked
  // into an HTTP body is a disclosure, and a plain Error answers 500, which says "bug" for an outage.
  it('is a 503 whose body names nothing of the failure', () => {
    const error = unavailableError(
      REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
      'SseTransport',
      'the revocation of c1 could not be published',
      new Error('connect ECONNREFUSED redis://user:secret@10.0.0.5:6379'),
    )

    expectGenericServiceUnavailable(error)
    expect(JSON.stringify(error.getResponse())).toBe(JSON.stringify(GENERIC_503_BODY))
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /redis|secret|10\.0|revocation|SseTransport|REALTIME/,
    )
    expect(error.code).toBe('REALTIME_PUBSUB_UNAVAILABLE')
    expect(error.message).toContain('ECONNREFUSED')
  })
})
