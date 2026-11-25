/**
 * @fileoverview End-to-end: which kinds of open client keep `app.close()` pending when `websocket.namespace` is set.
 * @layer e2e
 *
 * Constraint under test: Nest holds the root Socket.IO server, so closing the application closes every connection the
 * engine knows, authenticated or not, over WebSocket or polling. A raw TCP connection that completed the upgrade and then
 * says nothing is not one the engine tracks, and it keeps `app.close()` pending whatever the namespace: README, "Known limits".
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { connect as netConnect } from 'node:net'
import type { AddressInfo, Socket as NetSocket } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(30_000)

const UPGRADE =
  'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
const POLLING = 'GET /socket.io/?EIO=4&transport=polling HTTP/1.1\r\nHost: x\r\n\r\n'
const SETTLE_MS = 5_000
const PENDING = Symbol('pending')

describe('app.close() with an open client (e2e)', () => {
  let app: INestApplication | undefined
  const sockets: Array<ClientSocket | NetSocket> = []

  beforeEach(() => void jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined))
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  async function boot(authenticatorNeverAnswers: boolean): Promise<number> {
    const authenticate = (): Promise<{ userId: string }> =>
      authenticatorNeverAnswers ? new Promise(() => undefined) : Promise.resolve({ userId: 'u' })
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          websocket: { namespace: '/rt' },
          authenticator: { authenticate },
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  const closeOutcome = (): Promise<'closed' | typeof PENDING> =>
    Promise.race([
      (app as INestApplication).close().then(() => 'closed' as const),
      new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), SETTLE_MS)),
    ])

  async function client(
    port: number,
    transport: 'websocket' | 'polling',
    wait: boolean,
  ): Promise<void> {
    const socket = ioClient(`http://127.0.0.1:${port}/rt`, {
      transports: [transport],
      reconnection: false,
    })
    sockets.push(socket)
    await new Promise((resolve) =>
      wait ? socket.once('connect', resolve) : setTimeout(resolve, 300),
    )
  }

  async function raw(port: number, request: string): Promise<void> {
    const socket = netConnect(port, '127.0.0.1')
    sockets.push(socket)
    socket.on('error', () => undefined)
    socket.write(request)
    socket.pause()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  // Scenario: one client of each kind the engine tracks is open when the application closes. Expected: close settles.
  it.each([
    ['an authenticated WebSocket client', false, 'websocket', true],
    ['an authenticated polling client', false, 'polling', true],
    ['a client whose authenticator never answers', true, 'websocket', false],
  ] as const)('settles with %s', async (_name, never, transport, wait) => {
    const port = await boot(never)
    await client(port, transport, wait)

    expect(await closeOutcome()).toBe('closed')
  })

  // Scenario: a polling request whose answer the client never reads. Expected: close settles.
  it('settles with a polling client that never reads its answer', async () => {
    const port = await boot(false)
    await raw(port, POLLING)

    expect(await closeOutcome()).toBe('closed')
  })

  // Scenario: a raw TCP connection that finished the upgrade request and says nothing more. Expected: close stays pending,
  // as with no namespace at all; this is the limit the README keeps.
  it('stays pending with a raw connection mid-upgrade that goes silent', async () => {
    const port = await boot(false)
    await raw(port, UPGRADE)

    expect(await closeOutcome()).toBe(PENDING)
  })
})
