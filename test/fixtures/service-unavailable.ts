/**
 * The assertion for an error that reaches an HTTP client as a 503 and says nothing of its cause.
 *
 * Layer: test fixture. A rejection of this library that a consumer's controller lets escape is
 * answered by Nest's own exception filter, so the status and the body come from the exception it
 * is, not from the message the operator reads.
 */
import { ServiceUnavailableException } from '@nestjs/common'

/** What a client is sent for one of these errors: no code, no detail, no driver text. */
export const GENERIC_503_BODY = { message: 'Service Unavailable', statusCode: 503 }

/**
 * Asserts that `error` is Nest's `ServiceUnavailableException` carrying the generic body.
 *
 * @param error - What a call rejected with.
 */
export function expectGenericServiceUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(ServiceUnavailableException)
  const exception = error as ServiceUnavailableException
  expect(exception.getStatus()).toBe(503)
  expect(exception.getResponse()).toEqual(GENERIC_503_BODY)
}
