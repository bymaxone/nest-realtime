/**
 * @fileoverview The bytes an event adds to an SSE stream, for bounding what a client has not read.
 * @layer transport
 */
import type { MessageEvent } from '@nestjs/common'

/** An event this transport built: it always has a name and an id. */
export type Frame = MessageEvent & { readonly id: string; readonly type: string }

// What Nest writes around each field of a frame: `event: <type>\n`, `id: <id>\n`, `data: <text>\n`,
// and a blank line that ends the frame.
const EVENT_FIELD = 'event: '.length + '\n'.length
const ID_FIELD = 'id: '.length + '\n'.length
const DATA_FIELD = 'data: '.length + '\n'.length
const FRAME_END = '\n'.length

/** The bytes a frame adds, computed once however many connections receive it. */
const sizes = new WeakMap<Frame, number>()

/** A frame field as Nest writes it, without line breaks. */
function fieldBytes(value: string): number {
  return Buffer.byteLength(value.replace(/[\r\n]/g, ''))
}

/**
 * What an event adds to the stream: its fields as Nest writes them. A string is written as it is
 * and anything else as JSON; an empty name and absent data are not written.
 *
 * The size is never more than what is written, because an estimate above it would cut a client
 * that keeps up. A multi-line string is counted as one line, which leaves out the prefix each
 * further line gets, and HTTP chunk headers are left out because a response that is not chunked
 * has none.
 */
export function frameBytes(message: Frame): number {
  let size = sizes.get(message)
  if (size === undefined) {
    const { data, type, id } = message
    size = FRAME_END + ID_FIELD + fieldBytes(id)
    if (type) size += EVENT_FIELD + fieldBytes(type)
    if (data !== undefined && data !== null) {
      size +=
        DATA_FIELD +
        Buffer.byteLength(typeof data === 'string' ? data : (JSON.stringify(data) ?? ''))
    }
    sizes.set(message, size)
  }
  return size
}
