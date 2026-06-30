/**
 * Helpers for mocking `socket.io-client` in tests of the WebSocket hook.
 *
 * Because `useRealtimeWs` loads socket.io-client via a dynamic `import()`, tests
 * must use `jest.doMock` (not `jest.mock`) together with `jest.resetModules()` to
 * ensure the mock is in place before the dynamic import resolves.
 *
 * Usage:
 *   jest.resetModules()
 *   const { socket, trigger, triggerAny } = mockSocketIoClient()
 *   const { useRealtimeWs } = await import('./use-realtime-ws')
 */

/** Generic event handler type. */
type Handler = (...args: unknown[]) => void

/** Return shape of {@link mockSocketIoClient}. */
export interface SocketIoClientMockResult {
  /** The fake socket object passed back by the mocked `io()` factory. */
  socket: {
    on: (event: string, h: Handler) => void
    onAny: (h: (event: string, payload: unknown) => void) => void
    emit: jest.Mock
    disconnect: jest.Mock
  }
  /** The mocked `io` factory. */
  io: jest.Mock
  /**
   * Fire a named event on the socket (e.g. `'connect'`, `'disconnect'`, `'error'`).
   *
   * @param event - Event name registered via `socket.on(...)`.
   * @param args  - Arguments forwarded to the handler.
   */
  trigger: (event: string, ...args: unknown[]) => void
  /**
   * Fire an arbitrary event through the `onAny` catch-all handler.
   *
   * @param event   - Arbitrary event name.
   * @param payload - Payload forwarded to the handler.
   */
  triggerAny: (event: string, payload: unknown) => void
}

/**
 * Installs a `jest.doMock` for `socket.io-client` and returns helpers
 * to control the fake socket during a test.
 *
 * Must be called after `jest.resetModules()` and before the hook module is
 * dynamically imported, so the mock intercepts the `await import(...)` call.
 */
export function mockSocketIoClient(): SocketIoClientMockResult {
  const handlers = new Map<string, Set<Handler>>()
  let anyHandler: ((event: string, payload: unknown) => void) | undefined

  const socket = {
    on: (event: string, h: Handler) => {
      const existing = handlers.get(event)
      if (existing) {
        existing.add(h)
      } else {
        handlers.set(event, new Set([h]))
      }
    },
    onAny: (h: (event: string, payload: unknown) => void) => {
      anyHandler = h
    },
    emit: jest.fn<void, [string, unknown]>(),
    disconnect: jest.fn<void, []>(),
  }

  const io = jest.fn(() => socket)

  jest.doMock('socket.io-client', () => ({ io }))

  return {
    socket,
    io,
    trigger: (event: string, ...args: unknown[]) =>
      handlers.get(event)?.forEach((h) => h(...args)),
    triggerAny: (event: string, payload: unknown) => anyHandler?.(event, payload),
  }
}
