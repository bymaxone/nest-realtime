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

  // Scenario: the tracer the library asks for. Expected: the one named for the package, so a host can filter it.
  it('asks for the tracer named for the package', async () => {
    stop()
    const { trace } = await import('@opentelemetry/api')
    const getTracer = jest.fn((..._args: unknown[]) => ({
      startSpan: () => undefined,
      startActiveSpan: () => undefined,
    }))
    trace.setGlobalTracerProvider({ getTracer } as never)
    const tracing = await ready()
    await tracing.span('realtime.handshake', {}, async () => 'ok')
    expect(getTracer.mock.calls[0]?.[0]).toBe('@bymax-one/nest-realtime')
  })

  // Scenario: errors that are not a library code, whatever they are. Expected: the generic marker; a code
  // buried in a longer text, or a lower-case one, is not a code.
  it.each([
    ['null', null],
    ['a number', 7],
    ['a string that is a code', 'REALTIME_AUTH_FAILED'],
    ['a code inside a longer text', new Error('x REALTIME_AUTH_FAILED')],
    ['a code followed by text', new Error('REALTIME_AUTH_FAILED and more')],
    ['a lower-case code', new Error('realtime_auth_failed')],
    ['an error with a non-string message', Object.assign(new Error('x'), { message: 7 })],
  ])('names %s as the generic marker', async (_name, error) => {
    const tracing = await ready()
    await expect(tracing.span('realtime.handshake', {}, () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(spans[0]?.status).toEqual({ code: 2, message: 'REALTIME_ERROR' })
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

  // Scenario: the tracer throws. Expected: before it runs the operation, the operation runs once without a span;
  // after it ran it, the operation's own result comes back and it is not run a second time.
  it.each([
    ['before', false],
    ['after', true],
  ])('runs the operation once when the tracer throws %s starting it', async (_when, after) => {
    stop()
    const { trace } = await import('@opentelemetry/api')
    trace.setGlobalTracerProvider({
      getTracer: () => ({
        startSpan: () => undefined,
        startActiveSpan: (...args: unknown[]) => {
          if (after)
            (args[args.length - 1] as (span: unknown) => unknown)({ setStatus() {}, end() {} })
          throw new Error('tracer down')
        },
      }),
    } as never)
    const tracing = await ready()
    const run = jest.fn(async () => 'ok')
    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
    trace.disable()
  })

  // Scenario: whatever the tracer returns or throws, the operation runs once and its own result or error comes back.
  // A tracer that returns a non-promise without running the operation, one whose end() or setStatus() throws and
  // one whose returned promise rejects after it ran the operation must not change the outcome.
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  async function withTracer(
    startActiveSpan: (...args: unknown[]) => unknown,
  ): Promise<RealtimeTracing> {
    stop()
    const { trace } = await import('@opentelemetry/api')
    trace.setGlobalTracerProvider({
      getTracer: () => ({ startSpan: () => undefined, startActiveSpan }),
    } as never)
    return ready()
  }

  const callback = (args: unknown[]): ((span: unknown) => unknown) =>
    args[args.length - 1] as (span: unknown) => unknown

  it('runs the operation once when the tracer returns a non-promise without running it', async () => {
    const tracing = await withTracer(() => 'not a promise')
    const run = jest.fn(async () => 'ok')
    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs the operation once when the tracer runs the callback twice', async () => {
    const tracing = await withTracer((...args: unknown[]) => {
      const start = callback(args)
      start({ setStatus() {}, end() {} })
      return start({ setStatus() {}, end() {} })
    })
    const run = jest.fn(async () => 'ok')
    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs the operation once when the tracer runs the callback after span has returned', async () => {
    const tracing = await withTracer((...args: unknown[]) => {
      const start = callback(args)
      setImmediate(() => start({ setStatus() {}, end() {} }))
      return undefined
    })
    const run = jest.fn(async () => 'ok')
    await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves no unhandled rejection when the span calls answer with a rejected promise', async () => {
    process.on('unhandledRejection', onUnhandled)
    try {
      const tracing = await withTracer((...args: unknown[]) =>
        callback(args)({
          setStatus: () => Promise.reject(new Error('status down')),
          end: () => Promise.reject(new Error('end down')),
        }),
      )
      const failure = new Error('operation failed')
      await expect(
        tracing.span('realtime.handshake', {}, () => Promise.reject(failure)),
      ).rejects.toBe(failure)
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('returns the result when the span cannot be ended', async () => {
    const tracing = await withTracer((...args: unknown[]) =>
      callback(args)({
        setStatus() {},
        end() {
          throw new Error('end down')
        },
      }),
    )
    await expect(tracing.span('realtime.handshake', {}, async () => 'ok')).resolves.toBe('ok')
  })

  it('rethrows the operation error when the status cannot be set', async () => {
    const tracing = await withTracer((...args: unknown[]) =>
      callback(args)({
        setStatus() {
          throw new Error('status down')
        },
        end() {},
      }),
    )
    const failure = new Error('operation failed')
    await expect(
      tracing.span('realtime.handshake', {}, () => Promise.reject(failure)),
    ).rejects.toBe(failure)
  })

  it('returns the result and leaves no unhandled rejection when the tracer rejects after running it', async () => {
    process.on('unhandledRejection', onUnhandled)
    try {
      const tracing = await withTracer(async (...args: unknown[]) => {
        await callback(args)({ setStatus() {}, end() {} })
        throw new Error('late tracer failure')
      })
      const run = jest.fn(async () => 'ok')
      await expect(tracing.span('realtime.handshake', {}, run)).resolves.toBe('ok')
      await new Promise((resolve) => setImmediate(resolve))
      expect(run).toHaveBeenCalledTimes(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  // Scenario: the span is used before the module initialised. Expected: the operation runs without a span.
  it('runs the operation before the API has been loaded', async () => {
    const tracing = new RealtimeTracing()
    await expect(tracing.span('realtime.handshake', {}, async () => 'ok')).resolves.toBe('ok')
    expect(spans).toHaveLength(0)
  })
})
