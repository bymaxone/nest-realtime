/**
 * Tests for `usePresence`.
 *
 * The hook reads the `events` array from `useRealtimeContext` and processes
 * `presence:online` / `presence:offline` typed events. These arrive via the
 * WebSocket path (where `onAny` preserves the event name as `type`) or via named
 * SSE events once named-event support lands in the SSE hook.
 *
 * To isolate the state-machine logic from transport details, `useRealtimeContext`
 * is mocked so tests can inject events with any type directly.
 */
import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { emitNamedEvent, EventSourceMock } from '../../../test/setup/react-setup'
import { RealtimeProvider, useRealtimeContext } from '../providers/realtime-provider'
import { usePresence } from './use-presence'

// Mock the context so we can inject arbitrary events without a real transport.
jest.mock('../providers/realtime-provider', () => ({
  ...jest.requireActual('../providers/realtime-provider'),
  useRealtimeContext: jest.fn(),
}))

const mockUseContext = useRealtimeContext as jest.MockedFunction<typeof useRealtimeContext>

/** Build a context stub with a controllable events array. */
function makeContextStub(events: Array<{ type: string; data: unknown }>) {
  // Cast to the expected return type — tests control event shapes directly.
  return {
    connected: true,
    events: events,
    lastEvent: events[events.length - 1],
    error: undefined,
    reconnect: jest.fn(),
    transport: 'sse' as const,
    emit: undefined as never,
  } as unknown as ReturnType<typeof useRealtimeContext>
}

