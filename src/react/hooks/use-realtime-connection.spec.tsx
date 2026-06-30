/**
 * Tests for `useRealtimeConnection` — the lite connection hook.
 *
 * Verifies that the hook returns only `{ connected, error, reconnect }` with no
 * events array, and that the returned values reflect live connection state.
 */
import { act, renderHook } from '@testing-library/react'
import { EventSourceMock, emitError } from '../../../test/setup/react-setup'
import { useRealtimeConnection } from './use-realtime-connection'

describe('useRealtimeConnection', () => {
  let instances: EventSourceMock[]
  let OriginalEventSource: typeof global.EventSource

  beforeEach(() => {
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

  it('returns only connected, error, and reconnect (no events array)', () => {
    // The lite hook must not expose an events array — it is omitted intentionally.
    const { result } = renderHook(() => useRealtimeConnection({ url: '/realtime/sse' }))
    expect('connected' in result.current).toBe(true)
    expect('error' in result.current).toBe(true)
    expect('reconnect' in result.current).toBe(true)
    expect('events' in result.current).toBe(false)
  })

  it('reflects connected state after the EventSource opens', async () => {
    // connected must become true once the EventSource fires open.
    const { result } = renderHook(() => useRealtimeConnection({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(result.current.connected).toBe(true)
  })

  it('exposes an error and disconnects when onerror fires', async () => {
    // An SSE error must propagate through the lite hook.
    const { result } = renderHook(() => useRealtimeConnection({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const source = instances[instances.length - 1]!
    jest.useFakeTimers()
    act(() => {
      emitError(source)
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeDefined()
    jest.useRealTimers()
  })

  it('reconnect() opens a new EventSource', async () => {
    // The reconnect function must be callable and trigger a fresh connection.
    const { result } = renderHook(() => useRealtimeConnection({ url: '/realtime/sse' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const countBefore = instances.length
    act(() => {
      result.current.reconnect()
    })
    expect(instances.length).toBeGreaterThan(countBefore)
  })
})
