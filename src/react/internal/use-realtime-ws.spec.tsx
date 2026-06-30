/**
 * Tests for the WebSocket branch hook — `useRealtimeWs`.
 *
 * socket.io-client is loaded via a dynamic `import()` inside the hook.
 * Jest's module-level `jest.mock(...)` intercepts both static and dynamic
 * imports so the mock is in place before any `await import('socket.io-client')`
 * call resolves. We capture the mock handles via module-scope variables so
 * individual tests can control the fake socket without reloading modules.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { useRealtimeWs } from './use-realtime-ws'

// ---- socket.io-client mock -----------------------------------------------

/** Handlers registered via socket.on(). */
const socketHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
/** Handler registered via socket.onAny(). */
let anyHandler: ((event: string, payload: unknown) => void) | undefined = undefined

const mockSocket = {
  on: (event: string, h: (...args: unknown[]) => void) => {
    const existing = socketHandlers.get(event)
    if (existing) existing.push(h)
    else socketHandlers.set(event, [h])
  },
  onAny: (h: (event: string, payload: unknown) => void) => {
    anyHandler = h
  },
  emit: jest.fn<void, [string, unknown]>(),
  removeAllListeners: jest.fn<void, []>(),
  disconnect: jest.fn<void, []>(),
}

const mockIo = jest.fn(() => mockSocket)

jest.mock('socket.io-client', () => ({ io: mockIo }))

/** A self-contained fake socket — used to distinguish individual connections. */
function makeFreshSocket() {
  return {
    on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
    onAny: jest.fn<void, [(event: string, payload: unknown) => void]>(),
    emit: jest.fn<void, [string, unknown]>(),
    removeAllListeners: jest.fn<void, []>(),
    disconnect: jest.fn<void, []>(),
  }
}

// Helpers to trigger events on the fake socket.
function trigger(event: string, ...args: unknown[]): void {
  socketHandlers.get(event)?.forEach((h) => h(...args))
}
function triggerAny(event: string, payload: unknown): void {
  anyHandler?.(event, payload)
}

// --------------------------------------------------------------------------

beforeEach(() => {
  socketHandlers.clear()
  anyHandler = undefined
  mockSocket.emit.mockReset()
  mockSocket.removeAllListeners.mockReset()
  mockSocket.disconnect.mockReset()
  mockIo.mockReset()
  mockIo.mockReturnValue(mockSocket)
})

