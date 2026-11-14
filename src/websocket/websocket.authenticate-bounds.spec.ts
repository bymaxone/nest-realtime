/**
 * @fileoverview An authenticator that never answers must neither hold Socket.IO handshakes for ever
 * nor be asked again for every new one, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const TIMEOUT_MS = 300

describe('WebSocket handshakes with an authenticator that never answers', () => {
  let app: INestApplication
  let url: string
  let authenticate: jest.Mock
  const sockets: Socket[] = []

  /** Connect a client; resolve with the refusal it gets and how long that took. */
  function refused(): Promise<{ message: string; ms: number }> {
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false })
      sockets.push(socket)
      socket.on('connect', () => reject(new Error('connected')))
      socket.on('connect_error', (error) =>
        resolve({ message: error.message, ms: Date.now() - startedAt }),
      )
    })
  }

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    authenticate = jest.fn(() => new Promise(() => undefined))
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate },
          authenticateTimeoutMs: TIMEOUT_MS,
          maxPendingHandshakes: 2,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

  it('refuses the handshake with the generic error after authenticateTimeoutMs', async () => {
    const answer = await refused()

    expect(answer.message).toBe('Internal Server Error')
    expect(answer.ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 50)
    expect(answer.ms).toBeLessThan(TIMEOUT_MS * 8)
  })

  it('refuses a handshake at once, without asking, once abandoned calls fill the limit', async () => {
    await Promise.all([refused(), refused()])
    expect(authenticate).toHaveBeenCalledTimes(2)

    const third = await refused()

    expect(third.message).toBe('Internal Server Error')
    expect(third.ms).toBeLessThan(TIMEOUT_MS / 2)
    expect(authenticate).toHaveBeenCalledTimes(2)
  })
})
