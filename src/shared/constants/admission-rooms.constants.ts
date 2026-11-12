/**
 * @fileoverview Bounds on the rooms an authenticator may join a connection to at admission.
 * @layer shared
 */

/**
 * Bounds applied to `AuthenticationResult.rooms`.
 *
 * Both values are bounds against abuse, not measurements: they keep a buggy or
 * hostile authenticator from joining a connection to an unbounded set of rooms or to
 * a room whose name is a payload. Neither was derived from a benchmark or from a
 * limit of Socket.IO or of the registries, and neither is a recommendation — a host
 * that needs few rooms should use far fewer. They apply only to the `rooms` field;
 * `joinRoom` takes any room name, as it always has.
 */
export const ADMISSION_ROOM_LIMITS = {
  /** The most rooms one authentication result may carry. */
  MAX_ROOMS: 32,
  /** The longest room name, in UTF-16 code units (`String.prototype.length`). */
  MAX_ROOM_NAME_LENGTH: 256,
} as const
