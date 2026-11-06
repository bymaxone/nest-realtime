/**
 * @fileoverview Closing an application that has an open WebSocket connection, over a real server.
 * @layer transport
 */
import { get } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

const CLOSE_WITHIN_MS = 5_000

// Longer than the bound, so a close that hangs fails with its own message and not the test's timeout.
jest.setTimeout(20_000)

/** Close the application, or fail with a message if it has not finished in time. */
async function closeWithin(app: INestApplication, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`app.close() did not finish within ${ms} ms`)), ms)
  })
  try {
    await Promise.race([app.close(), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

describe('closing an application with WebSocket connections', () => {
  let app: INestApplication
  let url: string
  let socket: Socket | undefined

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  })

  afterEach(() => {
    // A connection the test left open must not outlive a failed assertion.
    socket?.close()
    socket = undefined
    jest.restoreAllMocks()
  })

  // Control: nothing keeps the server open.
  it('closes within the bound when no connection is open', async () => {
    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()
  })

  // The same question as for SSE: does one open connection keep the close pending?
  it('closes within the bound, and disconnects the client, while a connection is open', async () => {
    socket = io(url, { transports: ['websocket'], reconnection: false })
    await new Promise<void>((resolve, reject) => {
      socket?.on('connection:established', () => resolve())
      socket?.on('connect_error', reject)
    })
    const disconnected = new Promise<void>((resolve) => socket?.on('disconnect', () => resolve()))

    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()

    await expect(disconnected).resolves.toBeUndefined()
  })
})

// transport 'both' also serves SSE, whose open streams have to end before the HTTP server can close.
describe("closing an application on transport 'both' with an open SSE stream", () => {
  let app: INestApplication
  let request: ClientRequest | undefined

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'both',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
  })

  afterEach(() => {
    request?.destroy()
    request = undefined
    jest.restoreAllMocks()
  })

  it('closes within the bound while a stream is open', async () => {
    const port = (app.getHttpServer().address() as AddressInfo).port
    await new Promise<void>((resolve, reject) => {
      request = get(
        {
          host: '127.0.0.1',
          port,
          path: '/realtime/sse',
          headers: { accept: 'text/event-stream' },
          agent: false,
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            text += chunk
            if (text.includes('connection:established')) resolve()
          })
        },
      )
      request.on('error', reject)
    })

    await expect(closeWithin(app, CLOSE_WITHIN_MS)).resolves.toBeUndefined()
  })
})

// A connection opened while a slow shutdown hook still holds the close back is the window in which an
// SSE stream would hold the HTTP server open; Socket.IO disconnects every socket when the server
// closes, so a late WebSocket connection cannot hold the close.
describe('a WebSocket connection opened while a slow shutdown hook holds the close back', () => {
  let app: INestApplication
  let url: string
  let socket: Socket | undefined
  let release: () => void
  let entered: Promise<void>

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const hold = new Promise<void>((resolve) => (release = resolve))
    let enter: () => void
    entered = new Promise<void>((resolve) => (enter = resolve))
    class SlowToShutDown {
      async beforeApplicationShutdown(): Promise<void> {
        enter()
        await hold
      }
    }
    const realtime = BymaxRealtimeWebSocketModule.forRoot({
      transport: 'websocket',
      authenticator: { authenticate: async () => ({ userId: 'u1' }) },
    })
    realtime.providers = [...(realtime.providers ?? []), SlowToShutDown]
    const module = await Test.createTestingModule({ imports: [realtime] }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  })

  afterEach(() => {
    socket?.close()
    socket = undefined
    jest.restoreAllMocks()
  })

  it('closes within the bound, and disconnects the client', async () => {
    const closing = app.close()
    await entered
    socket = io(url, { transports: ['websocket'], reconnection: false })
    await new Promise<void>((resolve, reject) => {
      socket?.on('connection:established', () => resolve())
      socket?.on('connect_error', reject)
    })
    const disconnected = new Promise<void>((resolve) => socket?.on('disconnect', () => resolve()))
    release()

    await expect(
      closeWithin({ close: () => closing } as INestApplication, CLOSE_WITHIN_MS),
    ).resolves.toBeUndefined()
    await expect(disconnected).resolves.toBeUndefined()
  })
})
