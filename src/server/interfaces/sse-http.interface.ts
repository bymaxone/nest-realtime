/**
 * @fileoverview The HTTP shape the SSE endpoint depends on.
 * @layer contracts
 *
 * Structural on purpose, rather than `express.Request` and `express.Response`.
 *
 * Naming Express would make the published declarations import its types, and
 * `@types/express` is not a dependency of this package — nor an optional peer, so
 * a consumer compiling with `skipLibCheck: false` would have no supported way to
 * satisfy it. It would also be the wrong type for an application on Fastify,
 * which NestJS supports equally.
 *
 * The endpoint reads four things from the request and sets two response headers.
 * An `express.Request` satisfies these interfaces without being named by them,
 * and so does a Fastify request, because assignability is structural.
 */

/** A header value as an HTTP server exposes it, before normalization. */
export type SseHeaderValue = string | string[] | undefined

/** The request fields the SSE endpoint reads. */
export interface SseRequest {
  /** Raw request headers, in whatever casing the client sent. */
  readonly headers: Readonly<Record<string, SseHeaderValue>>
  /** Remote address as the HTTP framework resolved it, when it resolves one. */
  readonly ip?: string | undefined
  /** Parsed query string. Values are narrowed to strings by the caller. */
  readonly query: Readonly<Record<string, unknown>>
}

/**
 * The response surface the SSE endpoint uses: anti-buffering headers, and a
 * writable stream for the keepalive.
 *
 * `write` is structurally the same contract as `HeartbeatWritable`, which the
 * heartbeat declares for itself so it can be driven by any writable in a test.
 * It is repeated here rather than imported so the contracts layer does not depend
 * on a service module.
 */
export interface SseResponse {
  /** Set a response header before the stream begins. */
  setHeader(name: string, value: string): unknown
  /** Write raw bytes to the open stream — the `: keepalive` comment. */
  write(chunk: string): unknown
}
