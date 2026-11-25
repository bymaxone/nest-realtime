/**
 * @fileoverview End-to-end: one engine serves one port and path, whatever namespaces the library and the host's gateways use.
 * @layer e2e
 *
 * Constraint under test: `websocket.namespace` binds the library's gateway to a namespace of the application's one
 * Socket.IO server. A host gateway of another namespace joins that same server. If a second engine were created on the
 * HTTP server, every upgrade would reach two `upgrade` listeners and the second `handleUpgrade` would throw, ending the
 * process. The tests drive a real Nest application with real Socket.IO clients.
 */
import 'reflect-metadata'
import type { INestApplication, Type } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { WebSocketGateway } from '@nestjs/websockets'
import { Test } from '@nestjs/testing'
import { connect as netConnect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

/** A host gateway on `options`, whose connections are counted on the class. */
function hostGateway(options: Record<string, unknown>): Type<{ handleConnection(): void }> & {
  count: number
} {
  class HostGateway {
    static count = 0
    handleConnection(): void {
      HostGateway.count += 1
    }
  }
  WebSocketGateway(options)(HostGateway)
  return HostGateway
}

/** The first line of the answer to a raw request, or `closed` when the server said nothing. */
function rawStatus(port: number, request: string): Promise<{ line: string; body: string }> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1')
    let answer = ''
    const finish = (): void => {
      socket.destroy()
      const [head = '', ...rest] = answer.split('\r\n\r\n')
      resolve({ line: head.split('\r\n')[0] || 'closed', body: rest.join('') })
    }
    socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('latin1')
      if (answer.includes('\r\n\r\n')) setTimeout(finish, 50)
    })
    socket.on('close', finish)
    socket.on('error', finish)
    socket.write(request)
    setTimeout(finish, 1_000)
  })
}

const UPGRADE =
  'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
const request = (path: string, headers = '', method = 'GET', body = ''): string =>
  `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}${
    body === ''
      ? ''
      : `Content-Type: text/plain;charset=UTF-8\r\nContent-Length: ${body.length}\r\n`
  }Connection: close\r\n\r\n${body}`

describe('one engine per port and path (e2e)', () => {
  let app: INestApplication | undefined
  const clients: ClientSocket[] = []
  const uncaught: Error[] = []
  const onUncaught = (error: Error): void => void uncaught.push(error)

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    process.on('uncaughtException', onUncaught)
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    await app?.close()
    app = undefined
    process.off('uncaughtException', onUncaught)
    uncaught.length = 0
    jest.restoreAllMocks()
  })

  async function boot(
    namespace: string | undefined,
    hosts: readonly Type<unknown>[],
  ): Promise<number> {
    const library = BymaxRealtimeWebSocketModule.forRoot({
      transport: 'websocket',
      authenticator: { authenticate: async () => ({ userId: 'u1' }) },
      ...(namespace === undefined ? {} : { websocket: { namespace } }),
    })
    const moduleRef = await Test.createTestingModule({
      imports: [library],
      providers: [...hosts],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  async function connect(port: number, namespace: string): Promise<'connected' | 'refused'> {
    const socket = ioClient(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    return new Promise((resolve) => {
      socket.once('connect', () => resolve('connected'))
      socket.once('connect_error', () => resolve('refused'))
    })
  }

  // Scenario: websocket.namespace is '/rt' and a host gateway declares the namespace '/y'. Expected: the HTTP server has one
  // `upgrade` listener, both namespaces accept a client, and no handshake ends the process.
  it.each([
    ['one other namespace', [{ namespace: 'y' }], ['/y']],
    ['two other namespaces', [{ namespace: 'y' }, { namespace: 'z' }], ['/y', '/z']],
    ['the same namespace', [{ namespace: 'rt' }], ['/rt']],
  ])('serves %s from one engine', async (_name, hostOptions, hostNamespaces) => {
    const hosts = hostOptions.map(hostGateway)

    const port = await boot('/rt', hosts)

    expect(app?.getHttpServer().listenerCount('upgrade')).toBe(1)
    expect(await connect(port, '/rt')).toBe('connected')
    for (const namespace of hostNamespaces) {
      expect(await connect(port, namespace)).toBe('connected')
    }
    // The host handler fires once for each client that connected to its namespace, and for no other.
    const connected = ['/rt', ...hostNamespaces]
    expect(hosts.map((host) => host.count)).toStrictEqual(
      hostOptions.map(
        (options) => connected.filter((namespace) => namespace === `/${options.namespace}`).length,
      ),
    )
    expect(uncaught).toStrictEqual([])
  })

  // Scenario: no websocket.namespace and one host gateway of its own namespace. Expected: one `upgrade` listener.
  it('serves a host gateway beside a library gateway on the root namespace from one engine', async () => {
    const host = hostGateway({ namespace: 'y' })

    const port = await boot(undefined, [host])

    expect(app?.getHttpServer().listenerCount('upgrade')).toBe(1)
    expect(await connect(port, '/y')).toBe('connected')
    expect(host.count).toBe(1)
    expect(uncaught).toStrictEqual([])
  })

  // Scenario: every kind of request the engine takes (the polling handshake, a post to a session that does not exist, an
  // upgrade, and an upgrade of a live session) with a host gateway beside the library's. Expected: each is answered by the
  // one engine as it is without the host gateway, and closing the application closes the HTTP server.
  it.each([
    ['a gateway of another namespace', '/rt', [{ namespace: 'y' }]],
    ['a gateway of the same namespace', '/rt', [{ namespace: 'rt' }]],
    ['no gateway of its own', '/rt', []],
    ['no websocket.namespace', undefined, [{ namespace: 'y' }]],
  ])('answers every kind of request once with %s', async (_name, namespace, hostOptions) => {
    const port = await boot(namespace, hostOptions.map(hostGateway))
    const server = app?.getHttpServer()

    const handshake = await rawStatus(port, request('/socket.io/?EIO=4&transport=polling'))
    const sid = /"sid":"([^"]+)"/.exec(handshake.body)?.[1]
    const lines = {
      handshake: handshake.line,
      post: (
        await rawStatus(
          port,
          request('/socket.io/?EIO=4&transport=polling&sid=nope', '', 'POST', '40'),
        )
      ).line,
      upgrade: (await rawStatus(port, request('/socket.io/?EIO=4&transport=websocket', UPGRADE)))
        .line,
      sidUpgrade: (
        await rawStatus(
          port,
          request(`/socket.io/?EIO=4&transport=websocket&sid=${String(sid)}`, UPGRADE),
        )
      ).line,
    }

    expect(lines).toStrictEqual({
      handshake: 'HTTP/1.1 200 OK',
      post: 'HTTP/1.1 400 Bad Request',
      upgrade: 'HTTP/1.1 101 Switching Protocols',
      sidUpgrade: 'HTTP/1.1 101 Switching Protocols',
    })
    expect(server?.listenerCount('upgrade')).toBe(1)
    expect(uncaught).toStrictEqual([])
    await app?.close()
    expect(server?.listening).toBe(false)
  })
})
