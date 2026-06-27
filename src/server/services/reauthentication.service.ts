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
import { ConnectionRegistry } from './connection-registry.service'
import type { ConnectionRecord } from './connection-registry.service'
import { RealtimeService } from './realtime.service'

/** Resolved re-auth policy with all fields required. */
interface RequiredPolicy {
  intervalSeconds: number
  onFailure: 'disconnect' | 'event'
  cacheTtlMs: number
}

/** Resolve the policy from options, applying defaults. */
function resolvePolicy(raw: ReauthenticationPolicy | undefined): RequiredPolicy {
  return {
    intervalSeconds: raw?.intervalSeconds ?? 300,
    onFailure: raw?.onFailure ?? 'disconnect',
    cacheTtlMs: raw?.cacheTtlMs ?? 60_000,
  }
}

/**
 * Periodically revalidates active SSE connections through the consumer-provided
 * `IConnectionAuthenticator.revalidate` contract.
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
  /** connectionId → epoch-ms timestamp of last successful revalidation. */
  private readonly positiveCache = new Map<string, number>()
  private readonly policy: RequiredPolicy

  constructor(
    @Inject(ConnectionRegistry) private readonly connections: ConnectionRegistry,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(REALTIME_AUTHENTICATOR_TOKEN) private readonly auth: IConnectionAuthenticator,
    @Inject(REALTIME_OPTIONS_TOKEN) options: BymaxRealtimeModuleOptions,
    @Optional() @Inject(REALTIME_HOOKS_TOKEN) private readonly hooks?: IConnectionLifecycleHooks,
  ) {
    this.policy = resolvePolicy(options.reauthenticationPolicy)
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
    this.timer = setInterval(() => void this.runCycle(), this.policy.intervalSeconds * 1000)
    this.timer.unref()
    this.logger.log(`Reauthentication scheduled every ${this.policy.intervalSeconds}s`)
  }

  /**
   * Clear the timer and the positive cache.
   *
   * Called by NestJS on graceful shutdown to prevent leaks.
   */
  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.positiveCache.clear()
  }

  /**
   * Run one revalidation cycle over all active SSE connections.
   *
   * A cache hit within `cacheTtlMs` skips the `revalidate` call. A positive result
   * refreshes the cache. A negative result (or a thrown error) invokes the configured
   * `onFailure` policy and fires the `onReauthenticationFailed` hook best-effort.
   *
   * Exposed as public for test access.
   */
  async runCycle(): Promise<void> {
    const now = Date.now()
    for (const conn of this.connections.allByTransport('sse')) {
      try {
        const lastValid = this.positiveCache.get(conn.connectionId)
        if (lastValid !== undefined && now - lastValid < this.policy.cacheTtlMs) continue

        // Build an AuthenticationResult from the stored snapshot (optional fields
        // must be absent, not undefined, under exactOptionalPropertyTypes).
        const originalAuth = {
          userId: conn.originalAuth.userId,
          ...(conn.originalAuth.tenantId !== undefined
            ? { tenantId: conn.originalAuth.tenantId }
            : {}),
          ...(conn.originalAuth.roles !== undefined ? { roles: conn.originalAuth.roles } : {}),
        }
        const ok = (await this.auth.revalidate?.(conn.connectionId, originalAuth)) ?? true
        if (ok) {
          this.positiveCache.set(conn.connectionId, now)
          continue
        }
        await this.handleFailure(conn)
      } catch (err) {
        this.logger.warn(
          `Reauthentication errored for ${conn.connectionId}: ${(err as Error).message}`,
        )
        await this.handleFailure(conn)
      }
    }
  }

  /** Evict the positive-cache entry, optionally emit the failure event, then disconnect. */
  private async handleFailure(conn: ConnectionRecord): Promise<void> {
    this.positiveCache.delete(conn.connectionId)

    if (this.policy.onFailure === 'event') {
      await this.realtime.emitToUser(conn.userId, RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED, {
        reason: REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED,
      })
    }

    // Fire the hook best-effort — a throwing hook must not block the disconnect.
    void Promise.resolve(
      this.hooks?.onReauthenticationFailed?.({
        connectionId: conn.connectionId,
        userId: conn.userId,
        tenantId: conn.tenantId,
        transport: 'sse',
        ip: conn.ip,
        userAgent: conn.userAgent,
        connectedAt: conn.connectedAt,
      }),
    ).catch((err: unknown) => {
      this.logger.warn(`onReauthenticationFailed hook failed: ${(err as Error).message}`)
    })

    await this.realtime.disconnect(conn.connectionId, REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED)
  }
}
