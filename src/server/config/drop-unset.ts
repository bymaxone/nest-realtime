/**
 * @fileoverview Option objects without the keys that hold nothing.
 * @layer composition
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type {
  BymaxRealtimeModuleOptions,
  CorsConfig,
  ReauthenticationPolicy,
  SseOptions,
  WebSocketOptions,
} from '../interfaces/realtime-module-options.interface'
import { copyRegExp } from '../utils/copy-regexp'
import { isPlainObject } from '../utils/is-plain-object'
import { realtimeError } from '../utils/realtime-error'

/**
 * The keys each object is read for. Each table is typed against its interface, so a key added to an
 * interface and missing here fails to compile.
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

const CORS_KEYS = {
  origin: true,
  credentials: true,
  methods: true,
  allowedHeaders: true,
  exposedHeaders: true,
  maxAge: true,
} satisfies Record<keyof CorsConfig, true>

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

/** The most entries an origin or a methods list may hold: a bound on the copy, not on how many a host may name. */
const MAX_LIST_ENTRIES = 1000

/**
 * The built-ins the copy of a list relies on, taken when the module loads, so that one a host replaces afterwards can
 * neither change what is copied nor watch it. A host that changes them has to do it before the library is imported.
 */
const isArray = Array.isArray
const isInteger = Number.isInteger
const freeze = Object.freeze
const push = Array.prototype.push
const apply = Reflect.apply

/**
 * A copy of a list, with its length and each of its entries read once, and each RegExp replaced by a pristine copy
 * without `g` and `y`. Socket.IO matches the list it is given by index and length on every request, and an entry by
 * its prototype, so the list that was validated has to be the list it holds: a subclass whose iterator and indexes
 * differ, a proxy that answers differently the second time, an array the host changes after boot and an entry whose
 * prototype is changed afterwards are all read here, once, and never again.
 *
 * @param list - The list the host wrote.
 * @param path - The option, for the refusal.
 * @param kinds - What the option may be, for the refusal.
 * @returns A frozen array of the entries, which are validated by the caller.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS` when the length is not an integer from 0 to 1,000.
 */
function snapshotList(list: readonly unknown[], path: string, kinds: string): readonly unknown[] {
  const length: unknown = list.length
  if (typeof length !== 'number' || !isInteger(length) || length < 0 || length > MAX_LIST_ENTRIES) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `options.${path} must be ${kinds}, received a list whose length is not an integer from 0 to ${MAX_LIST_ENTRIES}`,
      { who: 'BymaxRealtimeModule' },
    )
  }
  const entries: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const entry = list[index]
    apply(push, entries, [copyRegExp(entry) ?? entry])
  }
  return freeze(entries)
}

/** The kinds an origin may be, for the refusal of a list that cannot be copied. */
export const ORIGIN_KINDS =
  'a string, a RegExp, a function, an array of strings and RegExps, or a boolean'

/** The kinds `methods` may be. */
export const METHODS_KINDS = 'a string or a list of at most 1000 strings'

/** The keys of the cors block whose lists are copied once, with what each may be, for the refusal of one that cannot be. */
const COPIED_LISTS: ReadonlyArray<readonly [string, string]> = [
  ['origin', ORIGIN_KINDS],
  ['methods', METHODS_KINDS],
  ['allowedHeaders', METHODS_KINDS],
  ['exposedHeaders', METHODS_KINDS],
]

/** A list as a copy, a RegExp as a pristine one, and anything else, `undefined` included, as it is. */
function copied(value: unknown, path: string, kinds: string): unknown {
  if (isArray(value)) return snapshotList(value as unknown[], path, kinds)
  return copyRegExp(value) ?? value
}

/**
 * Read the own keys of `source` and the `known` ones by property access, keeping what holds a value. A key in
 * `keepWhenSet` is also kept when it holds `null`, or `undefined` while the object has the property, however it
 * has it: that is a value the host set to nothing, which validation refuses, not an option left unset.
 */
function readSet(
  source: object,
  known: Readonly<Record<string, true>>,
  keepWhenSet?: string,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(source), ...Object.keys(known)])) {
    const value = (source as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) kept[key] = value
    else if (key === keepWhenSet && (value === null || key in source)) kept[key] = value
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
 * that is not an object, or is an array or a built-in such as a `Date`, is left as it is. The CORS block
 * of `websocket` is read by the same names when it is a plain object or holds one of them, however it reports
 * its type; any other object is left as it is, so validation refuses it instead of reading it as an empty block. It is read because
 * the origin allowlist it carries reaches Socket.IO, which copies what it is given: an `origin` held as a getter or on a prototype would be lost in that copy and
 * the server would answer every origin.
 *
 * @param options - The options as the host wrote them.
 * @returns A plain copy in which every unset key is absent.
 */
export function dropUnset<T extends object>(options: T): T {
  const kept = readSet(options, TOP_LEVEL_KEYS)
  for (const [group, keys] of Object.entries(GROUPS)) {
    const value = kept[group]
    if (isPlainObject(value)) kept[group] = readSet(value, keys)
  }
  const websocket = kept.websocket
  if (isPlainObject(websocket)) {
    const cors = (websocket as Record<string, unknown>).cors
    if (typeof cors === 'object' && cors !== null) {
      const read = readSet(cors, CORS_KEYS, 'origin')
      if (isPlainObject(cors) || Object.keys(CORS_KEYS).some((key) => key in read)) {
        for (const [key, kinds] of COPIED_LISTS) {
          if (key in read) read[key] = copied(read[key], `websocket.cors.${key}`, kinds)
        }
        ;(websocket as Record<string, unknown>).cors = read
      }
    }
  }
  return kept as T
}
