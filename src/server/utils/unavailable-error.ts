/**
 * @fileoverview The error a call rejects with when it could not reach what it was asked to act on.
 * @layer utils
 */
import { ServiceUnavailableException } from '@nestjs/common'
import type { RealtimeErrorCode } from '../../shared/constants/error-codes.constants'
import { realtimeError } from './realtime-error'

/** A 503 that carries one of the library's stable codes as a property. */
export type UnavailableError = ServiceUnavailableException & { readonly code: RealtimeErrorCode }

/**
 * Builds the rejection for a call whose effect did not happen, such as a revocation that never
 * reached its connection. The stable code leads the message, as it does in the other errors this
 * library raises, is also the `code` property, and the original failure travels as `cause` alone: its
 * text, which is a driver's or a host's, is not in the message.
 *
 * It is Nest's `ServiceUnavailableException`, so a consumer's controller that lets it escape
 * answers 503 with the generic body, and the library's own text never reaches a client: the
 * message, the code and the cause are on the instance for whoever logs it, and the response says
 * only that the service is unavailable. `ServiceUnavailableException` is `@nestjs/common`'s, a peer
 * the package has one copy of, so `instanceof` holds across the package's bundles.
 *
 * @param code - The stable error code to carry.
 * @param who - The class that raises it, shown in brackets.
 * @param what - What could not be reached.
 * @param cause - The failure underneath, whatever was thrown.
 */
export function unavailableError(
  code: RealtimeErrorCode,
  who: string,
  what: string,
  cause: unknown,
): UnavailableError {
  const { message } = realtimeError(code, what, { who })
  // `cause` is defined rather than passed to the constructor, which keeps it only when truthy: a
  // rejection can carry any value, `null` included. `message` and `cause` are not enumerable, so a
  // filter, a logger or an ack that stringifies the instance sends the code and the generic body
  // and not the text of a driver or a broker; `err.cause` still holds it.
  const error = Object.assign(new ServiceUnavailableException(), { code })
  Object.defineProperties(error, {
    message: { value: message, enumerable: false, writable: true, configurable: true },
    cause: { value: cause, enumerable: false, writable: true, configurable: true },
  })
  return error
}
