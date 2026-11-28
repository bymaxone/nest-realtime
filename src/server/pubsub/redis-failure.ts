/**
 * @fileoverview What the library forwards of an error raised by a Redis client.
 * @layer infrastructure
 *
 * A log, a rejection or a hook is given a message the library wrote, never the client's
 * own text. Reading what the client raised can run code of its own, so the reads made here
 * are guarded.
 */
import { assertBuiltinsIntact } from '../utils/builtin-baseline'
import { NativeError } from '../utils/captured-builtins'

/** A Redis reply code is one upper-case word, such as `OOM` or `WRONGPASS`. */
const REPLY_CODE = /^[A-Z]{2,24}(?= |$)/

/** A system error code, such as `ECONNREFUSED`. */
const SYSTEM_CODE = /^E[A-Z_]{2,32}$/

/** The name ioredis gives an error reply, which the adapter tells a refusal by. */
const REPLY_ERROR = 'ReplyError'

/** The whole of that name. */
const REPLY_NAME = /^ReplyError$/

/** What `pattern` finds in one property of whatever was raised, if that is text and can be read. */
function find(
  raised: unknown,
  key: 'name' | 'message' | 'code',
  pattern: RegExp,
): RegExpExecArray | null {
  try {
    const value = (raised as Partial<Record<typeof key, unknown>> | null | undefined)?.[key]
    return typeof value === 'string' ? pattern.exec(value) : null
  } catch {
    return null
  }
}

/**
 * Whether what was raised is an error reply of the server; false when it cannot be read.
 *
 * @param raised - Whatever the client rejected or emitted.
 */
export function isErrorReply(raised: unknown): boolean {
  return find(raised, 'name', REPLY_NAME) !== null
}

/**
 * A call into the client. What it throws instead of returning is reduced like a rejection.
 *
 * @param call - The call to make.
 * @returns What the call returns.
 * @throws The reduced error, or the library's own refusal when a built-in was replaced.
 */
export function fromClient<T>(call: () => T): T {
  try {
    return call()
  } catch (error) {
    assertBuiltinsIntact()
    throw redisFailure(error)
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
  if (!isErrorReply(raised)) {
    const system = find(raised, 'code', SYSTEM_CODE)
    return new NativeError(`the Redis client failed${system ? ` (${system[0]})` : ''}`)
  }
  const reply = find(raised, 'message', REPLY_CODE)
  const error = new NativeError(`the Redis server replied ${reply ? reply[0] : 'with an error'}`)
  error.name = REPLY_ERROR
  return error
}
