/**
 * @fileoverview What the library forwards of an error raised by a Redis client.
 * @layer infrastructure
 *
 * A log, a rejection or a hook is given a message the library wrote, never the client's
 * own text.
 */
import { NativeError } from '../utils/captured-builtins'

/** A Redis reply code is one upper-case word, such as `OOM` or `WRONGPASS`. */
const REPLY_CODE = /^[A-Z]{2,24}(?= |$)/

/** A system error code, such as `ECONNREFUSED`. */
const SYSTEM_CODE = /^E[A-Z_]{2,32}$/

/** The name ioredis gives an error reply, which the adapter tells a refusal by. */
const REPLY_ERROR = 'ReplyError'

/** One property of whatever was raised, if it is text and can be read. */
function textOf(raised: unknown, key: 'name' | 'message' | 'code'): string {
  try {
    const value = (raised as Partial<Record<typeof key, unknown>> | null | undefined)?.[key]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/**
 * A new error that holds the library's own message and, of the original, only the reply code of an
 * error reply or the system code of a connection error. The original is not kept as `cause`.
 *
 * @param raised - Whatever the client rejected or emitted.
 * @returns An error named `ReplyError` for an error reply, and `Error` otherwise.
 */
export function redisFailure(raised: unknown): Error {
  if (textOf(raised, 'name') !== REPLY_ERROR) {
    const system = SYSTEM_CODE.exec(textOf(raised, 'code'))
    return new NativeError(`the Redis client failed${system ? ` (${system[0]})` : ''}`)
  }
  const reply = REPLY_CODE.exec(textOf(raised, 'message'))
  const error = new NativeError(`the Redis server replied ${reply ? reply[0] : 'with an error'}`)
  error.name = REPLY_ERROR
  return error
}
