/**
 * @fileoverview Two registrations in one application, which share one Socket.IO server, measured with real clients.
 * @layer transport
 *
 * Constraint under test: the adapter builds the server from one registration's options, so a registration that asks for
 * an origin policy the server was not built with refuses the boot; no application serves a namespace without the policy
 * its registration asked for.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io as connect } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { BymaxRealtimeWebSocketModule } from '../../realtime-websocket.module'
import { RealtimeIoAdapter } from './realtime-io-adapter'

type Websocket = NonNullable<BymaxRealtimeModuleOptions['websocket']>

const LISTED = 'https://app.example'
const OTHER = 'https://other.example'
const EVIL = 'https://evil.example'

describe('two registrations on one Socket.IO server', () => {
  const apps: INestApplication[] = []
  const clients: ClientSocket[] = []

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    for (const app of apps.splice(0)) await app.close()
    jest.restoreAllMocks()
  })

  /** An application with one `forRoot` for `/a` and one for `/b`, in that import order. */
  async function application(a: Websocket, b: Websocket): Promise<INestApplication> {
    const register = (websocket: Websocket) =>
      BymaxRealtimeWebSocketModule.forRoot({
        transport: 'websocket',
        websocket,
        authenticator: { authenticate: async () => ({ userId: 'u' }) },
      })
    const moduleRef = await Test.createTestingModule({
      imports: [register({ ...a, namespace: '/a' }), register({ ...b, namespace: '/b' })],
    }).compile()
    const app = moduleRef.createNestApplication({ logger: false })
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    apps.push(app)
    return app
  }

  /** Whether a WebSocket client sending `origin` connects to `namespace`. */
  async function reaches(
    app: INestApplication,
    namespace: string,
    origin: string,
  ): Promise<boolean> {
    const { port } = app.getHttpServer().address() as AddressInfo
    const client = connect(`http://127.0.0.1:${port}${namespace}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Origin: origin },
    })
    clients.push(client)
    return new Promise((resolve) => {
      client.on('connect', () => resolve(true))
      client.on('connect_error', () => resolve(false))
    })
  }

  const list = (...allowedOrigins: string[]): Websocket => ({ allowedOrigins })

  const NONE_BUILT = 'the server was built with neither'
  const count = (server: number, own: number): string =>
    `the server's list has ${server} entries and this registration's has ${own}`
  const differAt = (index: number): string => `the two lists differ first at index ${index}`

  // Scenario: the registration the server is not built from asks for a policy, or the two ask for different ones.
  // Expected: the boot is refused, saying where the two part, so nothing is served.
  it.each([
    ['a list first, nothing second', list(LISTED), {}, NONE_BUILT],
    ['websocketOnly first, nothing second', { websocketOnly: true }, {}, NONE_BUILT],
    ['two lists', list(LISTED), list(OTHER), differAt(0)],
    ['two lists, swapped', list(OTHER), list(LISTED), differAt(0)],
    ['the same entries in another order', list(LISTED, OTHER), list(OTHER, LISTED), differAt(0)],
    ['lists that part at the second entry', list(LISTED, OTHER), list(LISTED, EVIL), differAt(1)],
    ['a list inside a longer one', list(LISTED), list(LISTED, OTHER), count(2, 1)],
    ['a longer list, then one inside it', list(LISTED, OTHER), list(LISTED), count(1, 2)],
    ['websocketOnly first, a list second', { websocketOnly: true }, list(LISTED), count(1, 0)],
    ['a list first, websocketOnly second', list(LISTED), { websocketOnly: true }, count(0, 1)],
  ])('refuses the boot with %s', async (_name, a, b, why) => {
    const app = await application(a, b)

    const refusal = await app.listen(0, '127.0.0.1').then(
      () => 'booted',
      (error: Error) => error.message,
    )

    expect(refusal).toContain('[RealtimeGateway] REALTIME_INVALID_OPTIONS')
    expect(refusal).toContain('share one Socket.IO server')
    expect(refusal).toContain(why)
    expect(refusal).not.toContain('example')
  })

  // Scenario: both ask for the same list, or only the registration the server is built from asks for one.
  // Expected: the application boots and the policy holds on both namespaces.
  it.each([
    ['the same list twice', list(LISTED), list(LISTED)],
    ['nothing first, a list second', {}, list(LISTED)],
  ])('serves both namespaces under the list with %s', async (_name, a, b) => {
    const app = await application(a, b)
    await app.listen(0, '127.0.0.1')

    for (const namespace of ['/a', '/b']) {
      expect(await reaches(app, namespace, LISTED)).toBe(true)
      expect(await reaches(app, namespace, EVIL)).toBe(false)
    }
  })

  // Scenario: both ask for websocketOnly and no list, or neither asks for anything. Expected: the application boots.
  it.each([
    ['websocketOnly twice', { websocketOnly: true }],
    ['no policy', {}],
  ])('boots with %s', async (_name, websocket) => {
    const app = await application(websocket, websocket)
    await app.listen(0, '127.0.0.1')

    expect(await reaches(app, '/a', EVIL)).toBe(true)
    expect(await reaches(app, '/b', EVIL)).toBe(true)
  })
})
