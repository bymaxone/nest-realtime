/**
 * @fileoverview The error a call rejects with when it could not reach what it was asked to act on.
 * @layer utils
 */
import type { RealtimeErrorCode } from '../../shared/constants/error-codes.constants'
import { describeError } from './describe-error'
import { realtimeError } from './realtime-error'
import type { CodedError } from './realtime-error'

/**
 * Builds the rejection for a call whose effect did not happen, such as a revocation that never
 * reached its connection. The stable code leads the message, as it does in the other errors this
 * library raises, is also the `code` property, and the original failure travels as `cause`.
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
): CodedError {
  return realtimeError(code, `${what} (${describeError(cause)})`, { who, cause })
}
