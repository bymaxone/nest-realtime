/**
 * @fileoverview End-to-end: which kinds of open client keep `app.close()` pending when `websocket.namespace` is set.
 * @layer e2e
 *
 * Constraint under test: Nest holds the root Socket.IO server, so closing the application closes every connection the
 * engine knows, authenticated or not, over WebSocket or polling. A connection that completed the upgrade and then answers
 * nothing is waited for until its close times out; a TCP connection that sent nothing, or part of a request, is not one the
 * engine knows and keeps `app.close()` pending. `forceCloseConnections` ends all three: README, "Known limits".
 */
import 'reflect-metadata'
import { connect as netConnect, Socket as NetSocket } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(30_000)

const UPGRADE =
  'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
const POLLING = 'GET /socket.io/?EIO=4&transport=polling HTTP/1.1\r\nHost: x\r\n\r\n'
const PARTIAL = 'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: x\r\n'
const SETTLE_MS = 5_000
/** Longer than the time a WebSocket waits for the peer to answer its close frame. */
const CLOSE_TIMEOUT_MS = 40_000
const PENDING = Symbol('pending')

/** Ends a client of either kind: a raw socket is destroyed, a Socket.IO client is closed. */
function drop(socket: ClientSocket | NetSocket): void {
  if (socket instanceof NetSocket) socket.destroy()
  else socket.close()
}

describe('app.close() with an open client (e2e)', () => {
  let app: INestApplication | undefined
  const sockets: Array<ClientSocket | NetSocket> = []

  beforeEach(() => void jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined))
  afterEach(async () => {
    for (const socket of sockets.splice(0)) drop(socket)
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  async function boot(
    authenticatorNeverAnswers: boolean,
    forceCloseConnections = false,
  ): Promise<number> {
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
    app = moduleRef.createNestApplication({ forceCloseConnections })
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  const within = (closing: Promise<void>, ms: number): Promise<'closed' | typeof PENDING> => {
    let timer: NodeJS.Timeout | undefined
    return Promise.race([
      closing.then(() => 'closed' as const),
      new Promise<typeof PENDING>((resolve) => {
        timer = setTimeout(() => resolve(PENDING), ms)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  const closeOutcome = (): Promise<'closed' | typeof PENDING> =>
    within((app as INestApplication).close(), SETTLE_MS)

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
    await new Promise<void>((resolve) =>
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

  // Scenario: a connection that finished the upgrade and then answers nothing. Expected: close is still pending after five
  // seconds and settles once the close of that WebSocket times out, with the connection left open by the peer.
  it('waits for the close timeout of a connection that finished the upgrade and went silent', async () => {
    const port = await boot(false)
    await raw(port, UPGRADE)
    const closing = (app as INestApplication).close()
    app = undefined

    expect(await within(closing, SETTLE_MS)).toBe(PENDING)
    expect(await within(closing, CLOSE_TIMEOUT_MS)).toBe('closed')
  }, 60_000)

  // Scenario: a TCP connection that sent nothing, or part of a request. Expected: close stays pending until the peer ends it.
  it.each([
    ['sent nothing', ''],
    ['sent part of a request', PARTIAL],
  ])('stays pending with a TCP connection that %s', async (_name, request) => {
    const port = await boot(false)
    await raw(port, request)
    const closing = (app as INestApplication).close()
    app = undefined

    expect(await within(closing, SETTLE_MS)).toBe(PENDING)
    for (const socket of sockets.splice(0)) drop(socket)
    expect(await within(closing, SETTLE_MS)).toBe('closed')
  })

  // Scenario: each of those three connections, in an application made with `forceCloseConnections`. Expected: close settles.
  it.each([
    ['finished the upgrade', UPGRADE],
    ['sent nothing', ''],
    ['sent part of a request', PARTIAL],
  ])('settles with forceCloseConnections and a connection that %s', async (_name, request) => {
    const port = await boot(false, true)
    await raw(port, request)

    expect(await closeOutcome()).toBe('closed')
  })
})
