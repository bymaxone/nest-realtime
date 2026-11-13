/**
 * @fileoverview The size counted for an event is what Nest writes for it.
 * @layer transport
 */
import { SseStream } from '@nestjs/core/router/sse-stream'
import { frameBytes } from './frame-size'
import type { Frame } from './frame-size'

/** What Nest writes for a message, read from its own stream. */
function written(message: Frame): number {
  const stream = new SseStream()
  let total = 0
  stream.on('data', (chunk: string | Buffer) => {
    total += Buffer.byteLength(chunk)
  })
  stream.write(message)
  return total
}

const frame = (over: Partial<Frame> = {}): Frame => ({
  id: '1-000001',
  type: 'tick',
  data: {},
  ...over,
})

describe('frameBytes', () => {
  // The estimate is compared with the bytes SseStream produces, so a change in Nest's framing fails here.
  it.each([
    ['an object', frame({ data: { a: 1, b: 'two', c: [3] } })],
    ['a string', frame({ data: 'hello' })],
    ['a string with quotes', frame({ data: 'a"b\\c' })],
    ['multibyte text', frame({ data: { text: 'héllo wörld ✓' }, type: 'événement' })],
    ['no data', { id: '1-000001', type: 'tick' }],
    ['a long event name', frame({ type: 'x'.repeat(5000) })],
    ['no event name', frame({ type: '' })],
    ['a name and an id with line breaks', frame({ type: 'a\r\nb', id: 'c\nd' })],
  ])('is exactly what Nest writes for %s', (_label, message) => {
    expect(frameBytes(message)).toBe(written(message))
  })

  it('counts null data as nothing, as Nest writes none', () => {
    const message = frame({ data: null as unknown as object })
    expect(frameBytes(message)).toBe(written(message))
  })

  // A payload with no JSON form is written as an empty data line, which Nest cannot actually do for
  // a function, so only that nothing is counted for its text is asserted.
  it('counts a payload with no JSON form as an empty data line', () => {
    const message = frame({ data: (() => undefined) as unknown as object })
    const noData: Frame = { id: message.id, type: message.type }

    expect(frameBytes(message)).toBe(frameBytes(noData) + 'data: \n'.length)
  })

  // A multi-line string is written with a prefix on each line; counting it as one line stays below that.
  it('never counts more than Nest writes for a multi-line string', () => {
    const message = frame({ data: 'one\ntwo\r\nthree' })

    expect(frameBytes(message)).toBeLessThan(written(message))
  })

  it('computes a frame once', () => {
    const message = frame()
    const first = frameBytes(message)
    const spy = jest.spyOn(JSON, 'stringify')

    expect(frameBytes(message)).toBe(first)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
