/**
 * Jest setup for the `react` jsdom test project.
 *
 * jsdom does not ship a global `EventSource` implementation. This file installs
 * a minimal, controllable mock so hook tests can open, receive messages, and
 * simulate errors without any network I/O.
 *
 * The mock defers `onopen` to the next tick — matching real browser behavior
 * where the connection establishment is asynchronous.
 */

/** Controllable EventSource substitute for use under jsdom. */
export class EventSourceMock {
  readonly url: string
  readonly withCredentials: boolean
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  /** Named-event listeners registered via addEventListener, keyed by event name. */
  readonly listeners = new Map<string, Set<(ev: MessageEvent) => void>>()

  constructor(url: string, opts?: EventSourceInit) {
    this.url = url
    this.withCredentials = opts?.withCredentials ?? false
    // Defer onopen to the next tick to mimic async connection establishment.
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.(new Event('open'))
    }, 0)
  }

  close(): void {
    this.readyState = 2
  }

  addEventListener(type: string, handler: (ev: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: (ev: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  dispatchEvent(): boolean {
    return true
  }
}

// Install the mock globally so `new EventSource(...)` in hooks resolves to it.
;(global as unknown as { EventSource: typeof EventSourceMock }).EventSource = EventSourceMock

/**
 * Simulate a `message` event on a mock `EventSource`.
 *
 * @param source      - The `EventSourceMock` instance to fire the event on.
 * @param data        - Payload — will be JSON-serialized to mimic the wire format.
 * @param lastEventId - Optional Last-Event-ID string.
 */
export function emitMessage(source: EventSourceMock, data: unknown, lastEventId = ''): void {
  const ev = new MessageEvent('message', { data: JSON.stringify(data), lastEventId })
  source.onmessage?.(ev)
}

/**
 * Simulate a named SSE event (e.g. `presence:online`) on a mock `EventSource`.
 *
 * Dispatches to listeners registered via `addEventListener(type, …)`, mirroring
 * how browsers route named events away from `onmessage`.
 *
 * @param source      - The `EventSourceMock` instance to fire the event on.
 * @param type        - The named event type (the SSE `event:` field value).
 * @param data        - Payload — will be JSON-serialized to mimic the wire format.
 * @param lastEventId - Optional Last-Event-ID string.
 */
export function emitNamedEvent(
  source: EventSourceMock,
  type: string,
  data: unknown,
  lastEventId = '',
): void {
  const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId })
  source.listeners.get(type)?.forEach((handler) => handler(ev))
}

/**
 * Simulate an error event on a mock `EventSource`.
 *
 * @param source - The `EventSourceMock` instance to fire the error on.
 */
export function emitError(source: EventSourceMock): void {
  source.onerror?.(new Event('error'))
}
