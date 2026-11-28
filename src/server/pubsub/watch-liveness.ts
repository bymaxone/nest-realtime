/**
 * @fileoverview Notices a Redis connection that is open and silent, which raises no event of its own.
 * @layer infrastructure
 */
import type { Redis } from 'ioredis'
import { fromClient, isErrorReply } from './redis-failure'

/** How often a connected client is asked whether the server is still there. */
export const PROBE_INTERVAL_MS = 10_000

/** How long a PING waits for any answer before the connection is taken to be dead. */
export const PROBE_DEADLINE_MS = 5_000

/** Sends a PING. An error reply (NOPERM, BUSY, LOADING) is an answer; the client's own is not. */
function ask(client: Redis, answered: () => void, gaveUp: () => void): void {
  fromClient(() => client.ping()).then(answered, (err: unknown) => {
    if (isErrorReply(err)) answered()
    else gaveUp()
  })
}

/**
 * The host's `commandTimeout` would cut a PING's deadline short, so it is lifted while the client is
 * ready. The handshake keeps it: there it is what recycles a connection that never answers.
 */
function commandTimeoutOf(client: Redis): { lift: () => void; restore: () => void } {
  let bound: number | undefined
  return {
    lift: () => {
      bound ??= client.options.commandTimeout
      delete client.options.commandTimeout
    },
    restore: () => {
      if (bound !== undefined) client.options.commandTimeout = bound
    },
  }
}

/**
 * From each `ready` to the next `close`, sends a PING every {@link PROBE_INTERVAL_MS}, one at a
 * time, and calls `silent` when one gets no answer in {@link PROBE_DEADLINE_MS} or the client gives
 * up on it. An error reply is an answer. Neither timer keeps the process alive. The client's
 * `commandTimeout` is lifted for the same span, so register this before any other `ready` listener
 * that sends a command. Returns the function that stops the watch for good.
 */
export function watchLiveness(client: Redis, silent: () => void): () => void {
  let pending: object | undefined
  let deadline: NodeJS.Timeout | undefined
  let interval: NodeJS.Timeout | undefined
  let stopped = false
  const timeout = commandTimeoutOf(client)
  const forget = (): void => {
    pending = undefined
    clearTimeout(deadline)
  }
  const probe = (): void => {
    // The interval can come due again before a stalled deadline has been looked at.
    if (pending !== undefined) return
    const asked = {}
    pending = asked
    const settle = (answered: boolean): void => {
      if (pending !== asked) return
      forget()
      if (!answered) silent()
    }
    // After the event loop stalls, a due timer runs before a reply already received is read: one
    // turn of I/O goes first.
    const expire = (): void => {
      setImmediate(settle, false)
    }
    deadline = setTimeout(expire, PROBE_DEADLINE_MS)
    deadline.unref()
    ask(client, () => settle(true), expire)
  }
  // A PING in flight on a connection that closed says nothing about the next one.
  const rest = (): void => {
    clearInterval(interval)
    forget()
  }
  client.on('ready', () => {
    if (stopped) return
    rest()
    timeout.lift()
    interval = setInterval(probe, PROBE_INTERVAL_MS)
    interval.unref()
  })
  client.on('close', () => {
    rest()
    timeout.restore()
  })
  return () => {
    stopped = true
    rest()
  }
}
