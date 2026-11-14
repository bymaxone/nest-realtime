/**
 * @fileoverview Closing a Redis connection without waiting on a server that has stopped answering.
 * @layer infrastructure
 */

/** The part of an ioredis client that closing a connection uses. */
export interface QuitableClient {
  quit(): Promise<unknown>
  disconnect(): void
}

/**
 * How long closing waits for a QUIT to be answered before it disconnects the connection. A healthy
 * Redis answers in milliseconds, so the bound only matters when it does not: a paused or
 * partitioned server accepts the socket and never replies, and a shutdown that waited for it would
 * outlast the time an orchestrator allows between the stop signal and the kill.
 */
export const QUIT_WAIT_MS = 2_000

/**
 * Quits `client`, waiting at most `ms` for the server to answer, and disconnects it when it did
 * not. QUIT is a command on the connection, so on a connection that no longer answers it never
 * settles and nothing in ioredis bounds it. A client whose QUIT was answered is already closed and
 * is left alone: disconnecting it again would arm ioredis's close timer on a socket that has no
 * close left to clear it.
 *
 * Never rejects: an error from QUIT (a connection that is already closed) is the same outcome as a
 * server that did not answer, and the connection is disconnected.
 *
 * @param client - The connection to close.
 * @param ms - How long to wait for the QUIT to be answered.
 */
export async function quitWithin(client: QuitableClient, ms: number = QUIT_WAIT_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const bound = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
    // The wait must not keep the process alive: the connection is what the process is closing.
    timer.unref()
  })
  const answered = client.quit().then(
    () => true,
    () => false,
  )
  try {
    if (!(await Promise.race([answered, bound]))) client.disconnect()
  } finally {
    clearTimeout(timer)
  }
}
