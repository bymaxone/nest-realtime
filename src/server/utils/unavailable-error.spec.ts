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
  // message, after the class that raised it, and the reason underneath is in `cause` and not in the
  // text. Why: callers match on the code, operators read the cause, and a driver's or a host's text
  // is not the library's to put in a message that can reach a log or a response.
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
      '[SseTransport] REALTIME_PUBSUB_UNAVAILABLE: the revocation of c1 could not be published',
    )
    expect(error.cause).toBe(cause)
  })

  // Scenario: whatever was thrown is not an Error. Expected: the message is the same and the value is
  // kept as `cause`. Why: a rejection can carry any value, `null` included.
  it.each([
    ['a string', 'plain reason'],
    ['null', null],
  ])('keeps %s as the cause and out of the message', (_label, reason) => {
    const error = unavailableError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      'WebSocketTransport',
      'the server is not attached',
      reason,
    )

    expect(error.message).toBe(
      '[WebSocketTransport] REALTIME_TRANSPORT_UNAVAILABLE: the server is not attached',
    )
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
    expect(error.message).not.toContain('ECONNREFUSED')
    expect((error.cause as Error).message).toContain('ECONNREFUSED')
  })

  // Scenario: a data property named like a field of a descriptor is planted on the root prototype, and the error is built.
  // Expected: it is built, with the message and the cause as it was told them: the descriptors have no prototype, so nothing
  // planted turns one into an accessor or throws.
  it.each(['get', 'set'])('is built with %s planted on Object.prototype', (name) => {
    Object.defineProperty(Object.prototype, name, {
      value: 1,
      configurable: true,
      enumerable: true,
      writable: true,
    })
    let error: ReturnType<typeof unavailableError> | undefined
    let thrown: unknown
    try {
      error = unavailableError(REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE, 'SseTransport', 'x', 'why')
    } catch (caught) {
      thrown = caught
    } finally {
      Reflect.deleteProperty(Object.prototype, name)
    }

    expect(thrown).toBeUndefined()
    expect([error?.message, error?.cause]).toStrictEqual([
      '[SseTransport] REALTIME_PUBSUB_UNAVAILABLE: x',
      'why',
    ])
  })
})
