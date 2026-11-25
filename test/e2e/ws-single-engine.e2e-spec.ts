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
    expect(uncaught).toStrictEqual([])
  })

  // Scenario: no websocket.namespace and one host gateway of its own namespace. Expected: one `upgrade` listener.
  it('serves a host gateway beside a library gateway on the root namespace from one engine', async () => {
    const host = hostGateway({ namespace: 'y' })

    const port = await boot(undefined, [host])

    expect(app?.getHttpServer().listenerCount('upgrade')).toBe(1)
    expect(await connect(port, '/y')).toBe('connected')
    expect(uncaught).toStrictEqual([])
  })
})
