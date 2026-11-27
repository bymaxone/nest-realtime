/**
 * @fileoverview End-to-end test of the per-user disconnect over real sockets.
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
import { RealtimeService } from '../../src/server/services/realtime.service'

/** Wait until the predicate holds, polling, or fail with the label after the timeout. */
async function until(label: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('WebSocket per-user disconnect (e2e)', () => {
  // Scenario: one user with two sockets and another with one. Expected: disconnectUser closes the
  // two, the server tells them so, and the third stays connected.
  it('closes every socket of one user and no other', async () => {
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: {
            authenticate: async (context) => ({
              userId: String(context.query['user']),
            }),
          },
        }),
      ],
    }).compile()
    const app: INestApplication = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    const clients: ClientSocket[] = []
    const connect = async (user: string): Promise<ClientSocket> => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        query: { user },
      })
      clients.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connection:established', () => resolve())
        socket.once('connect_error', reject)
      })
      return socket
    }
    try {
      const first = await connect('u1')
      const second = await connect('u1')
      const other = await connect('u2')
      const registry = app.get(ConnectionRegistry)
      expect(registry.byUser('u1')).toHaveLength(2)

      await app.get(RealtimeService).disconnectUser('u1')

      await until('the sockets of u1 to close', () => !first.connected && !second.connected)
      expect(other.connected).toBe(true)
      expect(registry.byUser('u2')).toHaveLength(1)
    } finally {
      for (const socket of clients) socket.disconnect()
      await app.close()
    }
  })
})
