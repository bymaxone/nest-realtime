/**
 * @fileoverview SSE branch of the universal realtime hook.
 * @layer react/internal
 *
 * Opens a browser-native `EventSource`, tracks connection state, and accumulates
 * received events. Implements exponential backoff on error to avoid thundering-herd
 * reconnect storms. The browser restarts a dropped stream by itself and sends `Last-Event-ID`
 * from its internal state. An `EventSource` this hook opens afresh (after a refusal, after its
 * backoff, on a manual reconnect) has no such state and cannot send the header, so the hook keeps
 * the last event id it saw and sends it as the `lastEventId` query parameter.
 *
 * Named server events (the reserved catalog plus presence) are delivered by the
 * browser ONLY to listeners registered with `addEventListener(name, …)`, never to
 * `onmessage`. This hook subscribes to those names so each event's `type` is
 * preserved end-to-end (e.g. `presence:online`), matching the WebSocket branch.
 * Application-level names are opt-in through `eventNames`, since the library cannot
 * know them.
 *
 * Note: `'use client'` at the top is required for React Server Components
 * compatibility — this module accesses `EventSource` and React state.
 */
'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { PRESENCE_EVENT_NAMES, RESERVED_EVENT_NAMES } from '../../shared'
import { nextBackoff, validDelay } from './backoff'
/** Options for the SSE internal hook. */
export interface UseRealtimeSseOptions {
  /** SSE endpoint URL, e.g. `'/realtime/sse'`. */
  url: string
  /** Forward cookies when the endpoint is on a different origin. Default false. */
  withCredentials?: boolean
  /**
   * Additional named SSE events to subscribe to, beyond the reserved catalog.
   *
   * `EventSource` delivers a named event only to a listener registered for that
   * exact name, so an application-level event such as `order.created` never
   * reaches the hook unless it is listed here. Names are matched literally.
   *
   * The browser's own `message`, `open`, and `error` names are ignored rather than
   * bound to the data handler — see {@link BROWSER_SSE_EVENT_NAMES} for why.
   */
  eventNames?: readonly string[]
  /** Initial backoff delay in ms. Default 1000. */
  reconnectInitialMs?: number
  /** Maximum backoff delay in ms. Default 30000. */
  reconnectMaxMs?: number
  /**
   * Give up once this many consecutive connection attempts have failed, closing the
   * stream for good. Unset (the default) retries indefinitely.
   *
   * The count includes the initial connection, so `maxAttempts: 1` means "try once,
   * never retry". A manual `reconnect` resets the counter and resumes retrying.
   */
  maxAttempts?: number
  /**
   * When false the hook does nothing — useful for conditional transport selection
   * without violating Rules of Hooks. Default true.
   */
  enabled?: boolean
}

/** Maximum number of events kept in memory per hook instance. */
const MAX_EVENTS = 100

/**
 * The url a new stream is opened with: `url` as given until an event has been seen, then with the
 * id of the last one as the `lastEventId` query parameter, before any fragment. A `lastEventId` the
 * url already carries (a cursor the application started from) is replaced, since two of them
 * reach the server as an array, which it reads as no id.
 */
function withLastEventId(url: string, id: string | undefined): string {
  if (id === undefined) return url
  const hash = url.indexOf('#')
  const head = hash < 0 ? url : url.slice(0, hash)
  const mark = head.indexOf('?')
  const query = new URLSearchParams(mark < 0 ? '' : head.slice(mark + 1))
  query.set('lastEventId', id)
  return `${mark < 0 ? head : head.slice(0, mark)}?${query}${hash < 0 ? '' : url.slice(hash)}`
}

/**
 * Named SSE events this hook subscribes to so their `type` survives transport.
 *
 * `RESERVED_EVENT_NAMES.ERROR` is intentionally excluded: the browser dispatches
 * the EventSource connection-failure signal under the same `'error'` name, so a
 * data listener there would collide with `onerror` and parse an empty payload.
 */
const NAMED_SSE_EVENTS: readonly string[] = [
  RESERVED_EVENT_NAMES.CONNECTION_ESTABLISHED,
  RESERVED_EVENT_NAMES.CONNECTION_REAUTH_FAILED,
  RESERVED_EVENT_NAMES.CONNECTION_CREDENTIAL_EXPIRING,
  RESERVED_EVENT_NAMES.ROOM_JOINED,
  RESERVED_EVENT_NAMES.ROOM_LEFT,
  PRESENCE_EVENT_NAMES.ONLINE,
  PRESENCE_EVENT_NAMES.OFFLINE,
]

