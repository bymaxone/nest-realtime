/**
 * @fileoverview A span the tracer hands over after the operation was already claimed is ended by the seam.
 * @layer services
 */
import { RealtimeTracing } from './realtime-tracing'

describe('RealtimeTracing: a callback the tracer runs late or twice', () => {
  afterEach(async () => {
    const { trace } = await import('@opentelemetry/api')
    trace.disable()
  })

  async function withTracer(startActiveSpan: (...args: unknown[]) => unknown) {
    const { trace } = await import('@opentelemetry/api')
    trace.setGlobalTracerProvider({
      getTracer: () => ({ startSpan: () => undefined, startActiveSpan }),
    } as never)
    const tracing = new RealtimeTracing()
    await tracing.onModuleInit()
    return tracing
  }

  // Scenario: the tracer returns without calling back, so the operation runs bare, and calls back afterwards with a span.
  // Expected: the operation ran once and the span it handed over is ended once.
  it('ends the span handed over after the operation ran bare', async () => {
    let late: ((span: unknown) => unknown) | undefined
    const tracing = await withTracer((...args) => {
      late = args[args.length - 1] as (span: unknown) => unknown
      return undefined
    })
    const end = jest.fn()
    const run = jest.fn(async () => 'ok')

    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
    late?.({ setStatus: () => undefined, end })

    expect(run).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })

  // Scenario: the tracer calls back twice with two spans. Expected: the first runs the operation and ends with it, the
  // second is ended as well, and the operation ran once.
  it('ends the second span a tracer hands over', async () => {
    const ends = [jest.fn(), jest.fn()]
    const tracing = await withTracer((...args) => {
      const call = args[args.length - 1] as (span: unknown) => unknown
      call({ setStatus: () => undefined, end: ends[0] })
      return call({ setStatus: () => undefined, end: ends[1] })
    })
    const run = jest.fn(async () => 'ok')

    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')

    expect(run).toHaveBeenCalledTimes(1)
    expect(ends.map((end) => end.mock.calls.length)).toEqual([1, 1])
  })
})
