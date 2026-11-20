/**
 * @fileoverview The typed refusal for an object the host built whose read throws.
 * @layer composition
 */
import {
  REALTIME_ERROR_CODES,
  type RealtimeErrorCode,
} from '../../shared/constants/error-codes.constants'
import { realtimeError } from '../utils/realtime-error'

const LIBRARY_CODES: ReadonlySet<unknown> = new Set(Object.values(REALTIME_ERROR_CODES))

/** Whether an error is one this library raised: it carries one of its stable codes. */
const isLibraryError = (error: unknown): error is Error & { code: RealtimeErrorCode } =>
  error instanceof Error && LIBRARY_CODES.has((error as { code?: unknown }).code)

/**
 * Runs a read of an object the host built, such as the options, an authenticator or the provider a factory
 * pattern names. A getter or a proxy on that object can throw on any key, and its error is the host's own:
 * it is refused with `REALTIME_INVALID_OPTIONS`, the host's error travels as the cause, and its text is not
 * in the message. A refusal this library raised while reading passes through untouched.
 *
 * @param what - What is being read, completing "... could not be read".
 * @param read - The read.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS`.
 */
export function guardHostReads<T>(what: string, read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (isLibraryError(error)) throw error
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `${what} could not be read: a getter or a proxy on it throws`,
      { who: 'BymaxRealtimeModule', cause: error },
    )
  }
}
