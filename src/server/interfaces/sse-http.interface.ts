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
 * The endpoint reads three fields from the request — `headers`, `ip`, `query` —
 * and does two things to the response: sets the anti-buffering headers, and
 * writes the keepalive comment. An `express.Request` satisfies these interfaces
 * without being named by them, and so does a Fastify request, because
 * assignability is structural.
 */

/** A header value as an HTTP server exposes it, before normalization. */
export type SseHeaderValue = string | string[] | undefined

/** The request fields the SSE endpoint reads. */
export interface SseRequest {
  /**
   * Request headers, keyed as the HTTP framework delivers them. Node lowercases
   * incoming header names, and the endpoint looks them up lowercase — `cookie`,
   * `user-agent` and `last-event-id` — so an adapter that
   * preserves the client's casing has to lowercase the keys before it gets here,
   * or those lookups miss.
   */
  readonly headers: Readonly<Record<string, SseHeaderValue>>
  /**
   * Client address as the HTTP framework resolved it under the application's trusted-proxy
   * setting, when it resolves one. The endpoint validates it before using it.
   */
  readonly ip?: string | undefined
  /**
   * The addresses behind `ip`, from the client end toward the socket, when the framework reports
   * them (Express and Fastify do under a trusted-proxy setting). Each entry after the first is a
   * hop that setting already vouched for.
   */
  readonly ips?: readonly string[] | undefined
  /**
   * The underlying connection, when the framework exposes it (Express and Fastify do as
   * `req.socket`). Its `remoteAddress` is the TCP peer, unlike `ip`, which a trusted-proxy
   * setting can derive from a header.
   */
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined
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
