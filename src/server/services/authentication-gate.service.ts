/**
 * @fileoverview The only way the library calls the consumer's `authenticate`: bounded in time, and in
 * how many calls can be waiting at once.
 * @layer application
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
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
import { logEvent } from '../utils/log-event'
import { assertBuiltinsIntact } from '../utils/builtin-baseline'
import { shielded, unboxed, withinDeadline } from '../utils/within-deadline'
import { windowedReport } from '../utils/windowed-report'

/** How long a window of refusals is summarised in one log line. */

/**
 * A handshake was refused because the authenticator could not be asked or did not answer in time:
 * a fault of the system, not of the credentials, and carrying nothing about either.
 */
export class AuthenticationUnavailableError extends Error {
  /** The code the refusal travels under, so a span or a log names it without reading the message. */
  readonly code = REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE

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
  private readonly refusals = windowedReport(
    () => ({ saturated: 0, timeout: 0 }),
    ({ saturated, timeout }) => {
      logEvent(
        this.logger,
        'warn',
        'REALTIME_HANDSHAKES_REFUSED',
        `handshakes refused since the last report: ${saturated} because ${this.maxPending} were already ` +
          `waiting for the authenticator, ${timeout} because it did not answer in ${this.timeoutMs} ms`,
        {
          saturated,
          timedOut: timeout,
          maxPendingHandshakes: this.maxPending,
          authenticateTimeoutMs: this.timeoutMs,
        },
      )
    },
  )

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
  authenticate(context: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    // Every caller awaits this promise, and an await of a promise that has no constructor of its own reads the shared
    // slot, which a host call that ran inside the wait can have replaced and put back.
    return shielded(this.decide(context))
  }

  private async decide(context: ConnectionAuthContext): Promise<AuthenticationResult | null> {
    if (this.pending >= this.maxPending) {
      assertBuiltinsIntact()
      this.refuse('saturated')
      throw new AuthenticationUnavailableError('saturated')
    }
    // Made, and its signal read, before the check and not after it: a replaceable constructor or getter that runs between
    // the check and the await below could swap `Promise.prototype.constructor`, plant a `then`, and put both back before
    // the check that follows the wait.
    const controller = new AbortController()
    const { signal } = controller
    // Before the authenticator is called: its own promise resolves with the identity it answers, and a `then` planted
    // on the root prototypes would answer for it. Nothing a host can replace runs between this and that promise's await.
    assertBuiltinsIntact()
    this.pending += 1
    // `await`, not a returned promise: returning one makes the engine call its `then`, which a host can replace. The
    // promise carries its own `constructor`, so that the wait that absorbs its rejection never reads the shared slot.
    const call = shielded(
      (async () => {
        const answer = await this.authenticator.authenticate(context, { signal })
        // The last statement before the return: resolving this promise with an object asks it for a `then`.
        assertBuiltinsIntact()
        return answer
      })(),
    )
    const decided = await withinDeadline(call, this.timeoutMs, {
      // Counted before the wait is rejected, and the abort is dispatched after it, so an answer given from an abort
      // listener cannot win.
      timeoutError: () => {
        this.refuse('timeout')
        return new AuthenticationUnavailableError('timeout')
      },
      onExpire: () => controller.abort(),
      onSettled: () => {
        this.pending -= 1
      },
    })
    return unboxed(decided)
  }

  /** Count a refusal, and log at most one line for each window, so an attack cannot flood the log. */
  private refuse(reason: 'saturated' | 'timeout'): void {
    this.refusals((refused) => ({ ...refused, [reason]: refused[reason] + 1 }))
  }
}
