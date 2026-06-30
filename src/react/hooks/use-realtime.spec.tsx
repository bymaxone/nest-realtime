/**
 * Tests for the universal hook — `useRealtime`.
 *
 * Verifies transport auto-detection from URL scheme and explicit transport
 * overrides. Both internal hooks are mocked so tests stay isolated from
 * EventSource / socket.io-client specifics.
 */
// Mock both internal hooks BEFORE any imports that load the module under test.
jest.mock('../internal/use-realtime-sse', () => ({
  useRealtimeSse: jest.fn(() => ({
    connected: false,
    events: [],
    lastEvent: undefined,
    error: undefined,
    reconnect: jest.fn(),
  })),
}))

jest.mock('../internal/use-realtime-ws', () => ({
  useRealtimeWs: jest.fn(() => ({
    connected: false,
    events: [],
    lastEvent: undefined,
    error: undefined,
    emit: jest.fn(),
    reconnect: jest.fn(),
  })),
}))

import { renderHook } from '@testing-library/react'
import { useRealtimeSse } from '../internal/use-realtime-sse'
import { useRealtimeWs } from '../internal/use-realtime-ws'
import { useRealtime } from './use-realtime'

const mockSse = useRealtimeSse as jest.MockedFunction<typeof useRealtimeSse>
const mockWs = useRealtimeWs as jest.MockedFunction<typeof useRealtimeWs>

beforeEach(() => {
  mockSse.mockClear()
  mockWs.mockClear()
})

describe('useRealtime — transport detection', () => {
  it('selects SSE for a relative path URL', () => {
    // A path starting with "/" has no scheme so SSE is chosen.
    const { result } = renderHook(() => useRealtime({ url: '/realtime/sse' }))
    expect(result.current.transport).toBe('sse')
    expect(mockSse).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(mockWs).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('selects SSE for an http:// URL', () => {
    // http:// is a server-sent-events endpoint, not a websocket.
    const { result } = renderHook(() => useRealtime({ url: 'http://localhost/sse' }))
    expect(result.current.transport).toBe('sse')
    expect(mockSse).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('selects SSE for an https:// URL', () => {
    // https:// follows the same SSE detection rule as http://.
    const { result } = renderHook(() => useRealtime({ url: 'https://api.example.com/sse' }))
    expect(result.current.transport).toBe('sse')
  })

  it('selects WebSocket for a ws:// URL', () => {
    // ws:// must trigger the WebSocket branch.
    const { result } = renderHook(() => useRealtime({ url: 'ws://localhost' }))
    expect(result.current.transport).toBe('websocket')
    expect(mockWs).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(mockSse).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('selects WebSocket for a wss:// URL', () => {
    // wss:// (secure WebSocket) must also trigger the WebSocket branch.
    const { result } = renderHook(() => useRealtime({ url: 'wss://api.example.com/socket.io' }))
    expect(result.current.transport).toBe('websocket')
  })

  it('forces SSE when transport: sse overrides a ws:// URL', () => {
    // An explicit transport override must take precedence over URL-based detection.
    const { result } = renderHook(() => useRealtime({ url: 'ws://localhost', transport: 'sse' }))
    expect(result.current.transport).toBe('sse')
    expect(mockSse).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('forces WebSocket when transport: websocket overrides an http:// URL', () => {
    // An explicit transport: websocket must override the http URL auto-detection.
    const { result } = renderHook(() =>
      useRealtime({ url: 'http://localhost/realtime', transport: 'websocket' }),
    )
    expect(result.current.transport).toBe('websocket')
    expect(mockWs).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('behaves like auto when transport: auto is explicitly set', () => {
    // transport: auto must behave identically to omitting the transport option.
    const { result } = renderHook(() => useRealtime({ url: '/realtime/sse', transport: 'auto' }))
    expect(result.current.transport).toBe('sse')
  })

  it('exposes emit as undefined for the SSE branch', () => {
    // The SSE path has no full-duplex emit; consumers must handle this absence.
    const { result } = renderHook(() => useRealtime({ url: '/realtime/sse' }))
    // TypeScript types it as `never`; at runtime the property is undefined.
    expect(result.current.emit).toBeUndefined()
  })

  it('forwards withCredentials to the SSE hook when provided', () => {
    // withCredentials must reach useRealtimeSse when the SSE transport is active.
    renderHook(() => useRealtime({ url: '/realtime/sse', withCredentials: true }))
    expect(mockSse).toHaveBeenCalledWith(expect.objectContaining({ withCredentials: true }))
  })

  it('forwards auth to the WS hook when provided', () => {
    // auth credentials must be passed through to useRealtimeWs for the handshake.
    renderHook(() => useRealtime({ url: 'ws://localhost', auth: { token: 'secret' } }))
    expect(mockWs).toHaveBeenCalledWith(expect.objectContaining({ auth: { token: 'secret' } }))
  })

  it('forwards path to the WS hook when provided', () => {
    // A custom socket.io path must be forwarded to useRealtimeWs unchanged.
    renderHook(() => useRealtime({ url: 'ws://localhost', path: '/custom-io' }))
    expect(mockWs).toHaveBeenCalledWith(expect.objectContaining({ path: '/custom-io' }))
  })
})
