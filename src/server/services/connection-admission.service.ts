/**
 * @fileoverview The bound on how many connections one instance holds, on both transports together.
 * @layer application
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { REALTIME_OPTIONS_TOKEN } from '../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import { ConnectionRegistry } from './connection-registry.service'

/** `authenticateTimeoutMs` when it is not set. */
const DEFAULT_AUTHENTICATE_TIMEOUT_MS = 10_000

/** Connections one instance holds when `maxConnections` is not set. */
export const DEFAULT_MAX_CONNECTIONS = 10_000

/** What a place is held for beyond `authenticateTimeoutMs`: the work after authentication, until registration. */
const HOLD_MARGIN_MS = 5_000

/** How long a window of refusals is summarised in one log line. */
const REPORT_WINDOW_MS = 10_000

/** A handshake was refused because the instance already holds `maxConnections` connections. */
export class ConnectionLimitError extends Error {
  constructor(readonly limit: number) {
    super(`the instance already holds ${limit} connections`)
  }
}

/** A place held for a connection that has been admitted and is not registered yet. */
export interface AdmissionTicket {
  /** Give the place back. Safe to call more than once: only the first call counts. */
  release(): void
  /**
   * Take the place again if the time bound gave it back while the handshake was still alive, as a
   * connection that is about to be registered must hold one. Does nothing for a place that is still
   * held or was released.
   *
   * @throws ConnectionLimitError when the place was given back and the instance has since filled.
   */
  renew(): void
}

/** The ticket of a transport with no admission, which holds nothing. */
export const UNBOUNDED_TICKET: AdmissionTicket = {
  release: () => undefined,
  renew: () => undefined,
}

/**
 * Decides, before a handshake is authenticated, whether the instance has room for one more
 * connection.
 *
 * The room is `maxConnections` less the connections registered, on either transport, and the
 * places held for connections admitted and not yet registered. A place is given back when the
 * connection is registered or when its request or socket closes, whichever comes first, and a place
 * that has been given back by neither within `authenticateTimeoutMs` and a margin is given back at
 * the next admission, so a handshake that dies half way, on a framework that reports no close, never
 * leaves the count above what is really held. There is no timer: a place is reclaimed only when
 * someone asks for room, which is when it matters.
 */
@Injectable()
export class ConnectionAdmission {
  private readonly logger = new Logger(ConnectionAdmission.name)
  private readonly max: number
  private readonly holdMs: number
  /** The places held, oldest first, each with the time it is given back at whatever happens. */
  private readonly held = new Map<symbol, number>()
  private windowStartedAt = Number.NEGATIVE_INFINITY
  private refused = 0

  constructor(
    @Inject(REALTIME_OPTIONS_TOKEN) options: BymaxRealtimeModuleOptions,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
  ) {
    this.max = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
    this.holdMs =
      (options.authenticateTimeoutMs ?? DEFAULT_AUTHENTICATE_TIMEOUT_MS) + HOLD_MARGIN_MS
  }

  /**
   * Take a place for one connection.
   *
   * @throws ConnectionLimitError when the instance already holds `maxConnections`.
   */
  admit(): AdmissionTicket {
    const place = Symbol('place')
    this.take(place)
    let released = false
    return {
      release: () => {
        released = true
        this.held.delete(place)
      },
      renew: () => {
        this.reclaim()
        if (!released && !this.held.has(place)) this.take(place)
      },
    }
  }

  /** Hold `place` if the instance has room, after giving back the places whose time has passed. */
  private take(place: symbol): void {
    this.reclaim()
    if (this.registry.count() + this.held.size >= this.max) {
      this.refuse()
      throw new ConnectionLimitError(this.max)
    }
    this.held.set(place, performance.now() + this.holdMs)
  }

  /** Give back the places whose time has passed; they were taken in order, so the oldest come first. */
  private reclaim(): void {
    const now = performance.now()
    for (const [place, until] of this.held) {
      if (until > now) break
      this.held.delete(place)
    }
  }

  /** Count a refusal, and log at most one line for each window, so an attack cannot flood the log. */
  private refuse(): void {
    this.refused += 1
    const now = performance.now()
    if (now - this.windowStartedAt < REPORT_WINDOW_MS) return
    this.windowStartedAt = now
    const count = this.refused
    this.refused = 0
    this.logger.warn(
      `connections refused since the last report: ${count}, because the instance already holds ` +
        `${this.max} (maxConnections)`,
    )
  }
}
