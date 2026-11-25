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

  describe('the library namespace', () => {
    const boot = (namespace: string | undefined, port: number, opts?: object): jest.Mock => {
      const server = makeServer()
      superSpy.mockImplementation(() => server)
      const websocket = namespace === undefined ? {} : { namespace }
      new RealtimeIoAdapter(makeApp({ websocket }) as never).createIOServer(port, opts as never)
      return server.of
    }

    // Scenario: the server of the application's port and default path. Expected: the library's namespace is opened on it,
    // under the name Socket.IO gives it.
    it.each([
      ['/rt', '/rt'],
      ['rt', '/rt'],
    ])('opens %p as %p on the library server', (configured, opened) => {
      expect(boot(configured, 0).mock.calls).toStrictEqual([['/'], [opened]])
    })

    // Scenario: no namespace, the root, or a server of another port or path. Expected: only '/' is read for the guards.
    it.each([
      ['unset', undefined, 0, undefined],
      ['empty', '', 0, undefined],
      ['the root', '/', 0, undefined],
      ['on another port', '/rt', 3001, undefined],
      ['on another path', '/rt', 0, { path: '/own' }],
    ])('opens nothing more when it is %s', (_case, namespace, port, opts) => {
      expect(boot(namespace, port, opts).mock.calls).toStrictEqual([['/']])
    })
  })

  describe('bindClientConnect', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => warnSpy.mockRestore())

    /** An adapter with a server of `port`, and what binding a gateway to each of `targets` warns. */
    function bind(
      namespace: string | undefined,
      port: number,
      targets: (server: object) => object[],
    ): { warnings: unknown[]; handlers: jest.Mock[] } {
      const server = makeServer()
      superSpy.mockImplementation(() => server)
      const websocket = namespace === undefined ? {} : { namespace }
      const adapter = new RealtimeIoAdapter(makeApp({ websocket }) as never)
      adapter.createIOServer(port)
      const handlers = targets(server).map((target) => {
        const on = jest.fn()
        adapter.bindClientConnect(Object.assign(target, { on }), () => undefined)
        return on
      })
      return {
        warnings: warnSpy.mock.calls.map(([line]) => (line as { event: string }).event),
        handlers,
      }
    }

    // Scenario: a gateway on the server itself, or on its '/' namespace, with the library elsewhere. Expected: one warning
    // for any number of them, and each handler is bound as IoAdapter binds it.
    it.each([
      ['the server', (server: object) => [server, server]],
      ["its '/' namespace", (server: object) => [{ name: '/', server }]],
    ])('warns once about a gateway on %s', (_case, targets) => {
      const { warnings, handlers } = bind('/rt', 0, targets)

      expect(warnings).toStrictEqual(['REALTIME_GATEWAY_OUTSIDE_NAMESPACE'])
      for (const on of handlers) expect(on).toHaveBeenCalledWith('connection', expect.any(Function))
    })

    // Scenario: the warning's text. Expected: what does not reach the clients of '/', and the two ways out.
    it("says what the library does not do for the clients of '/', and what to change", () => {
      bind('/rt', 0, (server) => [server])

      expect((warnSpy.mock.calls[0]?.[0] as { message: string }).message).toBe(
        "A gateway of this application is on '/' while websocket.namespace puts the library elsewhere: the library's " +
          "authenticator does not run for the clients of '/', and the library's rooms are not reachable from it. Give the " +
          'gateway the namespace of websocket.namespace, or authenticate its clients in the gateway itself.',
      )
    })

    // Scenario: a gateway on another namespace, on another server, or no namespace configured. Expected: no warning.
    it.each([
      ['a namespace of the server', '/rt', 0, (server: object) => [{ name: '/rt', server }]],
      ['a server of another port', '/rt', 3001, (server: object) => [server]],
      ['another server', '/rt', 0, () => [{}, { name: '/', server: {} }]],
      ['the server, with no namespace configured', undefined, 0, (server: object) => [server]],
      ["the server, with '/' configured", '/', 0, (server: object) => [server]],
    ])('says nothing about %s', (_case, namespace, port, targets) => {
      expect(bind(namespace, port, targets).warnings).toStrictEqual([])
    })
  })

  describe('create', () => {
    // Scenario: the adapter's `create`. Expected: it is the stock one, which returns the root server, so Nest stores the
    // root and every gateway without a namespace binds to `/`; the library's gateway alone is bound to its namespace.
    it('declares no create of its own', () => {
      expect(Object.prototype.hasOwnProperty.call(RealtimeIoAdapter.prototype, 'create')).toBe(
        false,
      )
    })
  })
})
