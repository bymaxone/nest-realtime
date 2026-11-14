/**
 * @fileoverview End-to-end tests of the per-user WebSocket connection cap, over real sockets.
 * @layer e2e
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { ConnectionRegistry } from '../../src/server/services/connection-registry.service'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'
import type { WebSocketOptions } from '../../src/server/interfaces/realtime-module-options.interface'

const USER = 'capped-user'

/** Wait until the predicate holds, polling, or fail with the label after the timeout. */
async function until(label: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('WebSocket per-user connection cap (e2e)', () => {
  let app: INestApplication
  let port: number
  let registry: ConnectionRegistry
  let clients: ClientSocket[]

  async function boot(websocket?: WebSocketOptions): Promise<void> {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: USER }) },
          ...(websocket ? { websocket } : {}),
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.init()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    registry = app.get(ConnectionRegistry)
  }

  /** Connect one client and resolve once the server has registered it. */
  async function connect(): Promise<ClientSocket> {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('connection:established', () => resolve())
      socket.once('connect_error', reject)
    })
    return socket
  }

  const serverCount = (): number => registry.byUser(USER, 'websocket').length
  const clientCount = (): number => clients.filter((socket) => socket.connected).length

  beforeEach(() => {
    clients = []
  })

  afterEach(async () => {
    for (const socket of clients) socket.disconnect()
    await app.close()
  })

  it('closes the oldest socket of a sixth connect with no option set, leaving five open', async () => {
    // Six connects leave five sockets open on both ends once the eviction has run; the evicted one
    // is the first, and the server told it so (a close, not just a registry removal).
    await boot()
    const first = await connect()
    const closed = new Promise<string>((resolve) => first.once('disconnect', resolve))
    for (let i = 0; i < 5; i += 1) await connect()

    await until('the first socket to be closed', () => !first.connected)
    expect(await closed).toBe('io server disconnect')
    expect(clientCount()).toBe(5)
    expect(serverCount()).toBe(5)
  })

  it('frees the slot of an evicted socket: a seventh connect evicts the second, not a fresh one', async () => {
    // The count stays at five through further connects, so an evicted socket gave its slot back.
    await boot()
    for (let i = 0; i < 7; i += 1) await connect()

    await until('two sockets to be closed', () => clientCount() === 5)
    expect(clients.slice(0, 2).every((socket) => !socket.connected)).toBe(true)
    expect(clients.slice(2).every((socket) => socket.connected)).toBe(true)
    expect(serverCount()).toBe(5)
  })

  it('honours an explicit cap above the default', async () => {
    await boot({ maxConnectionsPerUser: 7 })
    for (let i = 0; i < 7; i += 1) await connect()

    expect(serverCount()).toBe(7)
    expect(clientCount()).toBe(7)
  })

  it('keeps every socket when the cap is switched off with 0', async () => {
    // An explicit 0 disables the per-user connection cap.
    await boot({ maxConnectionsPerUser: 0 })
    for (let i = 0; i < 8; i += 1) await connect()

    expect(serverCount()).toBe(8)
    expect(clientCount()).toBe(8)
  })
})
