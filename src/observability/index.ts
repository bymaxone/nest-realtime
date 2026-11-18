/**
 * @fileoverview Public surface of the observability entry point.
 * @layer observability
 *
 * Everything that depends on `@bymax-one/nest-core`, `prom-client` or `@opentelemetry/api` is reachable only
 * from here. The package root stays free of them, so an application that publishes no metrics installs none.
 */
export { RealtimeMetrics } from './realtime-metrics'
export { RealtimePubSubHealthIndicator } from './realtime-health'
