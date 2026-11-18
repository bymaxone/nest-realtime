/**
 * @fileoverview A tracer provider that records the spans started through `@opentelemetry/api`, for specs.
 * @layer test
 */
import { trace } from '@opentelemetry/api'

/** What a recorded span held when the test read it: its name, attributes, final status and how often it ended. */
export interface RecordedSpan {
  readonly name: string
  readonly attributes: Record<string, unknown>
  status: { code: number; message?: string } | undefined
  ended: number
  exceptions: number
}

/** Register a provider that records every span; returns the record and a function that unregisters it. */
export function recordSpans(): { spans: RecordedSpan[]; stop: () => void } {
  const spans: RecordedSpan[] = []
  const make = (
    name: string,
    options?: { attributes?: Record<string, unknown> },
  ): RecordedSpan & {
    setStatus(status: { code: number; message?: string }): void
    end(): void
    recordException(): void
    setAttribute(): void
    spanContext(): object
  } => {
    const span = {
      name,
      attributes: { ...(options?.attributes ?? {}) },
      status: undefined as RecordedSpan['status'],
      ended: 0,
      exceptions: 0,
      setStatus(status: { code: number; message?: string }) {
        span.status = status
      },
      end() {
        span.ended += 1
      },
      recordException() {
        span.exceptions += 1
      },
      setAttribute() {},
      spanContext: () => ({}),
    }
    spans.push(span)
    return span
  }
  const tracer = {
    startSpan: make,
    startActiveSpan(name: string, ...rest: unknown[]) {
      const fn = rest[rest.length - 1] as (span: unknown) => unknown
      const options = (rest.length > 1 ? rest[0] : undefined) as
        { attributes?: Record<string, unknown> } | undefined
      return fn(make(name, options))
    },
  }
  trace.setGlobalTracerProvider({ getTracer: () => tracer } as never)
  return { spans, stop: () => trace.disable() }
}
