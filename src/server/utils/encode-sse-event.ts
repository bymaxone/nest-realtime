/**
 * @fileoverview Pure utility for encoding a MessageEvent into the SSE wire format.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'

/**
 * Encode a NestJS `MessageEvent` into the SSE wire format.
 *
 * The heartbeat is encoded as a raw SSE comment `': keepalive\n\n'` — invisible to
 * `EventSource`, out of the `Last-Event-ID` id-space, and carrying no `id:`, `event:`,
 * or `data:` fields.  This is signalled by `event.type === 'heartbeat'`, a local
 * sentinel deliberately absent from `RESERVED_EVENT_NAMES` because the heartbeat is
 * never a named event.
 *
 * Regular events follow the W3C SSE layout:
 * - `id:` line — omitted when `event.id` is falsy.
 * - `event:` line — omitted when `event.type` is `'message'` (the W3C default) or absent.
 * - `data:` line(s) — multi-line data is split into one `data:` line per `\n`.
 * - Blank line terminator (`\n\n`).
 *
 * NestJS `@Sse()` handles live streams natively; this helper serves the direct-emission
 * path (e.g. the cross-instance pub/sub subscriber) and unit tests.
 *
 * @param event - The `MessageEvent` to encode.
 * @returns The SSE wire-format string, always ending with `\n\n`.
 *
 * @example Single-line data:
 * ```ts
 * encodeSseEvent({ id: '1', type: 'chat', data: { text: 'hi' } })
 * // → 'id: 1\nevent: chat\ndata: {"text":"hi"}\n\n'
 * ```
 *
 * @example Multi-line data:
 * ```ts
 * encodeSseEvent({ id: '2', type: 'log', data: 'a\nb' })
 * // → 'id: 2\nevent: log\ndata: a\ndata: b\n\n'
 * ```
 *
 * @example No id, default type (omitted fields):
 * ```ts
 * encodeSseEvent({ type: 'message', data: 'ping' })
 * // → 'data: ping\n\n'
 * ```
 *
 * @example Heartbeat (SSE comment, invisible to EventSource):
 * ```ts
 * encodeSseEvent({ type: 'heartbeat', data: null })
 * // → ': keepalive\n\n'
 * ```
 */
export function encodeSseEvent(event: MessageEvent): string {
  // The heartbeat is an SSE comment, not a named event (spec §13).
  if (event.type === 'heartbeat') return ': keepalive\n\n'

  const lines: string[] = []
  if (event.id) lines.push(`id: ${event.id}`)
  if (event.type && event.type !== 'message') lines.push(`event: ${event.type}`)

  const serialized = serializeData(event.data)
  for (const line of serialized.split('\n')) {
    lines.push(`data: ${line}`)
  }

  return lines.join('\n') + '\n\n'
}

/**
 * Serialize event data to a string suitable for the `data:` field(s).
 *
 * - Strings are passed through as-is (caller controls formatting).
 * - `null` or `undefined` serialize to an empty string.
 * - All other values are JSON-stringified.
 *
 * @param data - The raw data value from the `MessageEvent`.
 * @returns A string representation of the data.
 */
function serializeData(data: unknown): string {
  if (typeof data === 'string') return data
  if (data === null || data === undefined) return ''
  return JSON.stringify(data)
}
