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
  'REALTIME_GATEWAY_OUTSIDE_NAMESPACE',
  'REALTIME_COMPOSITE_PARTIAL_FAILURE',
  'REALTIME_SERVER_NOT_ATTACHED',
] as const

/** The code of one warn or error event the library writes, one of `REALTIME_LOG_EVENTS`. */
export type RealtimeLogEvent = (typeof REALTIME_LOG_EVENTS)[number]

/** Keys a logger reads or writes as its own on every line, which a field cannot carry. */
const RESERVED_KEYS = [
  'err',
  'msg',
  'level',
  'time',
  'pid',
  'hostname',
  'name',
  'v',
  'req',
  'res',
  'service',
  'version',
] as const

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
 * @param fields - Closed or numeric fields, built by the library. A key named `event` or `message` is replaced by the
 *   library's own value, and one named `err`, `msg`, `level`, `time`, `pid`, `hostname`, `name`, `v`, `req`, `res`, `service` or `version` is dropped, and a field whose read throws, such as a getter, loses the line like any other
 *   throw while writing.
 * @param error - What was thrown, when the event reports a failure. It goes under `err` as the value itself, never
 *   as text in `message`, so the logger's serializer and redaction apply to it: an error raised by host code can
 *   carry a user or a tenant, and the library's own line must not.
 *
 * A logger that throws while writing is absorbed, since the report of a failure must not become another one. A
 * logger whose method returns a rejected promise is not: Nest's `Logger` discards what the method returns, so the
 * rejection is an unhandled rejection of the host's process, and the logger has to catch its own.
 */
export function logEvent(
  logger: Pick<Logger, 'warn' | 'error'>,
  level: 'warn' | 'error',
  event: RealtimeLogEvent,
  message: string,
  fields: LogFields = {},
  error?: unknown,
): void {
  try {
    const line: Record<string, unknown> = { ...fields, event, message }
    // `err` is where a logger's serializer reads an error from, `msg` and `level` are where a structured logger reads a
    // line's text and severity, and `time`, `pid`, `hostname`, `name`, `v`, `req`, `res`, `service` and `version` are what it writes itself, so
    // no field may put anything there: only the error argument writes `err`.
    for (const key of RESERVED_KEYS) delete line[key]
    if (error !== undefined) line['err'] = error
    logger[level](line)
  } catch {
    // The host's logger threw. This is called from catch blocks and promise handlers, where a throw is a second
    // failure on top of the one being reported, or an unhandled rejection, so the line is lost and the call goes on.
  }
}
