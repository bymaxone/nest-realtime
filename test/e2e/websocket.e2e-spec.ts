/**
 * @fileoverview End-to-end tests for the WebSocket transport using socket.io-client.
 * @layer e2e
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AddressInfo } from 'node:net'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { RealtimeService } from '../../src/server/services/realtime.service'
import { ConnectionRegistry } from '../../src/server/services/connection-registry.service'
import { RealtimeIoAdapter } from '../../src/server/transports/websocket/realtime-io-adapter'
import type { IConnectionAuthenticator, ConnectionAuthContext, AuthenticationResult } from '../../src/server/interfaces/connection-authenticator.interface'

/** Build a mock authenticator that accepts any connection as the given auth result. */
function makeAuthenticator(result: AuthenticationResult | null = null): IConnectionAuthenticator {
  return {
    authenticate: jest.fn(async (ctx: ConnectionAuthContext): Promise<AuthenticationResult | null> => {
      // Validate ticket pattern if provided
      if (ctx.query['ticket'] === 'valid-ticket') {
        return { userId: 'ticket-user', tenantId: 'tenant-1' }
      }
      // Validate bearer token
      const authHeader = ctx.headers['authorization']
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        if (token === 'valid-token') return { userId: 'token-user', tenantId: 'tenant-1' }
        return null
      }
      return result
    }),
  }
}

async function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs)
    socket.once(event, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

async function waitForDisconnect(socket: ClientSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for disconnect')), timeoutMs)
    socket.once('disconnect', () => { clearTimeout(timer); resolve() })
  })
}

describe('WebSocket transport (e2e)', () => {
  let app: INestApplication
  let port: number
  let realtimeService: RealtimeService
  let registry: ConnectionRegistry
  let clients: ClientSocket[]

  beforeEach(async () => {
    clients = []
    const authenticator = makeAuthenticator({ userId: 'u-test', tenantId: 'tenant-1' })

    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'websocket',
          authenticator,
        }),
      ],
    }).compile()

    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.init()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    realtimeService = app.get(RealtimeService)
    registry = app.get(ConnectionRegistry)
  })

  afterEach(async () => {
    for (const c of clients) {
      if (c.connected) c.disconnect()
    }
    await app.close()
  })

  function connect(opts: { auth?: Record<string, string>; failOnError?: boolean } = {}) {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: opts.auth ?? { token: 'valid-token' },
      transports: ['websocket'],
      reconnection: false,
    })
    clients.push(socket)
    return socket
  }

  it('valid auth → receives connection:established', async () => {
    // After successful auth, the client receives the connection:established event.
    const socket = connect({ auth: { token: 'valid-token' } })
    const established = await waitForEvent<{ connectionId: string; traits: unknown }>(
      socket,
      'connection:established',
    )
    expect(established.connectionId).toBeDefined()
    expect((established.traits as { userId: string }).userId).toBe('token-user')
  })

  it('invalid auth → socket is disconnected', async () => {
    // Auth failure leads to immediate disconnect — no connection:established.
    const socket = connect({ auth: { token: 'bad-token' } })
    await waitForDisconnect(socket)
    expect(socket.connected).toBe(false)
  })

  it('emitToUser reaches a connected client', async () => {
    // RealtimeService.emitToUser delivers the event to the connected user.
    const socket = connect({ auth: { token: 'valid-token' } })
    const established = await waitForEvent<{ connectionId: string }>(socket, 'connection:established')
    expect(established.connectionId).toBeDefined()

    const received = waitForEvent<unknown>(socket, 'test-event')
    await realtimeService.emitToUser('token-user', 'test-event', { hello: 'ws' })
    expect(await received).toEqual({ hello: 'ws' })
  })

  it('auto-join user:{id} room — emitToUser reaches the client via room', async () => {
    // The client is auto-joined to user:{userId} on connect.
    const socket = connect({ auth: { token: 'valid-token' } })
    await waitForEvent<unknown>(socket, 'connection:established')

    const received = waitForEvent<unknown>(socket, 'room-evt')
    await realtimeService.emitToRoom('user:token-user', 'room-evt', 'payload')
    expect(await received).toBe('payload')
  })

  it('ticket pattern via io(url, { auth: { ticket } }) authenticates', async () => {
    // auth.ticket is surfaced into ctx.query.ticket by the gateway.
    const socket = connect({ auth: { ticket: 'valid-ticket' } })
    const established = await waitForEvent<{ traits: { userId: string } }>(
      socket,
      'connection:established',
    )
    expect(established.traits.userId).toBe('ticket-user')
  })

  it('client disconnect → registry is cleared', async () => {
    // After the client closes, the ConnectionRegistry entry is removed.
    const socket = connect({ auth: { token: 'valid-token' } })
    const established = await waitForEvent<{ connectionId: string }>(socket, 'connection:established')
    const connId = established.connectionId

    expect(registry.get(connId)).toBeDefined()

    socket.disconnect()
    // Allow the server a tick to process the disconnect
    await new Promise((r) => setTimeout(r, 200))

    expect(registry.get(connId)).toBeUndefined()
  })
})
