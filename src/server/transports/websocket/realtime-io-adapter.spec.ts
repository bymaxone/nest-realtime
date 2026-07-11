/**
 * @fileoverview Unit tests for RealtimeIoAdapter — options application and Redis adapter install.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN } from '../../constants/injection-tokens.constants'
import type { BymaxRealtimeModuleOptions } from '../../interfaces/realtime-module-options.interface'
import { RealtimeIoAdapter } from './realtime-io-adapter'

// Mock @socket.io/redis-adapter so the lazy require inside installRedisAdapter
// is controllable in tests without needing the actual package wired to Redis.
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn().mockReturnValue({}) }), {
  virtual: true,
})

/** Mock INestApplicationContext returning the provided options. */
function makeApp(options: Partial<BymaxRealtimeModuleOptions> = {}) {
  const mockMap = new Map<symbol, unknown>([[REALTIME_OPTIONS_TOKEN, options]])
  return {
    get: jest.fn((token: symbol) => mockMap.get(token)),
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
    superSpy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockImplementation(() => makeServer())
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

  it('logs the Redis adapter registered message on successful install', () => {
    const pubClient = { duplicate: jest.fn().mockReturnValue({}) }
    const server = makeServer()
    superSpy.mockReturnValue(server)

    const adapter = new RealtimeIoAdapter(
      makeApp({ websocket: { redisAdapter: { pubClient } } }) as never,
    )
    adapter.createIOServer(3000)

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Redis adapter registered'))
  })

  it('tolerates a createAdapter failure — logs error, does NOT throw', () => {
    // Broken adapter install degrades to single-instance; no uncaught exception.
    const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
      createAdapter: jest.Mock
    }
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

  it('error log contains "Falling back" when the Redis adapter installation throws', () => {
    // Kills StringLiteral mutation that blanks out the fallback message.
    const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
      createAdapter: jest.Mock
    }
    createAdapter.mockImplementationOnce(() => {
      throw new Error('Redis down')
    })

    const pubClient = { duplicate: jest.fn().mockReturnValue({}) }
    const server = makeServer()
    superSpy.mockReturnValue(server)

    const adapter = new RealtimeIoAdapter(
      makeApp({ websocket: { redisAdapter: { pubClient } } }) as never,
    )
    adapter.createIOServer(3000)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Falling back'))
  })

  describe('create — namespace binding', () => {
    let createSuperSpy: jest.SpyInstance

    afterEach(() => {
      createSuperSpy?.mockRestore()
    })

    /** Root server mock exposing `.of` so namespace binding can be observed. */
    function makeRootServer(namespace: unknown) {
      const of = jest.fn().mockReturnValue(namespace)
      return { of }
    }

    it('returns server.of(namespace) when a non-root namespace is configured', () => {
      // A configured namespace binds the gateway to server.of(ns).
      const nsServer = { marker: 'ns' }
      const root = makeRootServer(nsServer)
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue(root as never)

      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)
      const result = adapter.create(3000)

      expect(root.of).toHaveBeenCalledWith('/rt')
      expect(result).toBe(nsServer)
    })

    it('returns the root server unchanged when namespace is unset', () => {
      // No namespace → the root server is returned as-is, of() is never called.
      const root = makeRootServer({})
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue(root as never)

      const adapter = new RealtimeIoAdapter(makeApp() as never)
      const result = adapter.create(3000)

      expect(root.of).not.toHaveBeenCalled()
      expect(result).toBe(root)
    })

    it('returns the root server unchanged when namespace is the root "/"', () => {
      // "/" is the root and must NOT trigger a namespace split.
      const root = makeRootServer({})
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue(root as never)

      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/' } }) as never)
      const result = adapter.create(3000)

      expect(root.of).not.toHaveBeenCalled()
      expect(result).toBe(root)
    })

    it('returns the server unchanged when it exposes no of() function', () => {
      // Defensive: a server without .of (unexpected) is returned as-is.
      const root = { adapter: jest.fn() }
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue(root as never)

      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)
      const result = adapter.create(3000)

      expect(result).toBe(root)
    })

    it('forwards port and options to super.create', () => {
      // The override must not swallow the arguments NestJS passes through.
      const root = makeRootServer({})
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue(root as never)

      const adapter = new RealtimeIoAdapter(makeApp() as never)
      const opts = { namespace: '/', cors: false } as never
      adapter.create(3000, opts)

      expect(createSuperSpy).toHaveBeenCalledWith(3000, opts)
    })
  })
})
