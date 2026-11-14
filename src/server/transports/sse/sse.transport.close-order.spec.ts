/**
 * @fileoverview Closing an SSE connection cuts the client first, and no consumer hook can keep it, or
 * the application, from closing.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import { Subject } from 'rxjs'
import { build } from '../../../../test/fixtures/sse/transport-harness'
import type { SseTransport } from './sse.transport'

type Built = ReturnType<typeof build>

/** Register a connection whose stream-closing signal records into `calls`. */
async function register(
  transport: SseTransport,
  id: string,
  calls: string[],
  userId = 'u1',
): Promise<void> {
  const close$ = new Subject<void>()
  close$.subscribe({
    next: () => calls.push(`${id}:close.next`),
    complete: () => calls.push(`${id}:close.complete`),
  })
  await transport.registerConnection({
    connectionId: id,
    auth: { userId },
    subject: new Subject<MessageEvent>(),
    close$,
    ip: '127.0.0.1',
    userAgent: undefined,
  })
}

const never = (): Promise<void> => new Promise<void>(() => undefined)

describe('SseTransport: closing a connection', () => {
  let error: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // The order is the guarantee: the client is cut before any consumer code runs, and the connection
  // is already gone from every registry when it does.
  it('removes the connection and closes its stream before onDisconnect is called', async () => {
    const calls: string[] = []
    let built!: Built
    built = build({
      hooks: {
        onDisconnect: () => {
          calls.push(
            `hook(connection ${built.connections.get('c1') ? 'present' : 'gone'}, rooms ${built.rooms.roomsOf('c1').length})`,
          )
        },
      },
    })
    await register(built.transport, 'c1', calls)

    await built.transport.disconnectLocal('c1', 'REASON')

    expect(calls).toStrictEqual([
      'c1:close.next',
      'c1:close.complete',
      'hook(connection gone, rooms 0)',
    ])
  })

  it('hands the reason to onDisconnect', async () => {
    const reasons: Array<string | undefined> = []
    const built = build({ hooks: { onDisconnect: (meta) => void reasons.push(meta.reason) } })
    await register(built.transport, 'c1', [])

    await built.transport.disconnectLocal('c1', 'REASON')

    expect(reasons).toStrictEqual(['REASON'])
  })

  it('runs onDisconnect once however the connection is closed', async () => {
    const onDisconnect = jest.fn()
    const built = build({ hooks: { onDisconnect } })
    await register(built.transport, 'c1', [])

    await built.transport.disconnectLocal('c1')
    await built.transport.unregisterConnection('c1')
    await built.transport.disconnectLocal('c1')

    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('gives up on an onDisconnect that never settles after hookTimeoutMs, with the stream already closed', async () => {
    const calls: string[] = []
    const built = build({ hookTimeoutMs: 50, hooks: { onDisconnect: never } })
    await register(built.transport, 'c1', calls)

    const closing = built.transport.disconnectLocal('c1')
    await jest.advanceTimersByTimeAsync(0)
    expect(calls).toStrictEqual(['c1:close.next', 'c1:close.complete'])
    await jest.advanceTimersByTimeAsync(50)
    await closing

    expect(error).toHaveBeenCalledWith('onDisconnect hook failed: did not settle within 50 ms')
  })

  it('bounds a revocation through disconnect() the same way', async () => {
    const built = build({ hookTimeoutMs: 50, hooks: { onDisconnect: never } })
    await register(built.transport, 'c1', [])

    const revoking = built.transport.disconnect('c1', 'REASON')
    await jest.advanceTimersByTimeAsync(50)

    await expect(revoking).resolves.toBeUndefined()
  })

  it('uses 5,000 ms when hookTimeoutMs is not set', async () => {
    const built = build({ hooks: { onDisconnect: never } })
    await register(built.transport, 'c1', [])

    const closing = built.transport.disconnectLocal('c1')
    await jest.advanceTimersByTimeAsync(4_999)
    expect(error).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    await closing

    expect(error).toHaveBeenCalledWith('onDisconnect hook failed: did not settle within 5000 ms')
  })

  // A hook that never settles must not hold a user's next connection back from being admitted.
  it('does not hold the admission of a new connection behind the hook of the one it evicts', async () => {
    const built = build({
      sse: { maxConnectionsPerUser: 1 },
      hookTimeoutMs: 100,
      hooks: { onDisconnect: never },
    })
    const calls: string[] = []
    await register(built.transport, 'old', calls)

    const admitting = register(built.transport, 'new', calls)
    await jest.advanceTimersByTimeAsync(100)
    await admitting

    expect(calls).toContain('old:close.complete')
    expect(built.connections.get('old')).toBeUndefined()
    expect(built.connections.get('new')).toBeDefined()
  })
})

describe('SseTransport: shutdown', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  // 20 connections with a one-second hook each: closed together, they take one second, not twenty.
  it('closes the connections together, so the hooks overlap', async () => {
    const built = build({
      hooks: { onDisconnect: () => new Promise<void>((resolve) => setTimeout(resolve, 1_000)) },
    })
    for (let i = 0; i < 20; i++) await register(built.transport, `c${i}`, [], `u${i}`)
    let done = false

    const shutting = built.transport.beforeApplicationShutdown().then(() => (done = true))
    await jest.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await shutting

    expect(done).toBe(true)
    expect(built.connections.allByTransport('sse')).toHaveLength(0)
  })

  it('takes about one hookTimeoutMs however many connections have a hook that never settles', async () => {
    const calls: string[] = []
    const built = build({ hookTimeoutMs: 300, hooks: { onDisconnect: never } })
    for (let i = 0; i < 20; i++) await register(built.transport, `c${i}`, calls, `u${i}`)

    const shutting = built.transport.beforeApplicationShutdown()
    await jest.advanceTimersByTimeAsync(300)
    await shutting

    expect(calls.filter((call) => call.endsWith(':close.complete'))).toHaveLength(20)
  })

  it('leaves nothing for onApplicationShutdown to do after beforeApplicationShutdown', async () => {
    const onDisconnect = jest.fn()
    const built = build({ hooks: { onDisconnect } })
    await register(built.transport, 'c1', [])

    await built.transport.beforeApplicationShutdown()
    await built.transport.onApplicationShutdown()

    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })
})