/**
 * Names a caller may not add through `eventNames`, because the browser already uses
 * them for something other than a data frame:
 *
 * - `'message'` is bound as `onmessage`, so re-registering it would record every
 *   default event twice.
 * - `'open'` and `'error'` are the connection signals. They carry no `data`, so the
 *   shared data handler would have nothing to parse — the same collision that keeps
 *   `RESERVED_EVENT_NAMES.ERROR` out of `NAMED_SSE_EVENTS`.
 *
 * A caller repeating a name from `NAMED_SSE_EVENTS` needs no filtering: DOM
 * `addEventListener` ignores an identical (type, callback, capture) triple, and the
 * handler is one shared reference per connection.
 */
const BROWSER_SSE_EVENT_NAMES: readonly string[] = ['message', 'open', RESERVED_EVENT_NAMES.ERROR]

/** Accumulated event shape returned by the hook. */
export type SseEventEntry<TEvents extends Record<string, unknown>> = {
  type: keyof TEvents
  data: TEvents[keyof TEvents]
  id: string
}

/** Return value of {@link useRealtimeSse}. */
export interface UseRealtimeSseReturn<TEvents extends Record<string, unknown>> {
  /** Whether the connection is open. */
  connected: boolean
  /** Accumulated events, capped at the last 100 entries. */
  events: Array<SseEventEntry<TEvents>>
  /** The most recent event, or `undefined` if none has arrived yet. */
  lastEvent: SseEventEntry<TEvents> | undefined
  /** Last connection error, or `undefined` when the connection is healthy. */
  error: Error | undefined
  /**
   * Consecutive failed connection attempts since the last successful open.
   *
   * Counts the initial connection as well as later retries, and resets to zero on a
   * successful open or a manual `reconnect`.
   */
  reconnectAttempts: number
  /**
   * Force a new `EventSource` immediately, resetting the backoff counter.
   *
   * @example
   * const { reconnect } = useRealtimeSse({ url: '/realtime/sse' })
   * // call on a user "reconnect" button
   * <button onClick={reconnect}>Reconnect</button>
   */
  reconnect: () => void
}

/**
 * The state setters and the refs of one hook instance, bundled so that the handlers of a stream are
 * built outside the hook. Every member keeps one identity for the life of the component.
 */
interface SseStreamContext<TEvents extends Record<string, unknown>> {
  readonly setConnected: (connected: boolean) => void
  readonly setError: (error: Error | undefined) => void
  readonly setReconnectAttempts: (attempts: number) => void
  readonly setEvents: Dispatch<SetStateAction<Array<SseEventEntry<TEvents>>>>
  readonly setLastEvent: (entry: SseEventEntry<TEvents>) => void
  readonly sourceRef: MutableRefObject<EventSource | null>
  readonly reconnectMsRef: MutableRefObject<number>
  readonly attemptsRef: MutableRefObject<number>
  readonly timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  /** The id of the last event seen, and the url it belongs to: another url is another stream. */
  readonly lastIdRef: MutableRefObject<{ url: string; id: string } | undefined>
  readonly clearReconnectTimer: () => void
}

/** The options a stream reads once it is open, each present in the type even when unset. */
type StreamSettings = { readonly url: string } & {
  readonly [K in 'withCredentials' | 'reconnectInitialMs' | 'reconnectMaxMs' | 'maxAttempts']:
    UseRealtimeSseOptions[K] | undefined
}

/** The state a hook instance returns, apart from `reconnect`. */
type SseView<TEvents extends Record<string, unknown>> = Omit<
  UseRealtimeSseReturn<TEvents>,
  'reconnect'
>

/** The state, the refs and the timer cancellation of one hook instance. */
function useSseStreamState<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeSseOptions,
): { view: SseView<TEvents>; context: SseStreamContext<TEvents> } {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<Array<SseEventEntry<TEvents>>>([])
  const [lastEvent, setLastEvent] = useState<SseEventEntry<TEvents> | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectMsRef = useRef<number>(validDelay(opts.reconnectInitialMs, 1_000))
  const attemptsRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastIdRef = useRef<{ url: string; id: string } | undefined>(undefined)

  // Cancels a scheduled retry. A timer that outlives the failure it was scheduled
  // for is destructive: it fires `connect` against a stream that has already
  // recovered, closing a healthy `EventSource` and losing the `Last-Event-ID` state
  // the browser keeps per object. Called before arming a new timer, on a successful
  // open, and on teardown.
  // Stryker disable ArrayDeclaration: equivalent — a `useCallback` whose dependency list is constant keeps one identity for the life of the component, whatever the list holds; measured by running the React specs with a one-element list
  const clearReconnectTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Stryker restore ArrayDeclaration
  const context = useMemo(
    () => ({
      setConnected,
      setError,
      setReconnectAttempts,
      setEvents,
      setLastEvent,
      sourceRef,
      reconnectMsRef,
      attemptsRef,
      timerRef,
      lastIdRef,
      clearReconnectTimer,
    }),
    [clearReconnectTimer],
  )
  return { view: { connected, events, lastEvent, error, reconnectAttempts }, context }
}

