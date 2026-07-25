/**
 * Tests for the SSE branch hook — `useRealtimeSse`.
 *
 * Exercises the full observable surface: open, message accumulation, last-event
 * tracking, the 100-entry cap, error + exponential backoff, the failure counter and
 * its attempt ceiling, application event-name subscription, malformed payloads,
 * manual reconnect, cleanup on unmount, and `withCredentials` forwarding.
 */
import { act, renderHook } from '@testing-library/react'
import {
  emitError,
  emitMessage,
  emitNamedEvent,
  emitNativeReconnect,
  emitRawNamedEvent,
  EventSourceMock,
} from '../../../test/setup/react-setup'
import { useRealtimeSse } from './use-realtime-sse'

describe('useRealtimeSse', () => {
  let instances: EventSourceMock[]
  let OriginalEventSource: typeof global.EventSource

  beforeEach(() => {
    // Track every mock instance so tests can access them.
    instances = []
    OriginalEventSource = global.EventSource

    const TrackedMock = class extends EventSourceMock {
      constructor(url: string, opts?: EventSourceInit) {
        super(url, opts)
        instances.push(this)
      }
    }
    ;(global as unknown as { EventSource: unknown }).EventSource = TrackedMock
  })

  afterEach(() => {
    ;(global as unknown as { EventSource: unknown }).EventSource = OriginalEventSource
    jest.useRealTimers()
  })

  function lastInstance(): EventSourceMock {
    const inst = instances[instances.length - 1]
    if (!inst) throw new Error('No EventSourceMock instance')
    return inst
  }

  it('mounts without crashing and exposes the initial disconnected state', () => {
    // Basic smoke test — hook must render without throwing.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    expect(result.current.connected).toBe(false)
    expect(result.current.events).toHaveLength(0)
    expect(result.current.lastEvent).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it('sets connected to true after the EventSource fires open', async () => {
    // onopen deferred to the next tick — must await timers.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(result.current.connected).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it('appends a received message to events with the correct lastEventId', async () => {
    // emitMessage serializes data and fires onmessage with the given lastEventId.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    act(() => {
      emitMessage(source, { foo: 42 }, 'ev-1')
    })
    expect(result.current.events).toHaveLength(1)
    expect(result.current.events[0]?.id).toBe('ev-1')
    expect(result.current.events[0]?.data).toEqual({ foo: 42 })
  })

  it('records a default onmessage event with type "message"', async () => {
    // The default (unnamed) SSE event must keep the W3C default type of "message".
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    act(() => {
      emitMessage(lastInstance(), { foo: 1 }, 'ev-1')
    })
    expect(result.current.events[0]?.type).toBe('message')
  })

  it('delivers named SSE events with their type preserved (presence over SSE)', async () => {
    // Named events (e.g. presence:online) arrive via addEventListener, NOT onmessage —
    // their `type` must survive so usePresence works over the SSE transport.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    act(() => {
      emitNamedEvent(source, 'presence:online', { userId: 'u1' }, 'ev-2')
    })
    expect(result.current.events).toHaveLength(1)
    expect(result.current.lastEvent?.type).toBe('presence:online')
    expect(result.current.lastEvent?.data).toEqual({ userId: 'u1' })
    expect(result.current.lastEvent?.id).toBe('ev-2')
  })

  it('subscribes to reserved named events such as connection:established', async () => {
    // Reserved catalog events are also named events and must flow through with type.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    act(() => {
      emitNamedEvent(lastInstance(), 'connection:established', { connectionId: 'c1' })
    })
    expect(result.current.lastEvent?.type).toBe('connection:established')
  })

  it('updates lastEvent to reflect the most recently received message', async () => {
    // lastEvent is always the tail of the events array.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    act(() => {
      emitMessage(source, { n: 1 }, 'id-1')
    })
    act(() => {
      emitMessage(source, { n: 2 }, 'id-2')
    })
    expect(result.current.lastEvent?.id).toBe('id-2')
    expect(result.current.lastEvent?.data).toEqual({ n: 2 })
  })

  it('caps the events array at 100 entries', async () => {
    // Pushing more than MAX_EVENTS keeps only the last 100.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    act(() => {
      for (let i = 0; i < 110; i++) {
        emitMessage(source, { i }, `id-${i}`)
      }
    })
    expect(result.current.events).toHaveLength(100)
    expect(result.current.events[0]?.id).toBe('id-10')
    expect(result.current.events[99]?.id).toBe('id-109')
  })

  it('sets connected false and error when onerror fires', async () => {
    // An SSE error must surface as a non-undefined error and flip connected.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    jest.useFakeTimers()
    act(() => {
      emitError(source)
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeDefined()
    jest.useRealTimers()
  })

  it('implements exponential backoff on consecutive errors', async () => {
    // Each onerror should double the reconnect delay (initial=1000, max=30000).
    jest.useFakeTimers()
    const { result } = renderHook(() =>
      useRealtimeSse({ url: '/realtime/sse', reconnectInitialMs: 1_000, reconnectMaxMs: 30_000 }),
    )
    // Open the connection (manually fire the deferred open since fake timers).
    act(() => {
      const src = lastInstance()
      src.readyState = 1
      src.onopen?.(new Event('open'))
    })
    expect(result.current.connected).toBe(true)

    // First error: next reconnect at 2000 ms.
    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.connected).toBe(false)

    // Advance 2000 ms — expect a new EventSource to open.
    act(() => {
      jest.advanceTimersByTime(2_000)
    })
    expect(instances.length).toBeGreaterThanOrEqual(2)

    // Open second connection.
    act(() => {
      const src = lastInstance()
      src.readyState = 1
      src.onopen?.(new Event('open'))
    })

    // Second error: next reconnect at 4000 ms.
    act(() => {
      emitError(lastInstance())
    })
    act(() => {
      jest.advanceTimersByTime(4_000)
    })
    expect(instances.length).toBeGreaterThanOrEqual(3)

    jest.useRealTimers()
  })

  it('forces a new EventSource when reconnect() is called manually', async () => {
    // Manual reconnect resets the backoff and opens a fresh source immediately.
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const countBefore = instances.length
    act(() => {
      result.current.reconnect()
    })
    expect(instances.length).toBeGreaterThan(countBefore)
  })

  it('closes the EventSource when the component unmounts', async () => {
    // Cleanup effect must call close() so the source stops receiving events.
    const { unmount } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = lastInstance()
    unmount()
    expect(source.readyState).toBe(2)
  })

  it('forwards withCredentials to the EventSource constructor', () => {
    // The option must reach the EventSource constructor unchanged.
    renderHook(() => useRealtimeSse({ url: '/realtime/sse', withCredentials: true }))
    const source = lastInstance()
    expect(source.withCredentials).toBe(true)
  })

  it('does nothing when enabled is false', () => {
    // A disabled hook must not create an EventSource.
    const countBefore = instances.length
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse', enabled: false }))
    expect(instances.length).toBe(countBefore)
    expect(result.current.connected).toBe(false)
    expect(result.current.events).toHaveLength(0)
  })

  it('does not create a new EventSource when reconnect() is called while disabled', () => {
    // The enabled guard inside connect() must short-circuit even when called via reconnect(),
    // covering the branch where connect() itself returns early on enabled === false.
    const countBefore = instances.length
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse', enabled: false }))
    act(() => {
      result.current.reconnect()
    })
    expect(instances.length).toBe(countBefore)
    expect(result.current.connected).toBe(false)
  })

  it('resets the backoff counter when the connection opens successfully', async () => {
    // After a successful open, reconnectMsRef should be reset to the initial value.
    jest.useFakeTimers()
    renderHook(() =>
      useRealtimeSse({ url: '/realtime/sse', reconnectInitialMs: 1_000, reconnectMaxMs: 30_000 }),
    )

    // Open connection.
    act(() => {
      const src = lastInstance()
      src.readyState = 1
      src.onopen?.(new Event('open'))
    })

    // First error — sets delay to 2000.
    act(() => {
      emitError(lastInstance())
    })
    act(() => {
      jest.advanceTimersByTime(2_000)
    })

    // Open the reconnected source — this resets the backoff.
    act(() => {
      const src = lastInstance()
      src.readyState = 1
      src.onopen?.(new Event('open'))
    })

    // Next error should again use initial*2 = 2000 (not 4000).
    act(() => {
      emitError(lastInstance())
    })
    const instanceCountAfterSecondError = instances.length
    act(() => {
      jest.advanceTimersByTime(2_000)
    })
    expect(instances.length).toBeGreaterThan(instanceCountAfterSecondError)

    jest.useRealTimers()
  })

  it('subscribes to the application event names passed in `eventNames`', async () => {
    // EventSource routes a named event only to a listener registered for that exact
    // name, so an application-level name is invisible unless the caller opts in.
    const { result } = renderHook(() =>
      useRealtimeSse({ url: '/realtime/sse', eventNames: ['order.created'] }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      emitNamedEvent(lastInstance(), 'order.created', { orderId: 'o-1' }, '7')
    })
    expect(result.current.lastEvent).toEqual({
      type: 'order.created',
      data: { orderId: 'o-1' },
      id: '7',
    })
  })

  it('does not reopen the stream when re-rendered with an equal inline eventNames array', async () => {
    // Regression guard, mirroring the WebSocket auth case: an inline array literal
    // has a new identity every render, so keying connect() on it would close and
    // reopen the stream on each render.
    const { rerender } = renderHook(
      ({ name }: { name: string }) => useRealtimeSse({ url: '/realtime/sse', eventNames: [name] }),
      { initialProps: { name: 'order.created' } },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(instances.length).toBe(1)

    rerender({ name: 'order.created' })
    rerender({ name: 'order.created' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(instances.length).toBe(1)
  })

  it('reopens the stream when the subscribed event names change', async () => {
    // A different name needs a listener the current source does not have.
    const { rerender } = renderHook(
      ({ name }: { name: string }) => useRealtimeSse({ url: '/realtime/sse', eventNames: [name] }),
      { initialProps: { name: 'order.created' } },
    )
    await act(async () => {
      await Promise.resolve()
    })

    rerender({ name: 'order.paid' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(instances.length).toBe(2)
  })

  it("ignores the browser's own event names and re-registered catalog names", async () => {
    // `message` is bound as onmessage and `error`/`open` are the browser's own
    // connection signals: re-registering them would double-record every default event
    // and run the JSON parser over a payload-less connection signal. Empty names are
    // dropped too — they can never match a real SSE `event:` field. A repeated catalog
    // name needs no filter: addEventListener ignores an identical (type, callback).
    renderHook(() =>
      useRealtimeSse({
        url: '/realtime/sse',
        eventNames: ['message', 'error', 'open', 'presence:online', '', 'order.created'],
      }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    const source = lastInstance()

    expect(source.listeners.has('message')).toBe(false)
    expect(source.listeners.has('error')).toBe(false)
    expect(source.listeners.has('open')).toBe(false)
    expect(source.listeners.has('')).toBe(false)
    // A catalog name passed by the caller still ends up with exactly one listener.
    expect(source.listeners.get('presence:online')?.size).toBe(1)
    expect(source.listeners.has('order.created')).toBe(true)
  })

  it('does not reopen the stream when only rejected event names change', async () => {
    // Rejected names never reach a listener, so swapping one for another must not be
    // treated as a subscription change that warrants a fresh EventSource.
    const { rerender } = renderHook(
      ({ name }: { name: string }) => useRealtimeSse({ url: '/realtime/sse', eventNames: [name] }),
      { initialProps: { name: 'message' } },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(instances.length).toBe(1)

    rerender({ name: 'error' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(instances.length).toBe(1)
  })

  it('reports a malformed payload through error instead of throwing at the listener', async () => {
    // A non-JSON frame must not raise inside a DOM listener, where the exception
    // escapes to window.onerror and the consumer of the hook never sees it.
    const { result } = renderHook(() =>
      useRealtimeSse({ url: '/realtime/sse', eventNames: ['order.created'] }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(() =>
      act(() => {
        emitRawNamedEvent(lastInstance(), 'order.created', 'not json at all')
      }),
    ).not.toThrow()
    expect(result.current.error?.message).toContain('order.created')
    expect(result.current.events).toHaveLength(0)
    expect(result.current.lastEvent).toBeUndefined()
  })

  it('counts consecutive failures without an intervening successful open', async () => {
    // The counter is what a status indicator shows while a stream is flapping, so it
    // must accumulate across retries that never manage to open.
    jest.useFakeTimers()
    const { result } = renderHook(() =>
      useRealtimeSse({ url: '/realtime/sse', reconnectInitialMs: 1_000 }),
    )
    expect(result.current.reconnectAttempts).toBe(0)

    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(1)

    // A second failure on the same source models the browser's own retry failing:
    // no open happened in between, so the count must climb rather than restart.
    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(2)

    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(3)

    jest.useRealTimers()
  })

  it('resets the failure count once the stream opens again', async () => {
    // A recovered stream must stop reporting a backlog of failures.
    jest.useFakeTimers()
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse' }))
    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(1)

    act(() => {
      const src = lastInstance()
      src.readyState = 1
      src.onopen?.(new Event('open'))
    })
    expect(result.current.reconnectAttempts).toBe(0)

    jest.useRealTimers()
  })

  it('closes the stream for good once maxAttempts consecutive failures are reached', async () => {
    // Skipping our own retry timer is not enough to stop retrying: a browser restarts
    // a dropped EventSource by itself, and only readyState CLOSED ends that. Without
    // the close, a permanently-down endpoint keeps being hit forever.
    jest.useFakeTimers()
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse', maxAttempts: 1 }))
    const source = lastInstance()
    act(() => {
      emitError(source)
    })
    expect(result.current.reconnectAttempts).toBe(1)
    expect(source.readyState).toBe(2)

    // The browser cannot revive a closed source, and no retry timer was scheduled.
    const countAfterGivingUp = instances.length
    act(() => {
      emitNativeReconnect(source)
      jest.advanceTimersByTime(60_000)
    })
    expect(instances.length).toBe(countAfterGivingUp)
    expect(result.current.connected).toBe(false)
    expect(result.current.reconnectAttempts).toBe(1)

    jest.useRealTimers()
  })

  it('keeps the stream open while the attempt budget still has room', async () => {
    // The close is specific to giving up — an ordinary failure must leave the source
    // alive for the scheduled retry (and for the browser's own restart).
    jest.useFakeTimers()
    renderHook(() => useRealtimeSse({ url: '/realtime/sse', maxAttempts: 3 }))
    const source = lastInstance()
    act(() => {
      emitError(source)
    })
    expect(source.readyState).not.toBe(2)

    jest.useRealTimers()
  })

  it('resumes retrying after a manual reconnect exhausted the attempt budget', async () => {
    // The budget is about automatic retries; an explicit user action resets it.
    jest.useFakeTimers()
    const { result } = renderHook(() => useRealtimeSse({ url: '/realtime/sse', maxAttempts: 1 }))
    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(1)

    act(() => {
      result.current.reconnect()
    })
    expect(result.current.reconnectAttempts).toBe(0)

    act(() => {
      emitError(lastInstance())
    })
    expect(result.current.reconnectAttempts).toBe(1)

    jest.useRealTimers()
  })
})
