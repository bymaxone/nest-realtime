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

/**
 * Whether an error is one this library raised: it carries one of its stable codes. The test is the code and not the
 * origin, so an error of the host's own that carries one of those codes is rethrown as it is. That is kept: the library
 * builds its errors with one function that sets the code, a host sets a `REALTIME_` code on its own error only on
 * purpose, and a brand that crossed the package's bundles would need a shared symbol for no case that occurs.
 */
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

/**
 * Reads what a host's factory returned under the guard, so that the read `await` makes of it cannot run a trap
 * outside it. `await` reads `then` on a value, and a proxy whose trap throws, or one that was revoked, throws there,
 * inside the library's own provider and before the options are read. The read is made here first; returning the value
 * from an `async` function then adopts a promise or a thenable as it is, so the rejection of a factory's own promise
 * stays the factory's failure, whatever it threw, and is not this module's to rename. The adoption reads `then` again,
 * so a getter that answers differently the second time is not guarded.
 *
 * @param returned - What the factory returned.
 * @param what - What is being read, completing "... could not be read".
 * @throws Error carrying `REALTIME_INVALID_OPTIONS` when reading `then` on what was returned throws.
 */
export async function awaitHostResult<T>(
  returned: T | Promise<T>,
  what = 'the options',
): Promise<T> {
  guardHostReads(what, () => (returned as { then?: unknown } | null | undefined)?.then)
  return returned
}
