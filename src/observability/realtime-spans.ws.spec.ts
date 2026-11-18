/**
 * @fileoverview The spans a WebSocket application emits for real handshakes, over real Socket.IO clients.
 * @layer observability
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { trace } from '@opentelemetry/api'
import { recordSpans } from '../../test/support/recording-tracer'
import type { RecordedSpan } from '../../test/support/recording-tracer'
import { BymaxRealtimeWebSocketModule } from '../websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../websocket/transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

describe('spans around real WebSocket handshakes', () => {
  let app: INestApplication
  let url: string
  let spans: RecordedSpan[]
  let stop: () => void
  let authenticate: jest.Mock
  const sockets: Socket[] = []

  async function boot(options: Record<string, unknown> = {}, authenticated = true): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const recording = recordSpans()
    spans = recording.spans
    stop = recording.stop
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: {
            authenticate: (authenticate = jest.fn(
              async (ctx: { query: Record<string, unknown> }) =>
                authenticated ? { userId: String(ctx.query['u']), tenantId: 't1' } : null,
            )),
          },
          ...options,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.init()
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  }

  function connect(user: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false, query: { u: user } })
      sockets.push(socket)
      socket.on('connection:established', () => resolve())
      socket.on('connect_error', (err: Error) => reject(err))
    })
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    stop()
    jest.restoreAllMocks()
  })

  // Scenario: a handshake the authenticator accepts. Expected: one `realtime.handshake` span for WebSocket,
  // ended once, with no error and no user in it.
  it('records one handshake span for an accepted connection', async () => {
    await boot()
    await connect('user-secret-2')
    const handshakes = spans.filter((s) => s.name === 'realtime.handshake')
    expect(handshakes).toHaveLength(1)
    expect(handshakes[0]).toMatchObject({
      attributes: { 'bymax.realtime.transport': 'websocket' },
      ended: 1,
    })
    expect(handshakes[0]?.status).toBeUndefined()
    expect(JSON.stringify(spans)).not.toContain('user-secret-2')
  })

  // Scenario: the authenticator rejects the handshake. Expected: the span is ERROR with the library code, and
  // the client still gets its refusal.
  it('marks a rejected handshake as an error with the library code', async () => {
    await boot({}, false)
    await expect(connect('a')).rejects.toThrow('REALTIME_AUTH_FAILED')
    const handshake = spans.find((s) => s.name === 'realtime.handshake')
    expect(handshake?.status).toEqual({ code: 2, message: 'REALTIME_AUTH_FAILED' })
    expect(handshake?.ended).toBe(1)
  })

  // Scenario: a handshake past `maxConnections`. Expected: the span is ERROR with the transport-unavailable code.
  it('marks a handshake refused at the cap with the transport-unavailable code', async () => {
    await boot({ maxConnections: 1 })
    await connect('a')
    await expect(connect('b')).rejects.toThrow()
    const refused = spans.filter((s) => s.name === 'realtime.handshake')[1]
    expect(refused?.status).toEqual({ code: 2, message: 'REALTIME_TRANSPORT_UNAVAILABLE' })
  })

  // Scenario: the tracer provider throws before it runs the operation. Expected: the handshake is still
  // authenticated, once, and a rejected one is still refused; a tracing failure never decides the outcome.
  it.each([
    ['accepts an authenticated handshake', true],
    ['still refuses a rejected handshake', false],
  ])('%s when the tracer throws', async (_name, authenticated) => {
    await boot({}, authenticated)
    stop()
    trace.setGlobalTracerProvider({
      getTracer: () => ({
        startSpan: () => {
          throw new Error('tracer down')
        },
        startActiveSpan: () => {
          throw new Error('tracer down')
        },
      }),
    } as never)
    const outcome = connect('a').then(
      () => 'accepted',
      () => 'refused',
    )
    expect(await outcome).toBe(authenticated ? 'accepted' : 'refused')
    expect(authenticate).toHaveBeenCalledTimes(1)
    trace.disable()
  })
})
