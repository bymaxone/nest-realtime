/**
 * @fileoverview Find where a response reports that its connection has ended.
 * @layer transport
 */
import type { SseResponse } from '../../interfaces/sse-http.interface'

/**
 * Call `listener` once when the response's connection ends, on whichever object the framework
 * exposes that on: the response itself (Express), the Node response behind a wrapper (Fastify's
 * `reply.raw`), or the socket. Does nothing when the response offers none of them.
 */
export function onResponseClose(res: SseResponse | undefined, listener: () => void): void {
  if (res?.once) res.once('close', listener)
  else if (res?.raw?.once) res.raw.once('close', listener)
  else res?.socket?.once?.('close', listener)
}