describe('usePresence', () => {
  afterEach(() => {
    mockUseContext.mockReset()
  })

  it('throws when called outside a RealtimeProvider', () => {
    // The hook delegates to useRealtimeContext which throws outside the provider.
    const actual = jest.requireActual('../providers/realtime-provider') as {
      useRealtimeContext: typeof useRealtimeContext
    }
    const { useRealtimeContext: realCtx } = actual
    mockUseContext.mockImplementation(realCtx)
    expect(() => renderHook(() => usePresence())).toThrow(
      'useRealtimeContext must be used within <RealtimeProvider>',
    )
  })

  it('starts with empty onlineUserIds and count 0 when no events have arrived', () => {
    // Before any presence events the set must be empty.
    mockUseContext.mockReturnValue(makeContextStub([]))
    const { result } = renderHook(() => usePresence())
    expect(result.current.onlineUserIds).toHaveLength(0)
    expect(result.current.count).toBe(0)
  })

  it('adds a userId to onlineUserIds on a presence:online event', () => {
    // A presence:online event must register the userId as online.
    mockUseContext.mockReturnValue(
      makeContextStub([{ type: 'presence:online', data: { userId: 'u1' } }]),
    )
    const { result } = renderHook(() => usePresence())
    act(() => {}) // flush effects
    expect(result.current.onlineUserIds).toContain('u1')
    expect(result.current.count).toBe(1)
  })

  it('removes a userId from onlineUserIds on a presence:offline event', () => {
    // After presence:online and then presence:offline, the user must be removed.
    const { rerender, result } = renderHook(
      ({ events }: { events: Array<{ type: string; data: unknown }> }) => {
        mockUseContext.mockReturnValue(makeContextStub(events))
        return usePresence()
      },
      { initialProps: { events: [{ type: 'presence:online', data: { userId: 'u1' } }] } },
    )
    act(() => {})
    expect(result.current.onlineUserIds).toContain('u1')

    rerender({ events: [{ type: 'presence:offline', data: { userId: 'u1' } }] })
    act(() => {})
    expect(result.current.onlineUserIds).not.toContain('u1')
    expect(result.current.count).toBe(0)
  })

  it('isOnline returns true for an online user and false for an offline user', () => {
    // isOnline() must reflect the current online set accurately.
    mockUseContext.mockReturnValue(
      makeContextStub([{ type: 'presence:online', data: { userId: 'u2' } }]),
    )
    const { result } = renderHook(() => usePresence())
    act(() => {})
    expect(result.current.isOnline('u2')).toBe(true)
    expect(result.current.isOnline('unknown')).toBe(false)
  })

  it('accumulates multiple online users across successive event updates', () => {
    // Each render cycle processes the last event so users accumulate over rerenders.
    const { rerender, result } = renderHook(
      ({ events }: { events: Array<{ type: string; data: unknown }> }) => {
        mockUseContext.mockReturnValue(makeContextStub(events))
        return usePresence()
      },
      {
        initialProps: {
          events: [{ type: 'presence:online', data: { userId: 'u1' } }],
        },
      },
    )
    act(() => {})
    expect(result.current.onlineUserIds).toContain('u1')

    rerender({ events: [{ type: 'presence:online', data: { userId: 'u2' } }] })
    act(() => {})
    // Both u1 (from previous cycle) and u2 (from this cycle) must be tracked.
    expect(result.current.onlineUserIds).toContain('u1')
    expect(result.current.onlineUserIds).toContain('u2')

    rerender({ events: [{ type: 'presence:offline', data: { userId: 'u2' } }] })
    act(() => {})
    expect(result.current.isOnline('u2')).toBe(false)
    expect(result.current.isOnline('u1')).toBe(true)
  })

  it('ignores events whose type is not presence:online or presence:offline', () => {
    // Non-presence events must not alter the online set.
    mockUseContext.mockReturnValue(makeContextStub([{ type: 'message', data: { userId: 'u3' } }]))
    const { result } = renderHook(() => usePresence())
    act(() => {})
    expect(result.current.count).toBe(0)
    expect(result.current.onlineUserIds).toHaveLength(0)
  })

  it('returns onlineUserIds sorted regardless of arrival order', () => {
    // The documented contract is a sorted array — insertion order (u3, u1, u2) must
    // not leak through; the output must be ['u1', 'u2', 'u3'].
    const { rerender, result } = renderHook(
      ({ events }: { events: Array<{ type: string; data: unknown }> }) => {
        mockUseContext.mockReturnValue(makeContextStub(events))
        return usePresence()
      },
      { initialProps: { events: [{ type: 'presence:online', data: { userId: 'u3' } }] } },
    )
    act(() => {})
    rerender({ events: [{ type: 'presence:online', data: { userId: 'u1' } }] })
    act(() => {})
    rerender({ events: [{ type: 'presence:online', data: { userId: 'u2' } }] })
    act(() => {})
    expect(result.current.onlineUserIds).toEqual(['u1', 'u2', 'u3'])
  })

  it('does not crash when the events array is empty (no lastEv)', () => {
    // The early return when events is empty must not cause any error.
    mockUseContext.mockReturnValue(makeContextStub([]))
    expect(() => renderHook(() => usePresence())).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Integration test: usePresence inside a real RealtimeProvider (no mock)
// ---------------------------------------------------------------------------
describe('usePresence — real provider guard (unmocked)', () => {
  beforeEach(() => {
    const actual = jest.requireActual('../providers/realtime-provider') as {
      useRealtimeContext: typeof useRealtimeContext
    }
    const { useRealtimeContext: realCtx } = actual
    mockUseContext.mockImplementation(realCtx)
  })

  afterEach(() => {
    mockUseContext.mockReset()
  })

  it('mounts successfully inside a real RealtimeProvider', () => {
    // Smoke test: usePresence must mount without throwing when inside a provider.
    let instances: EventSourceMock[] = []
    const OriginalEventSource = global.EventSource

    const TrackedMock = class extends EventSourceMock {
      constructor(url: string, opts?: EventSourceInit) {
        super(url, opts)
        instances.push(this)
      }
    }
    ;(global as unknown as { EventSource: unknown }).EventSource = TrackedMock

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider options={{ url: '/realtime/sse' }}>{children}</RealtimeProvider>
    )

    expect(() => renderHook(() => usePresence(), { wrapper })).not.toThrow()
    ;(global as unknown as { EventSource: unknown }).EventSource = OriginalEventSource
    instances = []
  })

  it('marks a user online from a named presence:online SSE event end-to-end', async () => {
    // Full SSE path: the provider opens an EventSource, the SSE hook subscribes to the
    // named presence event, and usePresence reflects it — proving presence works over SSE.
    const instances: EventSourceMock[] = []
    const OriginalEventSource = global.EventSource

    const TrackedMock = class extends EventSourceMock {
      constructor(url: string, opts?: EventSourceInit) {
        super(url, opts)
        instances.push(this)
      }
    }
    ;(global as unknown as { EventSource: unknown }).EventSource = TrackedMock

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider options={{ url: '/realtime/sse' }}>{children}</RealtimeProvider>
    )

    const { result } = renderHook(() => usePresence(), { wrapper })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const source = instances[instances.length - 1]!
    act(() => {
      emitNamedEvent(source, 'presence:online', { userId: 'u1' }, 'ev-1')
    })
    act(() => {})

    expect(result.current.isOnline('u1')).toBe(true)
    expect(result.current.onlineUserIds).toEqual(['u1'])
    ;(global as unknown as { EventSource: unknown }).EventSource = OriginalEventSource
  })
})
