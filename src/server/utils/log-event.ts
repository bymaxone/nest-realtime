/**
 * @fileoverview The one way the library writes an operational log line: an object with a stable event code.
 * @layer utils
 */
import type { Logger } from '@nestjs/common'

/**
 * The event codes the library logs at `warn` and `error`. Each is listed with its fields in the README
 * "Log events" table; a code is never reused for another condition, so a host can alert on one.
 */
export const REALTIME_LOG_EVENTS = [
  'REALTIME_REAUTH_CACHE_WEAKENS_POLICY',
  'REALTIME_HANDSHAKE_FAILED',
  'REALTIME_HOOK_FAILED',
  'REALTIME_DELIVERY_FAILED',
  'REALTIME_SLOW_CONSUMER',
  'REALTIME_DISCONNECT_FAILED',
  'REALTIME_RECONNECTS_GIVEN_UP',
  'REALTIME_OFFLINE_QUEUE_LIMIT',
  'REALTIME_OFFLINE_QUEUE_ACK_FAILED',
  'REALTIME_PUBSUB_NOT_PROVIDED',
  'REALTIME_PUBSUB_UNSUBSCRIBE_FAILED',
  'REALTIME_PUBSUB_DROPPED',
  'REALTIME_PUBSUB_UNAVAILABLE',
  'REALTIME_CONNECTIONS_REFUSED',
  'REALTIME_HANDSHAKES_REFUSED',
  'REALTIME_REAUTH_FAILED',
  'REALTIME_REVOCATION_FAILED',
  'REALTIME_ADAPTER_MISSING',
  'REALTIME_ADAPTER_COMMAND_FAILED',
  'REALTIME_COMPOSITE_PARTIAL_FAILURE',
  'REALTIME_SERVER_NOT_ATTACHED',
] as const

export type RealtimeLogEvent = (typeof REALTIME_LOG_EVENTS)[number]

/** Fields are closed or numeric: a count, a size, a configured limit, a transport name or a library-made id. */
export type LogFields = Readonly<Record<string, string | number | boolean>>

/**
 * Write `message` as an operational event.
 *
 * The line is an object, so a structured logger writes `event`, `message` and each field as separate JSON
 * fields and Nest's default logger prints it readably. Nothing a host supplied (a user or tenant id, a room, an
 * endpoint) belongs in `message` or `fields`: the logger's own correlation context already carries identity.
 *
 * @param logger - The component's logger.
 * @param level - `warn` for what degrades service, `error` for what fails an operation.
 * @param event - The stable code of the condition.
 * @param message - Human text; the library's own wording, with no host-supplied value in it.
 * @param fields - Closed or numeric fields.
 */
export function logEvent(
  logger: Pick<Logger, 'warn' | 'error'>,
  level: 'warn' | 'error',
  event: RealtimeLogEvent,
  message: string,
  fields: LogFields = {},
): void {
  logger[level]({ event, message, ...fields })
}
