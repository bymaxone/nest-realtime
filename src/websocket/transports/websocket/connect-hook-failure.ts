/**
 * @fileoverview The error a connection that `onConnect` failed for is closed with, under `onConnectFailure: 'close'`.
 * @layer transport
 */

/**
 * Raised when the `onConnect` hook failed and `onConnectFailure` is `'close'`. The connection was admitted
 * and registered before the hook ran, so the gateway closes it and logs why, and does not count it as a
 * refused handshake: the SSE transport admits and then completes the stream the same way. The host's own
 * error is the `cause`; its text is not in the message.
 */
export class ConnectHookFailure extends Error {
  constructor(cause: unknown) {
    super('onConnect hook failed', { cause })
    this.name = 'ConnectHookFailure'
  }
}
