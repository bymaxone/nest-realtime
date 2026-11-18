/**
 * @fileoverview The seam that wraps an operation in an OpenTelemetry span when the optional peer is installed.
 * @layer services
 */
import { Injectable } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'

/** The span names the library starts. */
export type RealtimeSpanName = 'realtime.handshake' | 'realtime.reauthenticate'

/** Attributes are closed: a transport name or an outcome, never an id, a tenant or a payload. */
export type RealtimeSpanAttributes = Readonly<Record<string, string>>

/** The few members of the API the seam uses, so that no declaration here imports an optional peer. */
interface Span {
  setStatus(status: { code: number; message?: string }): void
  end(): void
}
interface OtelApi {
  trace: {
    getTracer(name: string): {
      startActiveSpan<T>(
        name: string,
        options: { attributes: RealtimeSpanAttributes },
        fn: (span: Span) => T,
      ): T
    }
  }
}

/** `SpanStatusCode.ERROR`, inlined because the enum lives in the package that may be absent. */
const STATUS_ERROR = 2
const TRACER_NAME = '@bymax-one/nest-realtime'
const LIBRARY_CODE = /^REALTIME_[A-Z_]+$/

/** The library code an error carries, or a generic marker; the text of an arbitrary message never leaves. */
function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'REALTIME_ERROR'
  const { code, message, data } = error as {
    code?: unknown
    message?: unknown
    data?: { code?: unknown } | null
  }
  for (const candidate of [code, data?.code, message]) {
    if (typeof candidate === 'string' && LIBRARY_CODE.test(candidate)) return candidate
  }
  return 'REALTIME_ERROR'
}

/**
 * Starts a span around an operation when `@opentelemetry/api` is installed, and runs it bare otherwise.
 *
 * The peer is optional, so it is loaded with a dynamic `import()` that a missing package turns into a no-op:
 * the root bundle never names it statically, and an application that does not trace installs nothing. With
 * the API present and no SDK registered the API itself is a no-op. A span carries a closed set of attributes
 * and, on failure, the library error code and nothing of the message.
 */
@Injectable()
export class RealtimeTracing implements OnModuleInit {
  #api: OtelApi | undefined

  /** Load the API once, at start-up; a package that is not there leaves the seam inert. */
  async onModuleInit(): Promise<void> {
    try {
      this.#api = (await import('@opentelemetry/api')) as unknown as OtelApi
    } catch {
      this.#api = undefined
    }
  }

  private async traced<T>(span: Span, run: () => Promise<T>): Promise<T> {
    try {
      const result = await run()
      span.end()
      return result
    } catch (error) {
      span.setStatus({ code: STATUS_ERROR, message: codeOf(error) })
      span.end()
      throw error
    }
  }

  /**
   * Run `run` inside a span named `name`.
   *
   * @param name - One of the library's span names.
   * @param attributes - Closed-set attributes of the span.
   * @param run - The operation; its result or its error passes through unchanged.
   */
  span<T>(
    name: RealtimeSpanName,
    attributes: RealtimeSpanAttributes,
    run: () => Promise<T>,
  ): Promise<T> {
    const api = this.#api
    if (!api) return run()
    let started: Promise<T> | undefined
    try {
      return api.trace
        .getTracer(TRACER_NAME)
        .startActiveSpan(name, { attributes }, (span): Promise<T> => {
          started = this.traced(span, run)
          return started
        })
    } catch {
      // A tracer that throws must not decide what its operation does: run it bare, or take the result of
      // the run it had already started, so that it never runs twice.
      return started ?? run()
    }
  }
}
