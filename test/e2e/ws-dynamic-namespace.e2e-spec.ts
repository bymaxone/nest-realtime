/**
 * @fileoverview End-to-end: a host gateway with a dynamic namespace does not take `websocket.namespace` from the library.
 * @layer e2e
 *
 * Constraint under test: Socket.IO makes a namespace opened by name a child of any registered RegExp namespace that matches
 * the name, and a broadcast, a handler and a room emit of that parent reach the child. The library's namespace on its own
 * server is its own, whichever gateway Nest connects first; a server of another port or path is left to its gateways.
 */
import 'reflect-metadata'
import type { INestApplication, Type } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { OnGatewayConnection } from '@nestjs/websockets'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { Server, Socket } from 'socket.io'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'
import { freePort } from '../support/free-port'
import { lineOf } from '../support/log-lines'

jest.setTimeout(20_000)

interface Host {
  connected: string[]
  server: Server | undefined
}

/** A host gateway on `args` that records where it is reached and answers `probe`. */
function hostGateway(...args: unknown[]): Type<unknown> & Host {
  class HostGateway implements OnGatewayConnection {
    static connected: string[] = []
    static server: Server | undefined
    @WebSocketServer() server!: Server
    afterInit(): void {
      HostGateway.server = this.server
    }
    handleConnection(client: Socket): void {
      HostGateway.connected.push(client.nsp.name)
    }
    @SubscribeMessage('probe')
    probe(@ConnectedSocket() client: Socket): string {
      return `host handler on ${client.nsp.name}`
    }
  }
  ;(WebSocketGateway as (...a: unknown[]) => ClassDecorator)(...args)(HostGateway)
  return HostGateway
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('a dynamic host namespace and websocket.namespace (e2e)', () => {
  let app: INestApplication | undefined
  const clients: ClientSocket[] = []

  beforeEach(() => void jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined))
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  const authenticator = {
    authenticate: async (ctx: { headers: Record<string, unknown> }) => {
      const token = String(ctx.headers['authorization'] ?? '').replace('Bearer ', '')
      return token === '' ? null : { userId: token, tenantId: `t-${token}` }
    },
  }

  /** The host is a root provider, which Nest connects before the gateway of an imported module. */
  async function boot(host: Type<unknown>, withAdapter = true): Promise<number> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          websocket: { namespace: '/rt' },
          authenticator: authenticator as never,
        }),
      ],
      providers: [host],
    }).compile()
    app = moduleRef.createNestApplication()
    if (withAdapter) app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  function open(port: number, namespace: string, token = '', path?: string): Promise<ClientSocket> {
    const socket = ioClient(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: token === '' ? {} : { token },
      ...(path === undefined ? {} : { path }),
    })
    clients.push(socket)
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket))
      socket.once('connect_error', (error) => reject(error))
    })
  }

  const probe = (client: ClientSocket): Promise<string> =>
    client
      .timeout(300)
      .emitWithAck('probe')
      .then(
        (answer) => String(answer),
        () => 'no answer',
      )

  const matching = [[/^\/\w+$/], [/^\/(rt|chat)$/]]

  // Scenario: a root gateway whose RegExp namespace matches '/rt' broadcasts with no room. Expected: no library socket hears it.
  it.each(matching)(
    'keeps the broadcast of a %s gateway from library sockets',
    async (namespace) => {
      const host = hostGateway({ namespace })
      const port = await boot(host)
      const first = await open(port, '/rt', 'a')
      const second = await open(port, '/rt', 'b')
      const heard: string[] = []
      first.on('note', () => heard.push('a'))
      second.on('note', () => heard.push('b'))

      host.server?.emit('note', 1)
      await wait(200)

      expect(heard).toStrictEqual([])
    },
  )

  // Scenario: a library client sends what the matching gateway handles. Expected: no handler of that gateway runs for it.
  it.each(matching)('runs no handler of a %s gateway on a library socket', async (namespace) => {
    const host = hostGateway({ namespace })
    const port = await boot(host)
    const client = await open(port, '/rt', 'a')

    expect([await probe(client), host.connected]).toStrictEqual(['no answer', []])
  })

  // Scenario: the matching gateway emits to the room the library keeps for a user. Expected: the library socket does not hear it.
  it.each(matching)('keeps a %s gateway out of the library rooms', async (namespace) => {
    const host = hostGateway({ namespace })
    const port = await boot(host)
    const client = await open(port, '/rt', 'a')
    const heard: string[] = []
    client.on('note', () => heard.push('a'))

    host.server?.to('user:a').emit('note', 1)
    await wait(200)

    expect(heard).toStrictEqual([])
  })

  // Scenario: a client without a credential asks for '/rt' while a matching gateway exists. Expected: it is refused.
  it.each(matching)('still refuses an anonymous client with a %s gateway', async (namespace) => {
    const port = await boot(hostGateway({ namespace }))

    await expect(open(port, '/rt')).rejects.toThrow('REALTIME_AUTH_FAILED')
  })

  // Scenario: the same gateway, a name it matches that is not the library's. Expected: it is still served by the gateway.
  it('serves the names a matching gateway keeps', async () => {
    const port = await boot(hostGateway({ namespace: /^\/\w+$/ }))

    expect(await probe(await open(port, '/chat'))).toBe('host handler on /chat')
  })

  // Scenario: a RegExp that misses '/rt', or a function. Expected: the gateway serves its names and the library '/rt'.
  it.each([
    ['a RegExp', /^\/room-\d+$/],
    [
      'a function',
      (name: string, _auth: unknown, next: (error: null, ok: boolean) => void) =>
        next(null, /^\/(rt|room-\d+)$/.test(name)),
    ],
  ])('serves %s gateway beside the library', async (_kind, namespace) => {
    const host = hostGateway({ namespace })
    const port = await boot(host)
    const library = await open(port, '/rt', 'a')

    expect([await probe(library), await probe(await open(port, '/room-1'))]).toStrictEqual([
      'no answer',
      'host handler on /room-1',
    ])
  })

  // Scenario: the matching gateway has a server of its own, by port or by path. Expected: '/rt' there is the gateway's.
  it.each([['port'], ['path']])('leaves /rt to a matching gateway on its own %s', async (kind) => {
    const namespace = /^\/(rt|chat)$/
    const ownPort = await freePort()
    const port = await boot(
      kind === 'port'
        ? hostGateway(ownPort, { namespace })
        : hostGateway({ namespace, path: '/own' }),
    )

    const client =
      kind === 'port' ? await open(ownPort, '/rt') : await open(port, '/rt', '', '/own')

    expect(await probe(client)).toBe('host handler on /rt')
  })

  // Scenario: the same matching gateway with Nest's own adapter. Expected (a documented limit): the library socket hears its
  // room-less broadcast, a client without a credential is still refused, and the boot error says isolation is not guaranteed.
  it('lets a matching gateway take /rt with the stock adapter', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const host = hostGateway({ namespace: /^\/\w+$/ })
    const port = await boot(host, false)
    const client = await open(port, '/rt', 'a')
    const heard: string[] = []
    client.on('note', () => heard.push('a'))

    host.server?.emit('note', 1)
    await wait(200)

    expect(heard).toStrictEqual(['a'])
    await expect(open(port, '/rt')).rejects.toThrow('REALTIME_AUTH_FAILED')
    const missing = errors.mock.calls
      .map(([line]) => line as { event?: string })
      .filter((line) => line.event === 'REALTIME_ADAPTER_MISSING')
    expect(missing.map((line) => lineOf(line))).toStrictEqual([
      expect.stringContaining(
        "Isolation from your gateways' namespaces is not guaranteed without RealtimeIoAdapter.",
      ),
    ])
  })
})
