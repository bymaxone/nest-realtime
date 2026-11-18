/**
 * @fileoverview The tracing seam wraps an operation in a span when `@opentelemetry/api` is there, and only then.
 * @layer services
 */
import { recordSpans } from '../../../test/support/recording-tracer'
import type { RecordedSpan } from '../../../test/support/recording-tracer'
import { RealtimeTracing } from './realtime-tracing'

const SENTINEL = 'SENTINEL-secret-9f2'

describe('RealtimeTracing', () => {
  let spans: RecordedSpan[]
  let stop: () => void

  beforeEach(() => {
    const recording = recordSpans()
    spans = recording.spans
    stop = recording.stop
  })

  afterEach(() => {
    stop()
    jest.resetModules()
    jest.dontMock('@opentelemetry/api')
  })

  async function ready(): Promise<RealtimeTracing> {
    const tracing = new RealtimeTracing()
    await tracing.onModuleInit()
    return tracing
  }

  // Scenario: an operation under a registered provider. Expected: one span with the name and the attributes
  // given, ended once, and the operation's own result returned unchanged.
  it('records a span for an operation and returns its result', async () => {
    const tracing = await ready()
    const result = await tracing.span(
      'realtime.handshake',
      { 'bymax.realtime.transport': 'sse' },
      async () => 42,
    )
    expect(result).toBe(42)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      name: 'realtime.handshake',
      attributes: { 'bymax.realtime.transport': 'sse' },
      ended: 1,
    })
    expect(spans[0]?.status).toBeUndefined()
  })

  // Scenario: the operation throws an error that carries a library code. Expected: the span is ERROR with that
  // code and nothing else, the same error is rethrown, and the span still ends once.
  it('marks the span as an error with the library code and rethrows', async () => {
    const tracing = await ready()
    const failure = Object.assign(new Error(`leaks ${SENTINEL}`), { code: 'REALTIME_AUTH_FAILED' })
    await expect(
      tracing.span('realtime.handshake', {}, async () => Promise.reject(failure)),
    ).rejects.toBe(failure)
    expect(spans[0]?.status).toEqual({ code: 2, message: 'REALTIME_AUTH_FAILED' })
    expect(JSON.stringify(spans)).not.toContain(SENTINEL)
    expect(spans[0]?.ended).toBe(1)
    expect(spans[0]?.exceptions).toBe(0)
  })

  // Scenario: an error with no library code, or a HttpException-shaped one whose message is the code. Expected:
  // the code when the message is one, a generic marker otherwise, and never the text of an arbitrary message.
  it.each([
    [new Error(`boom ${SENTINEL}`), 'REALTIME_ERROR'],
    [
      Object.assign(new Error('REALTIME_AUTH_FAILED'), { getStatus: () => 401 }),
      'REALTIME_AUTH_FAILED',
    ],
    ['a string', 'REALTIME_ERROR'],
    [
      Object.assign(new Error('Internal Server Error'), {
        data: { code: 'REALTIME_TRANSPORT_UNAVAILABLE' },
      }),
      'REALTIME_TRANSPORT_UNAVAILABLE',
    ],
  ])('names the error %p as %s', async (error, code) => {
    const tracing = await ready()
    await expect(tracing.span('realtime.handshake', {}, () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(spans[0]?.status).toEqual({ code: 2, message: code })
  })

  // Scenario: no SDK is registered, which is the default. Expected: the API is a no-op, the operation runs and
  // its result comes back.
  it('runs the operation when no provider is registered', async () => {
    stop()
    const tracing = await ready()
    await expect(tracing.span('realtime.handshake', {}, async () => 'ok')).resolves.toBe('ok')
  })

  // Scenario: `@opentelemetry/api` is not installed, as in an application that does not trace. Expected: the
  // operation still runs and nothing throws.
  it('runs the operation when the API is not installed', async () => {
    jest.resetModules()
    jest.doMock('@opentelemetry/api', () => {
      throw new Error("Cannot find module '@opentelemetry/api'")
    })
    const { RealtimeTracing: Fresh } = await import('./realtime-tracing')
    const tracing = new Fresh()
    await tracing.onModuleInit()
    await expect(tracing.span('realtime.handshake', {}, async () => 'ok')).resolves.toBe('ok')
  })

  // Scenario: the span is used before the module initialised. Expected: the operation runs without a span.
  it('runs the operation before the API has been loaded', async () => {
    const tracing = new RealtimeTracing()
    await expect(tracing.span('realtime.handshake', {}, async () => 'ok')).resolves.toBe('ok')
    expect(spans).toHaveLength(0)
  })
})
