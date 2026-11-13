/**
 * @fileoverview Periodic re-authentication service with positive-result cache.
 * @layer application
 */
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { RESERVED_EVENT_NAMES } from '../../shared/constants/reserved-events.constants'
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
} from '../constants/injection-tokens.constants'
import type { IConnectionAuthenticator } from '../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../interfaces/connection-lifecycle-hooks.interface'
import type {
  BymaxRealtimeModuleOptions,
  ReauthenticationPolicy,
} from '../interfaces/realtime-module-options.interface'
import { describeError } from '../utils/describe-error'
import { Semaphore } from '../utils/semaphore'
import { runHook } from '../utils/run-hook'
import { ConnectionRegistry } from './connection-registry.service'
import type { ConnectionRecord } from './connection-registry.service'
import { RealtimeService } from './realtime.service'

/** Resolved re-auth policy with all fields required. */
interface RequiredPolicy {
  intervalSeconds: number
  onFailure: 'disconnect' | 'event'
  cacheTtlMs: number
  revalidateTimeoutMs: number
  concurrency: number
}

/**
 * Resolve the policy from options, applying defaults.
 *
 * Exported so the README's option-defaults table can be asserted against the real values.
 */
export function resolvePolicy(raw: ReauthenticationPolicy | undefined): RequiredPolicy {
  return {
    intervalSeconds: raw?.intervalSeconds ?? 300,
    onFailure: raw?.onFailure ?? 'disconnect',
    cacheTtlMs: raw?.cacheTtlMs ?? 60_000,
    revalidateTimeoutMs: raw?.revalidateTimeoutMs ?? 10_000,
    concurrency: raw?.concurrency ?? 8,
  }
}

/**
 * Periodically revalidates every active connection, on both transports, through the
 * consumer-provided `IConnectionAuthenticator.revalidate` contract.
 *
 * A short positive cache (default 60 s) avoids hammering the auth backend on every
 * interval tick. On failure the service either disconnects immediately or first emits
 * `connection:reauthentication-failed` then disconnects, depending on the configured
 * `reauthenticationPolicy.onFailure` value.
 *
 * The `revalidate` method is optional on the authenticator interface. When absent,
 * the service logs an informative message and stays idle.
 */
