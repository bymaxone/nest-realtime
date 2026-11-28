/**
 * @fileoverview End-to-end: one module object, several applications, and the replacements a test makes.
 * @layer e2e
 *
 * Constraint under test: Nest reads the namespace from the gateway's class when it connects the gateway, so one module object
 * may take another `websocket.namespace` once the gateway that asked for the earlier one is connected or destroyed, and is
 * refused while that gateway still waits.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Logger, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeGateway } from '../../src/websocket/transports/websocket/realtime.gateway'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

describe('one module object and websocket.namespace (e2e)', () => {
  const apps: INestApplication[] = []
  const clients: ClientSocket[] = []
  let authenticated = 0

  beforeEach(() => {
    authenticated = 0
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    for (const app of apps.splice(0)) await app.close()
    jest.restoreAllMocks()
  })

  const authenticator = {
    authenticate: async () => {
      authenticated += 1
      return { userId: 'u' }
    },
  }

  const options = (namespace?: string) => ({
    transport: 'websocket' as const,
    websocket: namespace === undefined ? {} : { namespace },
    authenticator,
  })

  /** One `forRootAsync` object whose factory reads the namespace the test holds at the moment an application is made. */
  function asyncModule(namespace: () => string | undefined): DynamicModule {
    return BymaxRealtimeWebSocketModule.forRootAsync({
      transport: 'websocket',
      useFactory: () => options(namespace()),
    })
  }

  async function compile(
    library: DynamicModule,
    override?: (builder: ReturnType<typeof Test.createTestingModule>) => unknown,
  ): Promise<INestApplication> {
    const builder = Test.createTestingModule({ imports: [library] })
    override?.(builder)
    const app = (await builder.compile()).createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    apps.push(app)
    return app
  }

  async function listen(app: INestApplication): Promise<number> {
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  /** Whether a client of `namespace` is accepted and authenticated by the library. */
  async function reachesLibrary(port: number, namespace: string): Promise<boolean> {
    const socket = ioClient(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    const before = authenticated
    await new Promise<void>((resolve) => {
      socket.once('connect', resolve)
      socket.once('connect_error', () => resolve())
    })
    return socket.connected && authenticated === before + 1
  }

  // Scenario: an application on '/a' is closed and the same module object starts one on '/b'. Expected: it serves '/b'.
  it('takes another namespace after the first application closed', async () => {
    let namespace = '/a'
    const library = asyncModule(() => namespace)
    const first = await compile(library)
    await listen(first)
    await first.close()
    namespace = '/b'

    const port = await listen(await compile(library))

    expect(await reachesLibrary(port, '/b')).toBe(true)
  })

  // Scenario: two applications of one module object, the second made after the first listens. Expected: each serves its own.
  it('serves two namespaces from two applications started one after the other', async () => {
    let namespace = '/a'
    const library = asyncModule(() => namespace)
    const first = await listen(await compile(library))
    namespace = '/b'
    const second = await listen(await compile(library))

    expect([
      await reachesLibrary(first, '/a'),
      await reachesLibrary(second, '/b'),
      await reachesLibrary(first, '/b'),
      await reachesLibrary(second, '/a'),
    ]).toStrictEqual([true, true, false, false])
  })

  // Scenario: two applications made before either is initialized, wanting different namespaces. Expected: the second is refused.
  it('refuses another namespace while an earlier application is not connected yet', async () => {
    let namespace = '/a'
    const library = asyncModule(() => namespace)
    await compile(library)
    namespace = '/b'

    await expect(compile(library)).rejects.toThrow('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: two applications made before either is initialized, one namespace written two ways. Expected: both serve it.
  it.each([
    ['/rt', 'rt', '/rt'],
    [undefined, '', '/'],
    ['', '/', '/'],
  ])('reads %p and %p as one namespace', async (first, second, served) => {
    let namespace: string | undefined = first
    const library = asyncModule(() => namespace)
    const one = await compile(library)
    namespace = second
    const two = await compile(library)

    expect([
      await reachesLibrary(await listen(one), served),
      await reachesLibrary(await listen(two), served),
    ]).toStrictEqual([true, true])
  })

  // Scenario: the root after a namespace on the same module object. Expected: the second application serves '/', not '/a'.
  it('returns to the root after a namespace', async () => {
    let namespace: string | undefined = '/a'
    const library = asyncModule(() => namespace)
    await listen(await compile(library))
    namespace = undefined

    const port = await listen(await compile(library))

    expect([await reachesLibrary(port, '/'), await reachesLibrary(port, '/a')]).toStrictEqual([
      true,
      false,
    ])
  })

  // Scenario: an application closed without ever being initialized. Expected: it holds no namespace afterwards.
  it('lets go of the namespace of an application closed before init', async () => {
    let namespace = '/a'
    const library = asyncModule(() => namespace)
    await (await compile(library)).close()
    namespace = '/b'

    const port = await listen(await compile(library))

    expect(await reachesLibrary(port, '/b')).toBe(true)
  })

  // Scenario: a `forRoot` object reused by tests that replace the options. Expected: each application serves the replacement.
  it('serves the namespace of replaced options on a forRoot object used before', async () => {
    const library = BymaxRealtimeWebSocketModule.forRoot(options('/rt'))
    const first = await compile(library)
    await listen(first)
    await first.close()

    const port = await listen(
      await compile(library, (builder) =>
        builder.overrideProvider(REALTIME_OPTIONS_TOKEN).useValue(options('/test')),
      ),
    )

    expect(await reachesLibrary(port, '/test')).toBe(true)
  })

  // Scenario: an `onModuleInit` of the host throws, which Nest runs after it connected the gateway. Expected: the module
  // object takes another namespace on the next boot, with the failed application left open.
  it('takes another namespace after a boot that failed in onModuleInit', async () => {
    let namespace = '/typo'
    const library = asyncModule(() => namespace)
    class Failing {
      onModuleInit(): void {
        if (namespace === '/typo') throw new Error('host boot failed')
      }
    }
    Module({})(Failing)
    const failed = await compile({ module: Failing, imports: [library], providers: [Failing] })
    await expect(failed.init()).rejects.toThrow('host boot failed')
    namespace = '/ok'

    const port = await listen(await compile(library))

    expect(await reachesLibrary(port, '/ok')).toBe(true)
  })

  // Scenario: a provider of the host rejects while Nest is still making instances, so no application is returned to close.
  // Expected (a documented limit): the module object keeps that namespace and refuses another one.
  it('keeps the namespace of a boot that failed while making instances', async () => {
    let namespace = '/typo'
    const library = asyncModule(() => namespace)
    class Root {}
    Module({
      imports: [library],
      providers: [
        {
          provide: 'SLOW_FAILURE',
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            if (namespace === '/typo') throw new Error('host boot failed')
          },
        },
      ],
    })(Root)
    const boot = (): Promise<unknown> =>
      NestFactory.create(Root, { logger: false, abortOnError: false })
    await expect(boot()).rejects.toThrow('host boot failed')
    namespace = '/ok'

    await expect(boot()).rejects.toThrow('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: the gateway provider replaced with a subclass of the exported class. Expected (a documented limit): the
  // replacement declares no namespace, so the library is served on '/' and not on websocket.namespace.
  it('serves a replacement of the gateway provider on /', async () => {
    class Replacement extends RealtimeGateway {}
    const port = await listen(
      await compile(BymaxRealtimeWebSocketModule.forRoot(options('/rt')), (builder) =>
        builder.overrideProvider(RealtimeGateway).useClass(Replacement),
      ),
    )

    expect([await reachesLibrary(port, '/'), await reachesLibrary(port, '/rt')]).toStrictEqual([
      true,
      false,
    ])
  })

  // Scenario: `forRoot` twice in one application, on '/a' and '/b'. Expected (a documented limit): both namespaces are
  // served by a library gateway each.
  it('serves both namespaces when forRoot is called twice in one application', async () => {
    const app = (
      await Test.createTestingModule({
        imports: [
          BymaxRealtimeWebSocketModule.forRoot(options('/a')),
          BymaxRealtimeWebSocketModule.forRoot(options('/b')),
        ],
      }).compile()
    ).createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    apps.push(app)
    const port = await listen(app)

    expect([await reachesLibrary(port, '/a'), await reachesLibrary(port, '/b')]).toStrictEqual([
      true,
      true,
    ])
  })
})
