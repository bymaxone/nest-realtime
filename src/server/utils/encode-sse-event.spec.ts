/**
 * @fileoverview Unit tests for the SSE wire-format encoder.
 * @layer transport
 */
import { encodeSseEvent } from './encode-sse-event'

describe('encodeSseEvent', () => {
  // Heartbeat is a raw SSE comment, never a named event.
  it('encodes the heartbeat sentinel as a raw SSE comment', () => {
    // data is cast because MessageEvent.data is string|object — the encoder accepts unknown.
    expect(encodeSseEvent({ type: 'heartbeat', data: null } as never)).toBe(': keepalive\n\n')
  })

  // Heartbeat ignores any id or data — the comment string is canonical.
  it('ignores id and data fields for the heartbeat sentinel', () => {
    expect(encodeSseEvent({ id: '99', type: 'heartbeat', data: { foo: 1 } })).toBe(
      ': keepalive\n\n',
    )
  })

  // Full event with id, custom type, and object data.
  it('encodes id + custom event type + JSON object data', () => {
    const result = encodeSseEvent({ id: '1', type: 'chat', data: { text: 'hi' } })
    expect(result).toBe('id: 1\nevent: chat\ndata: {"text":"hi"}\n\n')
  })

  // Absent id means no id: line — only event: and data: are emitted.
  it('omits the id line when event.id is absent', () => {
    const result = encodeSseEvent({ type: 'notify', data: 'hello' })
    expect(result).toBe('event: notify\ndata: hello\n\n')
  })

  // Falsy id (empty string) is treated the same as absent.
  it('omits the id line when event.id is an empty string', () => {
    const result = encodeSseEvent({ id: '', type: 'ping', data: null } as never)
    expect(result).toBe('event: ping\ndata: \n\n')
  })

  // The "message" type is the W3C default and must NOT produce an event: line.
  it('omits the event line when type is "message"', () => {
    const result = encodeSseEvent({ id: '2', type: 'message', data: 'ping' })
    expect(result).toBe('id: 2\ndata: ping\n\n')
  })

  // Absent type (undefined) behaves the same as "message" — no event: line.
  it('omits the event line when type is undefined', () => {
    const result = encodeSseEvent({ id: '3', data: 'pong' })
    expect(result).toBe('id: 3\ndata: pong\n\n')
  })

  // Multi-line string data is split into one data: line per newline character.
  it('splits multi-line string data into multiple data: lines', () => {
    const result = encodeSseEvent({ type: 'log', data: 'a\nb\nc' })
    expect(result).toBe('event: log\ndata: a\ndata: b\ndata: c\n\n')
  })

  // String data is passed through as-is without JSON serialization.
  it('passes string data through without JSON serialization', () => {
    const result = encodeSseEvent({ type: 'raw', data: 'just a string' })
    expect(result).toBe('event: raw\ndata: just a string\n\n')
  })

  // null data serializes to an empty string → "data: \n\n".
  it('serializes null data to an empty data: line', () => {
    const result = encodeSseEvent({ type: 'empty', data: null } as never)
    expect(result).toBe('event: empty\ndata: \n\n')
  })

  // undefined data serializes to an empty string → "data: \n\n".
  it('serializes undefined data to an empty data: line', () => {
    const result = encodeSseEvent({ type: 'empty', data: undefined } as never)
    expect(result).toBe('event: empty\ndata: \n\n')
  })

  // Number data is JSON-stringified.
  it('JSON-stringifies numeric data', () => {
    const result = encodeSseEvent({ type: 'count', data: 42 } as never)
    expect(result).toBe('event: count\ndata: 42\n\n')
  })

  // Boolean data is JSON-stringified.
  it('JSON-stringifies boolean data', () => {
    const result = encodeSseEvent({ type: 'flag', data: true } as never)
    expect(result).toBe('event: flag\ndata: true\n\n')
  })

  // Array data is JSON-stringified (single line — no newlines in JSON).
  it('JSON-stringifies array data', () => {
    const result = encodeSseEvent({ type: 'list', data: [1, 2, 3] })
    expect(result).toBe('event: list\ndata: [1,2,3]\n\n')
  })

  // Verify the wire format always ends with exactly two newlines.
  it('always terminates the encoded frame with \\n\\n', () => {
    const result = encodeSseEvent({ type: 'connection:established', data: { connectionId: 'abc' } })
    expect(result.endsWith('\n\n')).toBe(true)
  })
})