describe('useRealtimeWs', () => {
  it('calls io(url, options) after mount', async () => {
    // The hook loads socket.io-client lazily; io() is called once per mount.
    renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    expect(mockIo).toHaveBeenCalledWith(
      'ws://localhost',
      expect.objectContaining({ withCredentials: true }),
    )
  })

  it('sets connected true on connect and false on disconnect', async () => {
    // The lifecycle events track the socket state correctly.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('connect'))
    expect(result.current.connected).toBe(true)
    act(() => trigger('disconnect'))
    expect(result.current.connected).toBe(false)
  })

  it('accumulates events via onAny and updates lastEvent', async () => {
    // Events fired through onAny are appended to the accumulated array.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('connect'))
    act(() => triggerAny('invoice.paid', { id: 'inv_1' }))
    expect(result.current.events).toHaveLength(1)
    expect(result.current.lastEvent?.type).toBe('invoice.paid')
    expect(result.current.lastEvent?.data).toEqual({ id: 'inv_1' })
  })

  it('forwards emit(event, data) to the underlying socket', async () => {
    // Full-duplex emit must delegate to socket.emit.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('connect'))
    act(() => result.current.emit('chat', { text: 'hello' }))
    expect(mockSocket.emit).toHaveBeenCalledWith('chat', { text: 'hello' })
  })

  it('sets error state when the error event fires with an Error instance', async () => {
    // Connection errors must surface via the error property.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('error', new Error('socket failure')))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('socket failure')
  })

  it('wraps non-Error values in an Error when the error event fires', async () => {
    // Non-Error thrown values must be wrapped so the error property is always an Error.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('error', 'string error'))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('string error')
  })

  it('calls socket.disconnect() when the component unmounts', async () => {
    // Cleanup must disconnect the socket to prevent memory / connection leaks.
    const { unmount } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('connect'))
    unmount()
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1)
  })

  it('passes auth credentials through to io() options', async () => {
    // Auth must reach the socket.io-client handshake options unchanged.
    renderHook(() => useRealtimeWs({ url: 'ws://localhost', auth: { ticket: 'xyz' } }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    expect(mockIo).toHaveBeenCalledWith(
      'ws://localhost',
      expect.objectContaining({ auth: { ticket: 'xyz' } }),
    )
  })

  it('does nothing when enabled is false', async () => {
    // A disabled hook must not call io() or alter any state.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost', enabled: false }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(mockIo).not.toHaveBeenCalled()
    expect(result.current.connected).toBe(false)
  })

  it('clears error state on successful connect after a previous error', async () => {
    // After reconnect, a successful connect must clear the error field.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => trigger('error', new Error('temporary')))
    expect(result.current.error).toBeDefined()
    act(() => trigger('connect'))
    expect(result.current.error).toBeUndefined()
  })

  it('caps the events array at 100 entries', async () => {
    // Pushing more than 100 events keeps only the last 100 (slice(-100)).
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => {
      for (let i = 0; i < 110; i++) {
        triggerAny(`event-${i}`, { i })
      }
    })
    expect(result.current.events).toHaveLength(100)
  })

  it('sets error when io() throws an Error instance during connect', async () => {
    // If io() throws synchronously the catch block must surface an Error-typed error.
    mockIo.mockImplementationOnce(() => {
      throw new Error('io() constructor failed')
    })
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('io() constructor failed')
  })

  it('wraps a non-Error throw in the catch block into a new Error', async () => {
    // When io() throws a non-Error value the catch must wrap it in new Error(String(e)).
    // Using `unknown` avoids triggering the only-throw-error lint rule.
    const nonErrorValue: unknown = 'string failure'
    mockIo.mockImplementationOnce(() => {
      throw nonErrorValue
    })
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('string failure')
  })

  it('reconnect() re-establishes the socket connection', async () => {
    // Calling reconnect() must invoke io() a second time, opening a fresh socket.
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.reconnect()
    })
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(2))
  })

  it('disconnects and unlistens the previous socket before reconnect (no leak)', async () => {
    // reconnect() must tear down the old socket (removeAllListeners + disconnect) before
    // creating a new one, so exactly one live socket remains and the old one cannot
    // keep mutating state via stale listeners.
    const socketA = makeFreshSocket()
    const socketB = makeFreshSocket()
    mockIo.mockReturnValueOnce(socketA).mockReturnValueOnce(socketB)

    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.reconnect()
    })
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(2))

    // Old socket torn down exactly once; the new socket stays live.
    expect(socketA.removeAllListeners).toHaveBeenCalledTimes(1)
    expect(socketA.disconnect).toHaveBeenCalledTimes(1)
    expect(socketB.disconnect).not.toHaveBeenCalled()
  })

  it('does not disconnect anything on the very first connect (no prior socket)', async () => {
    // The dispose-before-connect guard must skip teardown when no socket exists yet.
    const socketA = makeFreshSocket()
    mockIo.mockReturnValueOnce(socketA)
    renderHook(() => useRealtimeWs({ url: 'ws://localhost' }))
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    expect(socketA.disconnect).not.toHaveBeenCalled()
    expect(socketA.removeAllListeners).not.toHaveBeenCalled()
  })

  it('does not call io() when reconnect() is invoked while disabled', async () => {
    // The enabled guard inside connect() must prevent io() even when triggered via reconnect().
    const { result } = renderHook(() => useRealtimeWs({ url: 'ws://localhost', enabled: false }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const callsBefore = mockIo.mock.calls.length
    act(() => {
      result.current.reconnect()
    })
    expect(mockIo.mock.calls.length).toBe(callsBefore)
  })
})
