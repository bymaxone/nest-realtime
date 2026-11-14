/**
 * @fileoverview End-to-end tests of the instance-wide connection bound on WebSocket, over real
 * sockets: a handshake past `maxConnections` is refused before the authenticator is asked.
 * @layer e2e
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { ConnectionRegistry } from '../../src/server/services/connection-registry.service'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

/** Resolve `connected` or `refused` for one client, whichever happens first. */
function outcome(
  socket: ClientSocket,
): Promise<{ kind: 'connected' } | { kind: 'refused'; message: string }> {
  return new Promise((resolve) => {
    socket.once('connection:established', () => resolve({ kind: 'connected' }))
    socket.once('connect_error', (err: Error) => resolve({ kind: 'refused', message: err.message }))
  })
}

describe('WebSocket global connection cap (e2e)', () => {
  let app: INestApplication
  let port: number
  let registry: ConnectionRegistry
  let authenticate: jest.Mock
  let clients: ClientSocket[]

  async function boot(maxConnections?: number): Promise<void> {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    authenticate = jest.fn(async () => ({ userId: `u${authenticate.mock.calls.length}` }))
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate },
          ...(maxConnections === undefined ? {} : { maxConnections }),
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

  async function connect() {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    return { socket, result: await outcome(socket) }
  }

  async function registered(count: number): Promise<void> {
    for (let i = 0; i < 200 && registry.count() !== count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(registry.count()).toBe(count)
  }

  beforeEach(() => {
    clients = []
  })

  afterEach(async () => {
    for (const socket of clients) socket.disconnect()
    await app.close()
    jest.restoreAllMocks()
  })

  it('refuses the handshake past the cap with the generic error, without asking the authenticator', async () => {
    await boot(2)
    expect((await connect()).result.kind).toBe('connected')
    expect((await connect()).result.kind).toBe('connected')
    expect(authenticate).toHaveBeenCalledTimes(2)

    const refused = await connect()

    expect(refused.result).toStrictEqual({ kind: 'refused', message: 'Internal Server Error' })
    expect(authenticate).toHaveBeenCalledTimes(2)
    expect(registry.count()).toBe(2)
  })

  it('admits the next handshake when one connection closes', async () => {
    await boot(2)
    const first = await connect()
    await connect()
    expect((await connect()).result.kind).toBe('refused')

    first.socket.disconnect()
    await registered(1)

    expect((await connect()).result.kind).toBe('connected')
    expect(registry.count()).toBe(2)
  })

  it('holds nothing after many connections have come and gone', async () => {
    // Twenty cycles at a cap of one: a place that was not given back would refuse the next.
    await boot(1)
    for (let i = 0; i < 20; i += 1) {
      const { socket, result } = await connect()
      expect(result.kind).toBe('connected')
      socket.disconnect()
      await registered(0)
    }

    expect((await connect()).result.kind).toBe('connected')
  })
})
