/**
 * @fileoverview Find where a response reports that its connection has ended.
 * @layer transport
 */
import type { SseResponse } from '../../interfaces/sse-http.interface'

/** What the emitters a response can report its close on offer. */
interface CloseEmitter {
  once?(event: 'close', listener: () => void): unknown
  off?(event: 'close', listener: () => void): unknown
}

/**
 * Call `listener` once when the response's connection ends, on whichever object the framework
 * exposes that on: the response itself (Express), the Node response behind a wrapper (Fastify's
 * `reply.raw`), or the socket. Does nothing when the response offers none of them.
 *
 * @returns A function that removes the listener. The socket outlives the request on a keep-alive
 *   connection, so a listener left on it by each request would grow for as long as the client stays.
 */
export function onResponseClose(res: SseResponse | undefined, listener: () => void): () => void {
  const emitter: CloseEmitter | undefined =
    [res, res?.raw, res?.socket].find((candidate) => candidate?.once) ?? undefined
  emitter?.once?.('close', listener)
  return () => void emitter?.off?.('close', listener)
}
