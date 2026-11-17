/**
 * @fileoverview The refusal of an option that has to be an object and is not.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { describeReceived } from './describe-received'
import { realtimeError } from './realtime-error'

/**
 * Refuse `path` for not being an object, naming what it received by type.
 *
 * @param who - The component the refusal is attributed to.
 * @param path - The option, spelled as the host wrote it.
 * @param value - What the option held; only its type is printed.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS`.
 */
export function refuseObject(who: string, path: string, value: unknown): never {
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    `${path} must be an object, received ${describeReceived(value)}`,
    { who },
  )
}
