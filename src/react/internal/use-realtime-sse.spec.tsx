/**
 * Tests for the SSE branch hook — `useRealtimeSse`.
 *
 * Exercises the full observable surface: open, message accumulation, last-event
 * tracking, the 100-entry cap, error + exponential backoff, manual reconnect,
 * cleanup on unmount, and `withCredentials` forwarding.
 */
import { act, renderHook } from '@testing-library/react'
import { emitError, emitMessage, EventSourceMock } from '../../../test/setup/react-setup'
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
})
