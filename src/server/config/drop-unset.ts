/**
 * @fileoverview Option objects without the keys that hold nothing.
 * @layer composition
 */
import type {
  BymaxRealtimeModuleOptions,
  ReauthenticationPolicy,
  SseOptions,
  WebSocketOptions,
} from '../interfaces/realtime-module-options.interface'

/**
 * The keys each object is read for. Each table is typed against its interface, so a key added to an
 * interface and missing here fails to compile, and an object handed over as a class instance is read
 * through the same property access the services use, getters included.
 */
const SSE_KEYS = {
  endpoint: true,
  heartbeatMs: true,
  replayBufferSize: true,
  replayTtlMs: true,
  replayMaxIdleUsers: true,
  maxConnectionsPerUser: true,
  emitConnectionEvent: true,
  maxQueuedBytes: true,
  maxQueuedEvents: true,
  stallHeartbeats: true,
} satisfies Record<keyof SseOptions, true>

const WEBSOCKET_KEYS = {
  namespace: true,
  cors: true,
  maxHttpBufferSize: true,
  pingIntervalMs: true,
  pingTimeoutMs: true,
  maxConnectionsPerUser: true,
  emitConnectionEvent: true,
  redisAdapter: true,
} satisfies Record<keyof WebSocketOptions, true>

const REAUTHENTICATION_KEYS = {
  intervalSeconds: true,
  onFailure: true,
  cacheTtlMs: true,
  revalidateTimeoutMs: true,
  concurrency: true,
} satisfies Record<keyof ReauthenticationPolicy, true>

const TOP_LEVEL_KEYS = {
  transport: true,
  authenticator: true,
  tenantResolver: true,
  hooks: true,
  hookTimeoutMs: true,
  onConnectFailure: true,
  authenticateTimeoutMs: true,
  maxPendingHandshakes: true,
  maxConnections: true,
  pubsub: true,
  offlineQueue: true,
  presence: true,
  sse: true,
  websocket: true,
  reauthenticationPolicy: true,
} satisfies Record<keyof BymaxRealtimeModuleOptions, true>

/** The option groups whose keys are merged with defaults or read as bounds. */
const GROUPS = {
  sse: SSE_KEYS,
  websocket: WEBSOCKET_KEYS,
  reauthenticationPolicy: REAUTHENTICATION_KEYS,
} as const

/** Read the own keys of `source` and the `known` ones by property access, keeping what holds a value. */
function readSet(source: object, known: Readonly<Record<string, true>>): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(source), ...Object.keys(known)])) {
    const value = (source as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) kept[key] = value
  }
  return kept
}

/**
 * Copy module options without the keys that hold `undefined` or `null`, at the top level and in every
 * group, into plain objects.
 *
 * `{ ...defaults, ...options }` lets a key holding `undefined` overwrite the default, and a bound that
 * is then missing reads as "switched off". Dropping the key first means an unset option, however it was
 * spelled, resolves to its default and is validated as absent. A group may be a class instance with
 * fields or getters, so each known key is read by property access rather than from the own keys alone.
 * Values that carry behaviour (the authenticator, a queue, a hook table) are kept by reference. A group
 * that is not an object, or is an array, is left as it is.
 *
 * @param options - The options as the host wrote them.
 * @returns A plain copy in which every unset key is absent.
 */
export function dropUnset<T extends object>(options: T): T {
  const kept = readSet(options, TOP_LEVEL_KEYS)
  for (const [group, keys] of Object.entries(GROUPS)) {
    const value = kept[group]
    if (typeof value === 'object' && !Array.isArray(value))
      kept[group] = readSet(value as object, keys)
  }
  return kept as T
}
