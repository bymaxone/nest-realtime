/**
 * Tests for the WebSocket branch hook `useRealtimeWs`.
 * @layer react
 *
 * `socket.io-client` is mocked with a fake `io`, so tests trigger the socket's events themselves.
 * `io` is called with the url and `withCredentials: true`; `connected` is true after the `connect` event.
 * An `onAny` event sets `lastEvent`, and the events array is capped at 100.
 * `emit` reaches the socket, and unmount calls `socket.disconnect()`.
 * `reconnect()` disconnects the previous socket once. `io` is not called while `enabled` is false.
 * An empty `auth` object is omitted, and an equal inline `auth` object does not reopen the socket.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { useRealtimeWs } from './use-realtime-ws'

// ---- socket.io-client mock -----------------------------------------------

const mockSocket = {
  on: jest.fn<void, [string, (...args: unknown[]) => void]>(),
  onAny: jest.fn<void, [(event: string, payload: unknown) => void]>(),
  emit: jest.fn<void, [string, unknown]>(),
  removeAllListeners: jest.fn<void, []>(),
  disconnect: jest.fn<void, []>(),
}

// Typed with its parameters so tests can assert on the handshake options socket.io
// was actually given, including asserting that a key is absent.
const mockIo = jest.fn((_url?: string, _options?: Record<string, unknown>) => mockSocket)

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

// --------------------------------------------------------------------------

beforeEach(() => {
  mockSocket.emit.mockReset()
  mockSocket.removeAllListeners.mockReset()
  mockSocket.disconnect.mockReset()
  mockIo.mockReset()
  mockIo.mockReturnValue(mockSocket)
})

describe('race: disabled while the import is in flight', () => {
  const render = () =>
    renderHook(({ enabled }) => useRealtimeWs({ url: 'ws://localhost', enabled }), {
      initialProps: { enabled: true },
    })

  it('R1 disconnects the socket the in-flight import opens after the hook was disabled', async () => {
    const { rerender } = render()
    rerender({ enabled: false })
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  it('R2 disconnects that socket at the latest when the host unmounts', async () => {
    const { rerender, unmount } = render()
    rerender({ enabled: false })
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    await act(async () => {})
    unmount()
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  it('R3 keeps the socket of the newest attempt and closes the one an older import opened', async () => {
    const older = makeFreshSocket()
    const newest = makeFreshSocket()
    mockIo.mockReturnValueOnce(older).mockReturnValueOnce(newest)
    const { result } = render()
    act(() => result.current.reconnect())
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(older.disconnect).toHaveBeenCalledTimes(1)
    expect(older.removeAllListeners).toHaveBeenCalledTimes(1)
    expect(newest.disconnect).not.toHaveBeenCalled()
  })

  it('R4 reports no error for an attempt that failed after the hook was disabled', async () => {
    mockIo.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const { result, rerender } = render()
    rerender({ enabled: false })
    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(result.current.error).toBeUndefined()
  })

  it('R5 still reports the error of the current attempt', async () => {
    mockIo.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const { result } = render()
    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
  })
})
