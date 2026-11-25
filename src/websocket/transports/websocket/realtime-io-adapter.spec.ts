/**
 * @fileoverview Unit tests for RealtimeIoAdapter — options application and Redis adapter install.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeIoAdapter, isRealtimeIoServer } from './realtime-io-adapter'

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

/** The namespace methods the adapter calls on a server it created, to give a socket its own state. */
const namespaces = () => ({ of: jest.fn().mockReturnValue({ on: jest.fn() }), on: jest.fn() })

/** Minimal server mock with the methods the adapter calls on a server it created. */
function makeServer() {
  return { adapter: jest.fn(), close: jest.fn().mockResolvedValue(undefined), ...namespaces() }
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

    expect(pubClient.duplicate).toHaveBeenCalledWith({ disconnectTimeout: 1 })
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

  describe('when the Redis adapter cannot be installed, the boot fails', () => {
    const ADVICE = 'Install @socket.io/redis-adapter and pass an ioredis client as pubClient.'

    function boot(pubClient: unknown): unknown {
      superSpy.mockReturnValue(makeServer())
      return new RealtimeIoAdapter(
        makeApp({ websocket: { redisAdapter: { pubClient } } }) as never,
      ).createIOServer(3000)
    }

    it('throws the typed error, with the cause and the remedy, when the adapter constructor throws', () => {
      // A misconfiguration known at boot must not leave a server that drops cross-node messages.
      const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
        createAdapter: jest.Mock
      }
      const cause = new Error('adapter constructor exploded')
      createAdapter.mockImplementationOnce(() => {
        throw cause
      })

      let thrown: Error | undefined
      try {
        boot({ duplicate: jest.fn().mockReturnValue({}) })
      } catch (err) {
        thrown = err as Error
      }

      expect(thrown?.message).toBe(
        '[RealtimeIoAdapter] REALTIME_REDIS_ADAPTER_FAILED: websocket.redisAdapter is set but the ' +
          'Socket.IO Redis adapter could not be installed. ' +
          ADVICE,
      )
      expect(thrown?.cause).toBe(cause)
      expect((thrown as { code?: unknown }).code).toBe('REALTIME_REDIS_ADAPTER_FAILED')
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Redis adapter registered'))
    })

    it('throws when the client has no duplicate()', () => {
      // The subscriber is a duplicate of the caller's client, so a client without one cannot back it.
      let thrown: Error | undefined
      try {
        boot({})
      } catch (err) {
        thrown = err as Error
      }
      expect(thrown?.message).toMatch(
        /^\[RealtimeIoAdapter\] REALTIME_REDIS_ADAPTER_FAILED: .*could not be installed\. Install @socket\.io\/redis-adapter/,
      )
      expect(thrown?.cause).toBeInstanceOf(Error)
      expect((thrown?.cause as Error).message).toMatch(/duplicate/)
    })

    it('closes the server it created, so a failed boot leaves no listener behind', () => {
      // With an explicit port the server listens by itself; a boot that failed must not keep the process alive.
      const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
        createAdapter: jest.Mock
      }
      createAdapter.mockImplementationOnce(() => {
        throw new Error('adapter constructor exploded')
      })
      const server = { ...makeServer() }
      superSpy.mockReturnValue(server)

      expect(() =>
        new RealtimeIoAdapter(
          makeApp({
            websocket: {
              redisAdapter: { pubClient: { duplicate: jest.fn().mockReturnValue({}) } },
            },
          }) as never,
        ).createIOServer(3000),
      ).toThrow('REALTIME_REDIS_ADAPTER_FAILED')

      expect(server.close).toHaveBeenCalledTimes(1)
    })

    it('still throws the install error when closing the server fails', async () => {
      const server = {
        adapter: jest.fn(),
        close: jest.fn().mockRejectedValue(new Error('close failed')),
        ...namespaces(),
      }
      superSpy.mockReturnValue(server)
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)

      expect(() =>
        new RealtimeIoAdapter(
          makeApp({ websocket: { redisAdapter: { pubClient: {} } } }) as never,
        ).createIOServer(3000),
      ).toThrow('REALTIME_REDIS_ADAPTER_FAILED')
      await new Promise((resolve) => setImmediate(resolve))

      process.off('unhandledRejection', unhandled)
      expect(unhandled).not.toHaveBeenCalled()
    })

    it('does not close the server when the install succeeds', () => {
      const server = { adapter: jest.fn(), close: jest.fn(), ...namespaces() }
      superSpy.mockReturnValue(server)

      new RealtimeIoAdapter(
        makeApp({
          websocket: { redisAdapter: { pubClient: { duplicate: jest.fn().mockReturnValue({}) } } },
        }) as never,
      ).createIOServer(3000)

      expect(server.close).not.toHaveBeenCalled()
    })

    it('keeps a rejection that is not an Error as the cause, and out of the message', () => {
      const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
        createAdapter: jest.Mock
      }
      createAdapter.mockImplementationOnce(() => {
        throw 'plain string'
      })
      let thrown: Error | undefined
      try {
        boot({ duplicate: jest.fn().mockReturnValue({}) })
      } catch (err) {
        thrown = err as Error
      }
      expect(thrown?.message).toContain('could not be installed. ' + ADVICE)
      expect(thrown?.message).not.toContain('plain string')
      expect(thrown?.cause).toBe('plain string')
    })

    it('throws when the peer package cannot be loaded', () => {
      // The peer is optional; a configuration that uses it without installing it is the failure.
      // Reading the export is the part of the load that can throw once the module is mocked.
      const peer = jest.requireMock('@socket.io/redis-adapter') as object
      const original = Object.getOwnPropertyDescriptor(peer, 'createAdapter')
      Object.defineProperty(peer, 'createAdapter', {
        configurable: true,
        get: () => {
          throw new Error("Cannot find module '@socket.io/redis-adapter'")
        },
      })
      try {
        let thrown: Error | undefined
        try {
          boot({ duplicate: jest.fn() })
        } catch (err) {
          thrown = err as Error
        }
        expect(thrown?.message).toMatch(
          /REALTIME_REDIS_ADAPTER_FAILED: .*could not be installed\. Install @socket\.io\/redis-adapter/,
        )
        expect((thrown?.cause as Error).message).toBe(
          "Cannot find module '@socket.io/redis-adapter'",
        )
      } finally {
        Object.defineProperty(peer, 'createAdapter', original as PropertyDescriptor)
      }
    })
  })

  describe('isRealtimeIoServer', () => {
    it('is true for a server created by createIOServer', () => {
      // The gateway tells the adapter's servers from any other adapter's by this answer.
      const adapter = new RealtimeIoAdapter(makeApp() as never)
      expect(isRealtimeIoServer(adapter.createIOServer(3000))).toBe(true)
    })

    it('is false for a server this adapter did not create', () => {
      // Nest's default IoAdapter builds its own server, which ignores every websocket.* option.
      expect(isRealtimeIoServer(makeServer())).toBe(false)
    })

    it.each([[null], [undefined], ['server'], [42]])('is false for %p', (value) => {
      expect(isRealtimeIoServer(value)).toBe(false)
    })
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

    it('marks the namespace it returns as one of its own', () => {
      // With a namespace the gateway receives the namespace, not the root server.
      const nsServer = { marker: 'ns' }
      createSuperSpy = jest
        .spyOn(IoAdapter.prototype, 'create')
        .mockReturnValue(makeRootServer(nsServer) as never)

      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)

      expect(isRealtimeIoServer(adapter.create(3000))).toBe(true)
    })

    it('hands the root server, not its own namespace, to the stock adapter when Nest passes that namespace back', () => {
      // Nest gives a gateway of another namespace the server it stored, which is the namespace this adapter returned;
      // a namespace takes no `.of`, so passed on as it is the stock adapter would build a second server.
      const hostNamespace = { marker: 'host' }
      const root = makeRootServer({ marker: 'ns' })
      createSuperSpy = jest
        .spyOn(IoAdapter.prototype, 'create')
        .mockReturnValueOnce(root as never)
        .mockReturnValueOnce(hostNamespace as never)
      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)
      const ours = adapter.create(3000)

      const result = adapter.create(3000, { namespace: '/y', server: ours } as never)

      expect(createSuperSpy).toHaveBeenLastCalledWith(3000, { namespace: '/y', server: root })
      expect(result).toBe(hostNamespace)
    })

    it('passes a server it did not create to the stock adapter as it is', () => {
      // Only a namespace this adapter returned is swapped for its root; any other server is Nest's or the host's.
      const given = { of: jest.fn() }
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue({} as never)
      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)

      adapter.create(3000, { namespace: '/y', server: given } as never)

      expect(createSuperSpy).toHaveBeenCalledWith(3000, { namespace: '/y', server: given })
    })

    it('hands the stock adapter the very options object it was given when none is a namespace of its own', () => {
      // A copy would drop what the host put on the object by reference, so only a root swap may build a new one.
      const given = { of: jest.fn() }
      const options = { namespace: '/y', server: given }
      createSuperSpy = jest.spyOn(IoAdapter.prototype, 'create').mockReturnValue({} as never)
      const adapter = new RealtimeIoAdapter(makeApp({ websocket: { namespace: '/rt' } }) as never)

      adapter.create(3000, options as never)

      expect(createSuperSpy.mock.calls[0]?.[1]).toBe(options)
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