/**
 * The names of the application's events, as one string.
 *
 * Carried as a newline-joined string rather than the array itself: an inline
 * `eventNames={['order.created']}` literal has a new identity on every render, so
 * depending on the array would rebuild `connect` each render and the effect would
 * close and reopen the stream in a loop. A newline can never appear in an
 * SSE event name (it terminates the field), so the round trip is lossless.
 * Filtering happens here rather than at subscribe time so that a call passing only
 * rejected names produces the same key as no names at all — no needless reopen.
 */
function joinEventNames(names: readonly string[] | undefined): string {
  return (names ?? [])
    .filter((name) => name !== '' && !BROWSER_SSE_EVENT_NAMES.includes(name))
    .join('\n')
}

/** Start the backoff over: the next delay is the initial one and no attempt has failed yet. */
function resetBackoff<TEvents extends Record<string, unknown>>(
  context: SseStreamContext<TEvents>,
  reconnectInitialMs: number | undefined,
): void {
  context.reconnectMsRef.current = validDelay(reconnectInitialMs, 1_000)
  context.attemptsRef.current = 0
  context.setReconnectAttempts(0)
}

/** The handler of a successful open: the stream is up, so the failures so far are forgotten. */
function onOpenHandler<TEvents extends Record<string, unknown>>(
  context: SseStreamContext<TEvents>,
  opts: StreamSettings,
): () => void {
  return () => {
    context.setConnected(true)
    context.setError(undefined)
    // The browser restarts a dropped stream by itself, and usually beats our own
    // backoff to it. Drop the scheduled retry so it cannot tear down the stream
    // that just came back.
    context.clearReconnectTimer()
    // Reset backoff and the attempt counter on successful open.
    resetBackoff(context, opts.reconnectInitialMs)
  }
}

/** The handler of a failure: count it, then give up or schedule `retry` after a backoff. */
function onErrorHandler<TEvents extends Record<string, unknown>>(
  context: SseStreamContext<TEvents>,
  opts: StreamSettings,
  source: EventSource,
  retry: () => void,
): () => void {
  return () => {
    context.setConnected(false)
    context.setError(new Error('SSE connection error'))
    context.attemptsRef.current += 1
    context.setReconnectAttempts(context.attemptsRef.current)
    // Give up once the caller's attempt budget is exhausted; `reconnect` resets it.
    // Closing is what actually stops the retrying: a browser restarts a dropped
    // EventSource on its own, so merely skipping our own timer would leave the
    // endpoint being hammered forever. Only readyState CLOSED ends that.
    if (opts.maxAttempts !== undefined && context.attemptsRef.current >= opts.maxAttempts) {
      source.close()
      return
    }
    // Exponential backoff: double each failure, capped at reconnectMaxMs. Replacing
    // the pending timer rather than stacking one keeps a single retry in flight —
    // otherwise an orphaned earlier timer survives a recovery and fires anyway.
    context.clearReconnectTimer()
    const delay = nextBackoff(
      context.reconnectMsRef.current,
      validDelay(opts.reconnectMaxMs, 30_000),
    )
    context.reconnectMsRef.current = delay
    context.timerRef.current = setTimeout(retry, delay)
  }
}

/**
 * The handler for both the default `message` event and every named event.
 *
 * `e.type` is `'message'` for the default stream and the event name for named
 * listeners, so the original event `type` is preserved either way. The
 * `: keepalive` heartbeat is a raw comment and never surfaces here (spec §6.1, §13).
 */
