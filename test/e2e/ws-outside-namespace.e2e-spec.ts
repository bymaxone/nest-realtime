/**
 * @fileoverview End-to-end: what the library says about the gateways that stay on `/` while it is served elsewhere.
 * @layer e2e
 *
 * Constraint under test: with `websocket.namespace` set, a host gateway on `/` of the library's server is outside the
 * library's authentication. The adapter says so once at boot; with the stock adapter the missing-adapter error says it.
 */
import 'reflect-metadata'
import type { INestApplication, Type } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { ConnectedSocket, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { Socket } from 'socket.io'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'
import { freePort } from '../support/free-port'
import { lineOf } from '../support/log-lines'

jest.setTimeout(20_000)

/** A host gateway on `args` that answers `probe`. */
function hostGateway(...args: unknown[]): Type<unknown> {
  class HostGateway {
    @SubscribeMessage('probe')
    probe(@ConnectedSocket() client: Socket): string {
      return `host handler on ${client.nsp.name}`
    }
  }
  ;(WebSocketGateway as (...a: unknown[]) => ClassDecorator)(...args)(HostGateway)
  return HostGateway
}

describe('gateways outside websocket.namespace (e2e)', () => {
  let app: INestApplication | undefined
  const clients: ClientSocket[] = []
  let warnings: jest.SpyInstance
  let errors: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  const authenticator = { authenticate: async () => null }

  async function boot(
    hosts: Type<unknown>[],
    websocket: Record<string, unknown>,
    withAdapter = true,
    transport: 'websocket' | 'both' = 'websocket',
    async = false,
  ): Promise<number> {
    const options = { transport, websocket, authenticator }
    const moduleRef = await Test.createTestingModule({
      imports: [
        async
          ? BymaxRealtimeWebSocketModule.forRootAsync({ transport, useFactory: () => options })
          : BymaxRealtimeWebSocketModule.forRoot(options),
      ],
      providers: hosts,
    }).compile()
    app = moduleRef.createNestApplication()
    if (withAdapter) app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  const written = (spy: jest.SpyInstance, event: string): string[] =>
    spy.mock.calls
      .filter(([line]) => (line as { event?: string } | undefined)?.event === event)
      .map(([line]) => lineOf(line))

  const outside = (): string[] => written(warnings, 'REALTIME_GATEWAY_OUTSIDE_NAMESPACE')

  // Scenario: a host gateway with no namespace, or declaring '/', beside a library on '/rt'. Expected: one warning that names
  // the remedy and not the namespace.
  it.each([
    ['declares no namespace', [] as unknown[]],
    ["declares '/'", [{ namespace: '/' }] as unknown[]],
  ])('warns once about a gateway that %s', async (_case, args) => {
    await boot([hostGateway(...args), hostGateway(...args)], { namespace: '/rt-secret' })

    expect(outside()).toHaveLength(1)
    expect(outside()[0]).toContain('websocket.namespace')
    expect(outside()[0]).not.toContain('rt-secret')
  })

  // Scenario: no gateway of the library's server is on '/', or the library is. Expected: no warning.
  it.each([
    ['there is no other gateway', () => [], { namespace: '/rt' }],
    [
      'the other gateway has a namespace',
      () => [hostGateway({ namespace: '/chat' })],
      { namespace: '/rt' },
    ],
    [
      'the other gateway shares the namespace',
      () => [hostGateway({ namespace: '/rt' })],
      { namespace: '/rt' },
    ],
    [
      'the other gateway has a path of its own',
      () => [hostGateway({ path: '/own' })],
      { namespace: '/rt' },
    ],
    ['websocket.namespace is unset', () => [hostGateway()], {}],
    ["websocket.namespace is '/'", () => [hostGateway()], { namespace: '/' }],
  ])('says nothing when %s', async (_case, hosts, websocket) => {
    await boot(hosts(), websocket)

    expect(outside()).toStrictEqual([])
  })

  // Scenario: the other gateway listens on a port of its own. Expected: no warning, its '/' is not on the library's server.
  it('says nothing about a gateway on a port of its own', async () => {
    await boot([hostGateway(await freePort())], { namespace: '/rt' })

    expect(outside()).toStrictEqual([])
  })

  // Scenario: the adapter is used, namespace set. Expected: no missing-adapter error from the gateway on its namespace.
  it.each([
    ['websocket', false],
    ['websocket', true],
    ['both', false],
    ['both', true],
  ] as const)(
    'serves the namespace and reports no missing adapter (transport %s, async %s)',
    async (transport, async) => {
      const port = await boot([], { namespace: '/rt' }, true, transport, async)
      const socket = ioClient(`http://127.0.0.1:${port}/rt`, {
        transports: ['websocket'],
        reconnection: false,
      })
      clients.push(socket)
      const refusal = await new Promise<string>((resolve) => {
        socket.once('connect', () => resolve('connected'))
        socket.once('connect_error', (error) => resolve(error.message))
      })

      expect([refusal, written(errors, 'REALTIME_ADAPTER_MISSING')]).toStrictEqual([
        'REALTIME_AUTH_FAILED',
        [],
      ])
    },
  )

  // Scenario: the stock adapter with a namespace and CORS configured. Expected: the namespace is applied and the error says so,
  // naming CORS as ignored; a client of '/' reaches the host handler without the library's authenticator.
  it('says the namespace is applied when the adapter is missing', async () => {
    const port = await boot([hostGateway()], { namespace: '/rt', cors: { origin: '*' } }, false)
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)

    expect(await socket.timeout(2000).emitWithAck('probe')).toBe('host handler on /')
    const [line] = written(errors, 'REALTIME_ADAPTER_MISSING')
    expect(line).toContain('so the websocket options (cors) are ignored')
    expect(line).toContain('websocket.namespace is applied')
    expect(line).not.toContain('/rt')
  })
})
