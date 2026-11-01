/**
 * @fileoverview The error a call rejects with when it could not reach what it was asked to act on.
 * @layer utils
 */
import type { RealtimeErrorCode } from '../../shared/constants/error-codes.constants'
import { describeError } from './describe-error'

/**
 * Builds the rejection for a call whose effect did not happen, such as a revocation that never
 * reached its connection. The stable code leads the message, as it does in the other errors this
 * library raises, and the original failure travels as `cause`.
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
): Error {
  return new Error(`[${who}] ${code}: ${what} (${describeError(cause)})`, { cause })
}
