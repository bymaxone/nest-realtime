/**
 * @fileoverview End-to-end: Nest holds the root Socket.IO server; only the library's gateway is bound to `websocket.namespace`.
 * @layer e2e
 *
 * Constraint under test: a host gateway that declares no namespace is served on `/`, outside the library's authenticator and
 * rooms, and closing the application closes every server it opened. The tests drive a real Nest application with real clients.
 */
import 'reflect-metadata'
import type { INestApplication, Type } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { OnGatewayConnection } from '@nestjs/websockets'
import { LazyModuleLoader } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { connect as netConnect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { Server } from 'socket.io'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

interface Host {
  count: number
  pings: number
  server: Server | undefined
}

/** A host gateway on `args`, with a `ping` handler and a connection counter kept on the class. */
function hostGateway(...args: unknown[]): Type<unknown> & Host {
  class HostGateway implements OnGatewayConnection {
    static count = 0
    static pings = 0
    static server: Server | undefined
    @WebSocketServer() server!: Server
    handleConnection(): void {
      HostGateway.count += 1
      HostGateway.server = this.server
    }
    @SubscribeMessage('ping')
    ping(): string {
      HostGateway.pings += 1
      return 'pong'
    }
  }
  ;(WebSocketGateway as (...a: unknown[]) => ClassDecorator)(...args)(HostGateway)
  return HostGateway
}

const portBound = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1')
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })

describe('root server binding (e2e)', () => {
  let app: INestApplication | undefined
  const clients: ClientSocket[] = []
  let authenticated: string[] = []

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    authenticated = []
  })
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  const authenticator = {
    authenticate: async (ctx: { handshake?: { query?: Record<string, string> } }) => {
      authenticated.push('call')
      return { userId: `u${authenticated.length}`, ctx: undefined }
    },
  }

  async function boot(
    hosts: readonly Type<unknown>[],
    namespace = '/rt',
    async = false,
  ): Promise<number> {
    const options = { transport: 'websocket' as const, websocket: { namespace }, authenticator }
    const library = async
      ? BymaxRealtimeWebSocketModule.forRootAsync({
          transport: 'websocket',
          useFactory: () => ({
            transport: 'websocket' as const,
            websocket: options.websocket,
            authenticator,
          }),
        })
      : BymaxRealtimeWebSocketModule.forRoot(options)
    const moduleRef = await Test.createTestingModule({
      imports: [library],
      providers: [...hosts],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  function open(port: number, namespace: string): Promise<ClientSocket> {
    const socket = ioClient(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket))
      socket.once('connect_error', (error) => reject(error))
    })
  }

  // Scenario: a host gateway declares no namespace while the library uses '/rt'. Expected: a client on '/' reaches the host's
  // handler and the library's authenticator is not called for it.
  it('serves a gateway without a namespace on / and never authenticates it with the library', async () => {
    const host = hostGateway({})
    const port = await boot([host])

    const client = await open(port, '/')

    expect(await client.emitWithAck('ping')).toBe('pong')
    expect(host.pings).toBe(1)
    expect(authenticated).toStrictEqual([])
  })

  // Scenario: the same gateway, asking Nest's server. Expected: the server it was handed is the root, which can open namespaces.
  it('hands a gateway without a namespace the root server', async () => {
    const host = hostGateway({})
    const port = await boot([host])
    await open(port, '/')

    expect(typeof host.server?.of).toBe('function')
  })

  // Scenario: a host broadcast without a room while a library socket is connected. Expected: the library socket does not hear it,
  // and the host's own client does.
  it('keeps a host broadcast away from library sockets', async () => {
    const host = hostGateway({})
    const port = await boot([host])
    const library = await open(port, '/rt')
    const heard: string[] = []
    library.on('note', () => heard.push('library'))
    const own = await open(port, '/')
    own.on('note', () => heard.push('host'))

    host.server?.emit('note', 1)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(heard).toStrictEqual(['host'])
  })

  // Scenario: a gateway with its own port. Expected: that port is released when the application closes.
  it('releases the port of an own-port gateway on close', async () => {
    const ownPort = 40_000 + Math.floor(Math.random() * 10_000)
    await boot([hostGateway(ownPort, {})])
    expect(await portBound(ownPort)).toBe(true)

    await app?.close()
    app = undefined

    expect(await portBound(ownPort)).toBe(false)
  })

  // Scenario: forRootAsync with websocket.namespace. Expected: the library's gateway is bound to that namespace.
  it('binds the library to websocket.namespace under forRootAsync', async () => {
    const port = await boot([], '/rt', true)

    await open(port, '/rt')

    expect(authenticated).toHaveLength(1)
  })

  // Scenario: one module object serves two applications whose roots differ, both with websocket.namespace '/rt'.
  // Expected: each application binds the library to '/rt' of its own root and authenticates only its own clients.
  it('binds forRoot to its own root in each of two applications', async () => {
    const options = {
      transport: 'websocket' as const,
      websocket: { namespace: '/rt' },
      authenticator,
    }
    const library = BymaxRealtimeWebSocketModule.forRoot(options)
    const apps: INestApplication[] = []
    const ports: number[] = []
    for (let index = 0; index < 2; index += 1) {
      const moduleRef = await Test.createTestingModule({ imports: [library] }).compile()
      const instance = moduleRef.createNestApplication()
      instance.useWebSocketAdapter(new RealtimeIoAdapter(instance))
      await instance.listen(0)
      apps.push(instance)
      ports.push((instance.getHttpServer().address() as AddressInfo).port)
    }
    try {
      await open(ports[0] as number, '/rt')
      await open(ports[1] as number, '/rt')

      expect(authenticated).toHaveLength(2)
    } finally {
      for (const client of clients.splice(0)) client.close()
      for (const instance of apps) await instance.close()
    }
  })

  // Scenario: a module with a gateway of no namespace is loaded lazily after the application started. Expected (measured):
  // the root accepts a client, no handler of that gateway runs because Nest wires gateways at start only, and the library keeps '/rt'.
  it('leaves a gateway of a lazily loaded module unwired, as Nest does, and the library on /rt', async () => {
    const host = hostGateway()
    class LazyHostModule {}
    Module({ providers: [host] })(LazyHostModule)
    const port = await boot([])

    await app?.get(LazyModuleLoader).load(() => LazyHostModule)
    const lazyReached = await open(port, '/').then(
      () => true,
      () => false,
    )
    await open(port, '/rt')

    expect({ lazyReached, handled: host.count, library: authenticated.length }).toStrictEqual({
      lazyReached: true,
      handled: 0,
      library: 1,
    })
  })
})
