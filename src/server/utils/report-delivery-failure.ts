/**
 * @fileoverview Makes a delivery path's failure visible without failing the call that used it.
 * @layer utils
 */
import type { Logger } from '@nestjs/common'
import type {
  DeliveryFailure,
  IConnectionLifecycleHooks,
} from '../interfaces/connection-lifecycle-hooks.interface'
import { describeError } from './describe-error'

/**
 * Logs a delivery failure with its stable code and the operation, and hands it to the
 * `onDeliveryFailure` hook. The hook runs on its own: whether it throws or rejects, the failure
 * is logged and the caller carries on.
 *
 * @param logger - The raising class's logger.
 * @param hooks - The consumer's lifecycle hooks, if any.
 * @param failure - What failed; `error` may be whatever was thrown.
 * @param what - A short description for the log line.
 */
export function reportDeliveryFailure(
  logger: Logger,
  hooks: IConnectionLifecycleHooks | undefined,
  failure: Omit<DeliveryFailure, 'error'> & { readonly error: unknown },
  what: string,
): void {
  logger.warn(`${failure.code} op=${failure.op}: ${what}: ${describeError(failure.error)}`)
  const reported: DeliveryFailure = {
    ...failure,
    error: failure.error instanceof Error ? failure.error : new Error(describeError(failure.error)),
  }
  void Promise.resolve()
    .then(() => hooks?.onDeliveryFailure?.(reported))
    .catch((err: unknown) => {
      logger.warn(`onDeliveryFailure hook failed: ${describeError(err)}`)
    })
}
