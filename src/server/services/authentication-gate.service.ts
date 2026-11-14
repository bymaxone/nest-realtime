/**
 * @fileoverview The only way the library calls the consumer's `authenticate`: bounded in time, and in
 * how many calls can be waiting at once.
 * @layer application
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../constants/injection-tokens.constants'
import type {
  AuthenticationResult,
  ConnectionAuthContext,
  IConnectionAuthenticator,
} from '../interfaces/connection-authenticator.interface'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'

/** How long a window of refusals is summarised in one log line. */
const REPORT_WINDOW_MS = 10_000

/**
 * A handshake was refused because the authenticator could not be asked or did not answer in time:
 * a fault of the system, not of the credentials, and carrying nothing about either.
 */
export class AuthenticationUnavailableError extends Error {
  constructor(readonly reason: 'saturated' | 'timeout') {
    super(
      reason === 'saturated'
        ? 'too many handshakes are waiting for the authenticator'
        : 'the authenticator did not answer in time',
    )
  }
}

/**
 * Calls the consumer's `authenticate` for every handshake, on both transports.
 *
 * A call that has not settled in `authenticateTimeoutMs` is given up on for the client: the
 * handshake is refused and the call's signal is aborted. The call keeps its place among the
 * `maxPendingHandshakes` until it actually settles, so an authenticator that never answers fills the
 * limit and further handshakes are refused at once, without being asked: a dependency that is down is
 * not given a new call for every handshake while the abandoned ones stay open against it.
 */
@Injectable()
export class AuthenticationGate {
  private readonly logger = new Logger(AuthenticationGate.name)
  private readonly maxPending: number
  private readonly timeoutMs: number
  private pending = 0
  private windowStartedAt = Number.NEGATIVE_INFINITY
  private refused = { saturated: 0, timeout: 0 }

  constructor(
    @Inject(REALTIME_OPTIONS_TOKEN) options: BymaxRealtimeModuleOptions,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly authenticator: IConnectionAuthenticator,
  ) {
    this.maxPending = options.maxPendingHandshakes ?? 1_000
    this.timeoutMs = options.authenticateTimeoutMs ?? 10_000
  }

  /**
   * Ask the authenticator about one handshake.
   *
   * @throws AuthenticationUnavailableError when too many are waiting, or this one did not settle in
   *   time. Whatever the authenticator itself throws is thrown as it is.
   */
  async authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    if (this.pending >= this.maxPending) {
      this.refuse('saturated')
      throw new AuthenticationUnavailableError('saturated')
    }
    this.pending += 1
    const controller = new AbortController()
    const call = (async () =>
      this.authenticator.authenticate(context, { signal: controller.signal }))()
    const release = (): void => {
      this.pending -= 1
    }
    call.then(release, release)
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Rejected before the abort is dispatched, so an answer given from an abort listener cannot win.
        this.refuse('timeout')
        reject(new AuthenticationUnavailableError('timeout'))
        controller.abort()
      }, this.timeoutMs)
      timer.unref()
    })
    try {
      return await Promise.race([call, timedOut])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Count a refusal, and log at most one line for each window, so an attack cannot flood the log. */
  private refuse(reason: 'saturated' | 'timeout'): void {
    this.refused[reason] += 1
    const now = performance.now()
    if (now - this.windowStartedAt < REPORT_WINDOW_MS) return
    this.windowStartedAt = now
    const { saturated, timeout } = this.refused
    this.refused = { saturated: 0, timeout: 0 }
    this.logger.warn(
      `handshakes refused since the last report: ${saturated} because ${this.maxPending} were already ` +
        `waiting for the authenticator, ${timeout} because it did not answer in ${this.timeoutMs} ms`,
    )
  }
}
