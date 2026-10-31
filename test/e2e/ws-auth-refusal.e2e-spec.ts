/**
 * @fileoverview End-to-end: a WebSocket handshake refusal is a `connect_error`, never a connection.
 * @layer e2e
 *
 * Constraint under test: authentication completes before Socket.IO accepts the connection, so a
 * refusal reaches the client as a `connect_error` carrying `REALTIME_AUTH_FAILED` in `data.code`
 * and the client does not reconnect on its own. The tests drive a real Nest application with real
 * Socket.IO clients over both transports, with authenticators that await a timer and a file read
 * first.
 */
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import type { IConnectionAuthenticator } from '../../src/server/interfaces/connection-authenticator.interface'
import { BymaxRealtimeWebSocketModule } from '../../src/websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../../src/websocket/transports/websocket/realtime-io-adapter'

/** Await what a real authenticator awaits before it decides: a timer tick and a file read. */
async function doIo(): Promise<void> {
  await sleep(0)
  await readFile(__filename)
  await sleep(25)
}

/** Close a client and wait for its engine, so no polling request outlives the server it talks to. */
async function closeClient(client: ClientSocket | undefined): Promise<void> {
  const engine = client?.io.engine
  if (!client || !engine || engine.readyState === 'closed') return
  const closed = new Promise<void>((resolve) => engine.once('close', () => resolve()))
  client.close()
  await closed
}

interface Outcome {
  events: string[]
  error?: (Error & { data?: { code?: string } }) | undefined
  active: boolean
}

describe.each([['websocket'], ['polling']])(
  'WebSocket handshake refusal after I/O, over %s (e2e)',
  (transport) => {
    let app: INestApplication | undefined
    let client: ClientSocket | undefined
    let errorSpy: jest.SpyInstance

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })

    afterEach(async () => {
      await closeClient(client)
      await app?.close()
      app = undefined
      client = undefined
      errorSpy.mockRestore()
    })

    /** Boot the application, connect once and collect what the client sees until it settles. */
    async function connectWith(authenticator: IConnectionAuthenticator): Promise<Outcome> {
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
      }).compile()
      app = moduleRef.createNestApplication()
      app.useWebSocketAdapter(new RealtimeIoAdapter(app))
      await app.listen(0)
      const { port } = app.getHttpServer().address() as AddressInfo

      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: [transport],
        reconnection: false,
      })
      client = socket
      const events: string[] = []
      const outcome = await new Promise<Outcome>((resolve) => {
        socket.on('connect', () => events.push('connect'))
        socket.on('disconnect', (reason) => events.push(`disconnect:${reason}`))
        socket.on('connect_error', (error: Outcome['error']) => {
          events.push('connect_error')
          resolve({ events, error, active: socket.active })
        })
        socket.on('connection:established', () => {
          events.push('connection:established')
          resolve({ events, active: socket.active })
        })
      })
      return outcome
    }

    // The contract: a refused handshake never becomes a connection, and the code is readable.
    it('refuses with connect_error carrying REALTIME_AUTH_FAILED when the authenticator refuses after I/O', async () => {
      const outcome = await connectWith({
        authenticate: async () => {
          await doIo()
          return null
        },
      })

      expect(outcome.events).toEqual(['connect_error'])
      expect(outcome.error?.message).toBe('REALTIME_AUTH_FAILED')
      expect(outcome.error?.data?.code).toBe('REALTIME_AUTH_FAILED')
      expect(outcome.active).toBe(false)
    })

    // A failure of the authenticator is not a refusal: no code, so a client can retry it.
    it('answers a generic connect_error with no code when the authenticator throws after I/O', async () => {
      const outcome = await connectWith({
        authenticate: async () => {
          await doIo()
          throw new Error('session store unreachable')
        },
      })

      expect(outcome.events).toEqual(['connect_error'])
      expect(outcome.error?.message).toBe('Internal Server Error')
      expect(outcome.error?.data?.code).toBeUndefined()
    })

    it('answers the same generic connect_error for a blank identity returned after I/O', async () => {
      const outcome = await connectWith({
        authenticate: async () => {
          await doIo()
          return { userId: '' }
        },
      })

      expect(outcome.events).toEqual(['connect_error'])
      expect(outcome.error?.message).toBe('Internal Server Error')
    })

    // Accepted credentials still connect, and the authenticator ran once for the handshake.
    it('connects and receives connection:established when the authenticator accepts after I/O', async () => {
      const authenticate = jest.fn(async () => {
        await doIo()
        return { userId: 'u-1', tenantId: 't-1' }
      })

      const outcome = await connectWith({ authenticate })

      expect(outcome.events).toEqual(['connect', 'connection:established'])
      expect(authenticate).toHaveBeenCalledTimes(1)
    })
  },
)