function eventHandler<TEvents extends Record<string, unknown>>(
  context: SseStreamContext<TEvents>,
  url: string,
): (e: MessageEvent) => void {
  return (e) => {
    // A frame without an id says nothing about where the stream stands.
    if (e.lastEventId !== '') context.lastIdRef.current = { url, id: e.lastEventId }
    let data: TEvents[keyof TEvents]
    try {
      data = JSON.parse(e.data as string) as TEvents[keyof TEvents]
    } catch {
      // A non-JSON frame cannot become a typed event. Surface it through `error`
      // instead of throwing: an exception raised inside a DOM listener escapes to
      // window.onerror, where the consumer of this hook never sees it.
      context.setError(new Error(`Malformed SSE payload on "${e.type}"`))
      return
    }
    const entry: SseEventEntry<TEvents> = {
      type: e.type as keyof TEvents,
      data,
      id: e.lastEventId,
    }
    context.setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS))
    context.setLastEvent(entry)
  }
}

/**
 * Open a fresh `EventSource` and wire it to the hook's state, closing the previous one first.
 *
 * @param retry - What a failure schedules after its backoff: this same function, bound by the hook.
 */
function openStream<TEvents extends Record<string, unknown>>(
  context: SseStreamContext<TEvents>,
  opts: StreamSettings,
  extraEventNames: string,
  retry: () => void,
): void {
  // Close any existing source before opening a fresh one.
  context.sourceRef.current?.close()
  context.clearReconnectTimer()

  // A new EventSource has seen no event, so it sends no `Last-Event-ID`: the last id seen on this
  // url goes in the query instead. An id never outlives a change of url, so one from before a
  // detour to another url is not brought back.
  if (context.lastIdRef.current?.url !== opts.url) context.lastIdRef.current = undefined
  const source = new EventSource(withLastEventId(opts.url, context.lastIdRef.current?.id), {
    withCredentials: opts.withCredentials ?? false,
  })
  context.sourceRef.current = source
  source.onopen = onOpenHandler(context, opts)
  source.onerror = onErrorHandler(context, opts, source, retry)
  const handleEvent = eventHandler(context, opts.url)
  source.onmessage = handleEvent
  // Browsers route named events only to per-name listeners — subscribe so events
  // like `presence:online` keep their `type` instead of being dropped.
  for (const name of NAMED_SSE_EVENTS) {
    source.addEventListener(name, handleEvent as EventListener)
  }
  for (const name of extraEventNames === '' ? [] : extraEventNames.split('\n')) {
    source.addEventListener(name, handleEvent as EventListener)
  }
}

/**
 * Internal SSE hook — wraps `EventSource` with connection-state tracking,
 * event accumulation (last 100), and exponential backoff.
 *
 * This is the SSE branch of the universal hook and is NOT exported from the
 * public barrel. Consumers should use `useRealtime` or `useRealtimeConnection`.
 *
 * @example
 * const { connected, events, error } = useRealtimeSse<{ 'invoice.paid': { id: string } }>({
 *   url: '/realtime/sse',
 *   withCredentials: true,
 *   eventNames: ['invoice.paid'],
 * })
 */
export function useRealtimeSse<TEvents extends Record<string, unknown>>(
  opts: UseRealtimeSseOptions,
): UseRealtimeSseReturn<TEvents> {
  const { view, context } = useSseStreamState<TEvents>(opts)
  const extraEventNames = joinEventNames(opts.eventNames)

  const connect = useCallback(() => {
    if (opts.enabled === false) return
    openStream(
      context,
      {
        url: opts.url,
        withCredentials: opts.withCredentials,
        reconnectInitialMs: opts.reconnectInitialMs,
        reconnectMaxMs: opts.reconnectMaxMs,
        maxAttempts: opts.maxAttempts,
      },
      extraEventNames,
      connect,
    )
  }, [
    opts.enabled,
    opts.url,
    opts.withCredentials,
    opts.reconnectInitialMs,
    opts.reconnectMaxMs,
    opts.maxAttempts,
    extraEventNames,
    context,
  ])

  useEffect(() => {
    // Stryker disable next-line ConditionalExpression: equivalent — `connect` returns at once when `enabled` is false and the cleanup then finds no source, so a disabled hook behaves the same without this guard; measured by running the React specs without it
    if (opts.enabled === false) return
    connect()
    return () => {
      context.clearReconnectTimer()
      context.sourceRef.current?.close()
      context.sourceRef.current = null
    }
  }, [connect, opts.enabled, context])

  const reconnect = useCallback(() => {
    resetBackoff(context, opts.reconnectInitialMs)
    connect()
  }, [connect, opts.reconnectInitialMs, context])

  return { ...view, reconnect }
}
