/**
 * @fileoverview A readiness indicator for the bus that carries events between instances.
 * @layer observability
 *
 * An optional subpath, like `RealtimeMetrics`: it names `@bymax-one/nest-core`, so nothing outside
 * `src/observability` may import it.
 */
import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'
import { Inject, Injectable } from '@nestjs/common'
import { callHostMethod, REALTIME_PUBSUB_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { IRealtimePubSub } from '@bymax-one/nest-realtime/internal'

/**
 * Reports whether this instance still receives what the other instances publish.
 *
 * It asks the bus for its own state and sends nothing, so it is as cheap as a property read and needs no
 * timeout of its own. A bus that does not report its state, such as the in-memory one, counts as up: there
 * is no signal to be alarmed by, and a probe that failed for want of one would take the instance out of
 * rotation for nothing. The result carries no detail, because a host name or a credential must not reach a
 * readiness response.
 *
 * @example
 * // providers: [RealtimePubSubHealthIndicator]  (BymaxCoreModule discovers it with `health.autoDiscover`)
 */
@BymaxHealthIndicator()
@Injectable()
export class RealtimePubSubHealthIndicator implements IHealthIndicator {
  readonly name = 'realtime-pubsub'

  constructor(@Inject(REALTIME_PUBSUB_TOKEN) private readonly pubsub: IRealtimePubSub) {}

  /** The indicator's outcome: `down` only when the bus says it is not subscribed. */
  async check(): Promise<HealthIndicatorResult> {
    return {
      status: callHostMethod<boolean>(this.pubsub, 'isSubscribed', []) === false ? 'down' : 'up',
    }
  }
}
