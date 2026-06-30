/**
 * @fileoverview Unit tests for RealtimeIoAdapter — options application and Redis adapter install.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { RealtimeIoAdapter } from './realtime-io-adapter'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'

// Mock @socket.io/redis-adapter so the lazy require inside installRedisAdapter
// is controllable in tests without needing the actual package wired to Redis.
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn().mockReturnValue({}) }), {
  virtual: true,
})

/** Mock INestApplicationContext returning the provided options. */
function makeApp(options: Partial<BymaxRealtimeModuleOptions> = {}) {
  return {
    get: jest.fn((token: symbol) => {
      if (token === REALTIME_OPTIONS_TOKEN) return options
      return undefined
    }),
  }
}

/** Minimal server mock with an `adapter` method. */
function makeServer() {
  return { adapter: jest.fn() }
}

describe('RealtimeIoAdapter', () => {
  let superSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    superSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockImplementation(() => makeServer())
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    superSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('passes cors to super.createIOServer when set', () => {
    // cors option is forwarded from websocket config.
    const adapter = new RealtimeIoAdapter(
      makeApp({ websocket: { cors: { origin: 'https://example.com' } } }) as never,
    )
    adapter.createIOServer(3000)
    expect(superSpy).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({ cors: { origin: 'https://example.com' } }),
    )
  })

  it('applies default pingInterval (25000) when unset', () => {
    // Default pingInterval is 25 000 ms when the option is absent.
    const adapter = new RealtimeIoAdapter(makeApp() as never)
    adapter.createIOServer(3000)
    expect(superSpy).toHaveBeenCalledWith(3000, expect.objectContaining({ pingInterval: 25_000 }))
  })

  it('applies default pingTimeout (20000) when unset', () => {
    // Default pingTimeout is 20 000 ms when the option is absent.
    const adapter = new RealtimeIoAdapter(makeApp() as never)
    adapter.createIOServer(3000)
    expect(superSpy).toHaveBeenCalledWith(3000, expect.objectContaining({ pingTimeout: 20_000 }))
  })

  it('falls back to opts?.cors when wsOpts.cors is absent', () => {
    // The cors fallback from opts is used when websocket.cors is not set.
    const adapter = new RealtimeIoAdapter(makeApp() as never)
    adapter.createIOServer(3000, { cors: { origin: 'http://fallback.example' } } as never)
    expect(superSpy).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({ cors: { origin: 'http://fallback.example' } }),
    )
  })

  it('applies default maxHttpBufferSize (1 000 000) when unset', () => {
    // Default maxHttpBufferSize is 1 MB when the option is absent.
    const adapter = new RealtimeIoAdapter(makeApp() as never)
    adapter.createIOServer(3000)
    expect(superSpy).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({ maxHttpBufferSize: 1_000_000 }),
    )
  })

  it('applies custom pingIntervalMs / pingTimeoutMs / maxHttpBufferSize', () => {
    // Custom values override the defaults.
    const adapter = new RealtimeIoAdapter(
      makeApp({
        websocket: { pingIntervalMs: 10_000, pingTimeoutMs: 8_000, maxHttpBufferSize: 2_000_000 },
      }) as never,
    )
    adapter.createIOServer(3000)
    expect(superSpy).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({
        pingInterval: 10_000,
        pingTimeout: 8_000,
        maxHttpBufferSize: 2_000_000,
      }),
    )
  })

  it('does NOT install the Redis adapter when pubClient is absent', () => {
    // No adapter call when redisAdapter is not configured.
    const server = makeServer()
    superSpy.mockReturnValue(server)
    const adapter = new RealtimeIoAdapter(makeApp() as never)
    adapter.createIOServer(3000)
    expect(server.adapter).not.toHaveBeenCalled()
  })

  it('installs the Redis adapter and calls pubClient.duplicate when pubClient is present', () => {
    // The adapter is wired with pub + pub.duplicate() as the sub client.
    const sub = {}
    const pubClient = { duplicate: jest.fn().mockReturnValue(sub) }
    const server = makeServer()
    superSpy.mockReturnValue(server)

    const adapter = new RealtimeIoAdapter(
      makeApp({ websocket: { redisAdapter: { pubClient } } }) as never,
    )
    adapter.createIOServer(3000)

    expect(pubClient.duplicate).toHaveBeenCalled()
    expect(server.adapter).toHaveBeenCalled()
  })

  it('tolerates a createAdapter failure — logs error, does NOT throw', () => {
    // Broken adapter install degrades to single-instance; no uncaught exception.
    const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as { createAdapter: jest.Mock }
    createAdapter.mockImplementationOnce(() => {
      throw new Error('Redis not available')
    })

    const pubClient = { duplicate: jest.fn().mockReturnValue({}) }
    const server = makeServer()
    superSpy.mockReturnValue(server)

    const adapter = new RealtimeIoAdapter(
      makeApp({ websocket: { redisAdapter: { pubClient } } }) as never,
    )
    expect(() => adapter.createIOServer(3000)).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Redis not available'))
  })
})