@Injectable()
export class ReauthenticationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReauthenticationService.name)
  private timer: NodeJS.Timeout | null = null
  private readonly policy: RequiredPolicy
  /** Connections with a revalidation queued or running: one call at a time for each. */
  private readonly inFlight = new Set<string>()
  /** The cap on revalidations in flight, shared by every cycle. */
  private readonly slots: Semaphore

  constructor(
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_OPTIONS_TOKEN) options: BymaxRealtimeModuleOptions,
    @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
  ) {
    this.policy = resolvePolicy(options.reauthenticationPolicy)
    this.slots = new Semaphore(this.policy.concurrency)
  }

  /**
   * Schedule the periodic revalidation cycle.
   *
   * The timer is unref'd so it never keeps the process alive on its own.
   * When the authenticator does not implement `revalidate`, the service stays
   * idle and emits an informative log.
   */
  onModuleInit(): void {
    if (!this.auth.revalidate) {
      this.logger.log('Authenticator does not implement revalidate() — reauthentication disabled')
      return
    }
    this.timer = setInterval(() => {
      this.runCycle().catch((err: unknown) => {
        this.logger.warn(`Reauthentication cycle failed: ${describeError(err)}`)
      })
    }, this.policy.intervalSeconds * 1000)
    this.timer.unref()
    this.logger.log(`Reauthentication scheduled every ${this.policy.intervalSeconds}s`)
  }

  /**
   * Clear the timer.
   *
   * Called by NestJS on graceful shutdown to prevent leaks.
   */
  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Run one revalidation cycle over every active connection, SSE and WebSocket alike.
   *
   * Connections are revalidated concurrently, up to `concurrency` at a time across every cycle that
   * overlaps, and each for at most `revalidateTimeoutMs`: a call that does not settle in time is
   * handled as one that threw, so one connection cannot hold up the revocation of another. A
   * connection with a call already in flight is left to it. A connection revalidated within
   * `cacheTtlMs` is skipped, and a positive result refreshes that. A negative result (or a thrown
   * error, or a timeout) invokes the configured `onFailure` policy and fires the
   * `onReauthenticationFailed` hook best-effort.
   *
   * Exposed as public for test access.
   */
  async runCycle(): Promise<void> {
    const now = Date.now()
    // Both transports, not SSE alone. A revocation policy that runs on one of them
    // is not a revocation policy: a WebSocket admitted under credentials that were
    // valid at handshake would keep delivering for the life of the socket, which is
    // the case the policy exists to prevent. The registry has no `all()`, so the two
    // indexes are read in turn rather than widening its surface for one caller.
    const connections = [
      ...this.connections.allByTransport('sse'),
      ...this.connections.allByTransport('websocket'),
    ]
    await Promise.all(connections.map((conn) => this.check(conn, now)))
  }

  /** Revalidate one connection unless it is cached or already being revalidated. */
  private async check(conn: ConnectionRecord, now: number): Promise<void> {
    if (this.inFlight.has(conn.connectionId)) return
    if (conn.revalidatedAt !== undefined && now - conn.revalidatedAt < this.policy.cacheTtlMs)
      return
    this.inFlight.add(conn.connectionId)
    try {
      await this.slots.run(() => this.revalidate(conn, now))
    } finally {
      this.inFlight.delete(conn.connectionId)
    }
  }

  private async revalidate(conn: ConnectionRecord, now: number): Promise<void> {
    try {
      // Build an AuthenticationResult from the stored snapshot (optional fields
      // must be absent, not undefined, under exactOptionalPropertyTypes).
      const originalAuth = {
        userId: conn.originalAuth.userId,
        ...(conn.originalAuth.tenantId !== undefined
          ? { tenantId: conn.originalAuth.tenantId }
          : {}),
        ...(conn.originalAuth.roles !== undefined ? { roles: conn.originalAuth.roles } : {}),
        ...(conn.originalAuth.rooms !== undefined ? { rooms: conn.originalAuth.rooms } : {}),
        ...(conn.originalAuth.metadata !== undefined
          ? { metadata: conn.originalAuth.metadata }
          : {}),
      }
      // Require strict true — a truthy non-boolean result (e.g. a user object) is not success.
      // When revalidate is absent, optional-chaining returns undefined; ?? true normalises it.
      const rawResult =
        (await this.bounded('revalidate', (signal) =>
          this.auth.revalidate?.(conn.connectionId, originalAuth, { signal }),
        )) ?? true
      if (rawResult === true) {
        conn.revalidatedAt = now
        return
      }
      await this.revoke(conn)
    } catch (err) {
      this.logger.warn(`Reauthentication errored for ${conn.connectionId}: ${describeError(err)}`)
      await this.revoke(conn)
    }
  }

  /**
   * Run `work`, giving up when it has not settled in `revalidateTimeoutMs`: the signal it was handed
   * is aborted and the call rejects. Whatever the abandoned work returns or throws later is ignored.
   * The same bound holds for the call to `revalidate` and for the revocation after it, because both
   * run in a slot that every connection shares.
   */
  private async bounded<T>(
    what: string,
    work: (signal: AbortSignal) => Promise<T> | undefined,
  ): Promise<T | undefined> {
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`${what} did not settle within ${this.policy.revalidateTimeoutMs} ms`))
      }, this.policy.revalidateTimeoutMs)
      timer.unref()
    })
    try {
      return await Promise.race([work(controller.signal), timedOut])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Revoke a connection whose revalidation failed, and keep the cycle going when the
   * revocation itself is rejected or does not settle in time. The last confirmation is already
   * forgotten, so the next cycle revalidates the connection and tries again.
   */
  private async revoke(conn: ConnectionRecord): Promise<void> {
    try {
      await this.bounded('revocation', () => this.handleFailure(conn))
    } catch (err) {
      this.logger.warn(
        `Revocation of ${conn.connectionId} failed, retrying next cycle: ${describeError(err)}`,
      )
    }
  }

  /**
   * Forget the last confirmation, optionally start the failure event, then disconnect. The
   * event is a notification: it is started first, so its local delivery precedes the disconnect,
   * but the revocation never waits for it. A failure to send it is logged.
   */
  private async handleFailure(conn: ConnectionRecord): Promise<void> {
    conn.revalidatedAt = undefined

    if (this.policy.onFailure === 'event') this.notify(conn)

    // Fire the hook best-effort — a hook that throws, before it returns or after, must not block
    // the disconnect.
    void runHook(() =>
      this.hooks?.onReauthenticationFailed?.({
        connectionId: conn.connectionId,
        userId: conn.userId,
        tenantId: conn.tenantId,
        roles: conn.originalAuth.roles,
        metadata: conn.originalAuth.metadata,
        transport: conn.transport,
        ip: conn.ip,
        userAgent: conn.userAgent,
        connectedAt: conn.connectedAt,
      }),
    ).then((failed) => {
      if (failed) {
        this.logger.warn(`onReauthenticationFailed hook failed: ${describeError(failed.error)}`)
      }
    })

    await this.realtime.disconnect(conn.connectionId, REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED)
  }

  /** Send the failure event without waiting for it; a rejection, or a throw, is only logged. */
  private notify(conn: ConnectionRecord): void {
    const failed = (err: unknown): void => {
      this.logger.warn(
        `Reauthentication notification for ${conn.connectionId} failed, disconnecting anyway: ${describeError(err)}`,
      )
    }
    try {
      this.realtime
        .emitToUser(conn.userId, RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED, {
          reason: REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED,
        })
        .catch(failed)
    } catch (err) {
      failed(err)
    }
  }
}
