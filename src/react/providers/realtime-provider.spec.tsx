/**
 * Tests for `RealtimeProvider` and `useRealtimeContext`.
 *
 * Verifies that the provider renders children, the context is accessible inside,
 * throws a clear error outside, and that all consumers share ONE underlying
 * connection (one EventSource for SSE).
 */
import React from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { EventSourceMock } from '../../../test/setup/react-setup'
import { RealtimeProvider, useRealtimeContext } from './realtime-provider'

describe('RealtimeProvider', () => {
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
  })

  it('renders children without crashing', () => {
    // Basic smoke test — provider must mount and render children.
    const { getByText } = render(
      <RealtimeProvider options={{ url: '/realtime/sse' }}>
        <span>hello</span>
      </RealtimeProvider>,
    )
    expect(getByText('hello')).toBeTruthy()
  })

  it('provides the realtime context to descendant hooks', async () => {
    // useRealtimeContext() inside a provider must return the hook value.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider options={{ url: '/realtime/sse' }}>{children}</RealtimeProvider>
    )
    const { result } = renderHook(() => useRealtimeContext(), { wrapper })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // Context must expose at least connected and reconnect.
    expect(typeof result.current.connected).toBe('boolean')
    expect(typeof result.current.reconnect).toBe('function')
  })

  it('throws an explanatory error when called outside a provider', () => {
    // A clear error message helps developers locate the misconfiguration.
    expect(() => renderHook(() => useRealtimeContext())).toThrow(
      'useRealtimeContext must be used within <RealtimeProvider>',
    )
  })

  it('shares ONE connection across multiple consumers inside the provider', async () => {
    // Multiple children must NOT each open their own EventSource — one is shared.
    function ConsumerA() {
      useRealtimeContext()
      return null
    }
    function ConsumerB() {
      useRealtimeContext()
      return null
    }
    render(
      <RealtimeProvider options={{ url: '/realtime/sse' }}>
        <ConsumerA />
        <ConsumerB />
      </RealtimeProvider>,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // Only one EventSource must be opened for both consumers.
    expect(instances).toHaveLength(1)
  })
})
