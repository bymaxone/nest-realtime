/**
 * @fileoverview The origin policy of the WebSocket handshake: which request engine.io may serve, decided before a socket exists.
 * @layer infrastructure
 */
import type { IncomingMessage } from 'node:http'
import {
  REALTIME_ERROR_CODES,
  realtimeError,
  type BymaxRealtimeModuleOptions,
} from '@bymax-one/nest-realtime/internal'

/** What engine.io hands `allowRequest` to answer with: `success` false refuses the request with a 403. */
type Answer = (message: string | null | undefined, success: boolean) => void

/** The `allowRequest` of an engine.io server: it is given the request and answers once. */
export type AllowRequest = (request: IncomingMessage, answer: Answer) => void

/** An engine.io middleware; an error passed to `next` answers the request with a 400 before engine.io reads it. */
export type SidGuard = (request: unknown, response: unknown, next: (error?: Error) => void) => void

/** The transports a policy leaves: polling, including its JSONP form, and `webtransport` are not among them. */
export const POLICY_TRANSPORTS: readonly string[] = Object.freeze(['websocket'])

/** Whether the options ask for the policy: a list of origins, or `websocketOnly`. A `false` is not asking. */
export function wantsPolicy(websocket: BymaxRealtimeModuleOptions['websocket']): boolean {
  return websocket?.allowedOrigins !== undefined || websocket?.websocketOnly === true
}

/**
 * Whether a `cors` block could answer an origin other than none: a function, `true`, or an object whose `origin` is
 * set to anything but `false`. A block with no `origin` key, or `origin: false`, which is what the gateway's own
 * decorator carries, answers none, so it does not conflict with a list of origins.
 */
export function corsAnswersOrigins(cors: unknown): boolean {
  if (typeof cors === 'function' || cors === true) return true
  if (typeof cors !== 'object' || cors === null) return false
  return 'origin' in cors && (cors as { origin: unknown }).origin !== false
}

/** Whether `origin` is one of the entries, compared exactly, with no case folding and no normalisation. */
function listed(entries: readonly string[], origin: string): boolean {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index] === origin) return true
  }
  return false
}

/** Whether the request is the HTTP upgrade of a WebSocket, the only handshake a policy admits. */
function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const upgrade = request.headers.upgrade
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket'
}

/**
 * Runs the host's own `allowRequest` after the policy has admitted a request. It can only refuse, answers at most once
 * (a second answer would start a second handshake in engine.io), and a throw before it answered is a refusal.
 */
function askHost(host: AllowRequest, request: IncomingMessage, answer: Answer): void {
  let answered = false
  const once: Answer = (message, success) => {
    if (answered) return
    answered = true
    answer(message, success)
  }
  try {
    host(request, once)
  } catch {
    once('forbidden', false)
  }
}

/**
 * The `allowRequest` the adapter installs when the policy is on. A request that is not a WebSocket upgrade is refused,
 * as a second line behind `transports`; a request that names an `Origin` is admitted only when `allowedOrigins` holds it
 * exactly; one that names none is admitted, because a browser always sends it, so only a client that is not a browser
 * leaves it out. The host's `allowRequest`, if it gave one, runs last.
 *
 * @param allowedOrigins - The list copied at boot, or `undefined` when only `websocketOnly` is set.
 * @param host - The `allowRequest` the host gave the gateway, if any.
 */
export function allowRequestFor(
  allowedOrigins: readonly string[] | undefined,
  host: AllowRequest | undefined,
): AllowRequest {
  return (request, answer) => {
    const origin = request.headers.origin
    const refused =
      !isWebSocketUpgrade(request) ||
      (allowedOrigins !== undefined && origin !== undefined && !listed(allowedOrigins, origin))
    if (refused) {
      answer('forbidden', false)
      return
    }
    if (host === undefined) answer(null, true)
    else askHost(host, request, answer)
  }
}

/**
 * Refuses a request that names a session. engine.io skips `allowRequest` for a request with a `sid`, and a second
 * WebSocket that names a live session upgrades it, takes it over and closes the first, whatever its origin. With
 * `transports` limited to `websocket` no client legitimately sends one. It reads the query the way engine.io does, from
 * `_query`, which engine.io has parsed before its middlewares run, so a repeated, encoded or empty `sid` is read here
 * as it is there; the key being present is the test, not its value. A request without a parsed query is refused.
 */
export const refuseSid: SidGuard = (request, _response, next) => {
  const query = (request as { _query?: unknown })._query
  if (typeof query !== 'object' || query === null || 'sid' in query) {
    next(new Error('a websocket-only server does not take a sid'))
    return
  }
  next()
}

/** The refusal when the host's `allowRequest` is set to something that cannot be called. */
export function refuseHostAllowRequest(value: unknown): void {
  if (value === undefined || typeof value === 'function') return
  throw realtimeError(
    REALTIME_ERROR_CODES.INVALID_OPTIONS,
    'the gateway option allowRequest must be a function when websocket.allowedOrigins or websocket.websocketOnly is set',
    { who: 'RealtimeIoAdapter' },
  )
}
