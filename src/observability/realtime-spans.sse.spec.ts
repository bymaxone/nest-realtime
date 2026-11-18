/**
 * @fileoverview The spans an SSE application emits for real handshakes and re-authentication cycles.
 * @layer observability
 */
import { get } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { recordSpans } from '../../test/support/recording-tracer'
import type { RecordedSpan } from '../../test/support/recording-tracer'
import { BymaxRealtimeModule } from '../server/realtime.module'
import { ReauthenticationService } from '../server/services/reauthentication.service'

jest.setTimeout(20_000)

function open(port: number, user: string): Promise<{ status: number; req: ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = get(
      { host: '127.0.0.1', port, path: `/realtime/sse?u=${user}`, agent: false },
      (res) => {
        res.setEncoding('utf8')
        let body = ''
        res.on('data', (chunk: string) => {
          body += chunk
          if (res.statusCode === 200 && body.includes('connection:established')) {
            resolve({ status: 200, req })
          }
        })
        if (res.statusCode !== 200)
          res.on('end', () => resolve({ status: res.statusCode ?? 0, req }))
      },
    )
    req.on('error', reject)
  })
}

describe('spans around real SSE handshakes', () => {
  let app: INestApplication
  let port: number
  let spans: RecordedSpan[]
  let stop: () => void
  let reauth: ReauthenticationService
  const requests: ClientRequest[] = []

  async function boot(options: Record<string, unknown> = {}, authenticated = true): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const recording = recordSpans()
    spans = recording.spans
    stop = recording.stop
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: {
            authenticate: async (ctx) =>
              authenticated ? { userId: String(ctx.query['u']), tenantId: 't1' } : null,
          },
          ...options,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.init()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    reauth = module.get(ReauthenticationService)
  }

  async function connect(user: string): Promise<number> {
    const reply = await open(port, user)
    requests.push(reply.req)
    return reply.status
  }

  afterEach(async () => {
    for (const req of requests.splice(0)) req.destroy()
    await app.close()
    stop()
    jest.restoreAllMocks()
  })

  // Scenario: a handshake the authenticator accepts. Expected: one `realtime.handshake` span for SSE, ended once,
  // with no status error, and no user or tenant anywhere in it.
  it('records one handshake span for an accepted connection', async () => {
    await boot()
    expect(await connect('user-secret-1')).toBe(200)
    const handshakes = spans.filter((s) => s.name === 'realtime.handshake')
    expect(handshakes).toHaveLength(1)
    expect(handshakes[0]).toMatchObject({
      attributes: { 'bymax.realtime.transport': 'sse' },
      ended: 1,
    })
    expect(handshakes[0]?.status).toBeUndefined()
    expect(JSON.stringify(spans)).not.toContain('user-secret-1')
  })

  // Scenario: the authenticator rejects the handshake. Expected: the span is ERROR with the library code.
  it('marks a rejected handshake as an error with the library code', async () => {
    await boot({}, false)
    expect(await connect('a')).toBe(401)
    const handshake = spans.find((s) => s.name === 'realtime.handshake')
    expect(handshake?.status).toEqual({ code: 2, message: 'REALTIME_AUTH_FAILED' })
    expect(handshake?.ended).toBe(1)
  })

  // Scenario: a handshake past `maxConnections`. Expected: the span is ERROR with the transport-unavailable code.
  it('marks a handshake refused at the cap with the transport-unavailable code', async () => {
    await boot({ maxConnections: 1 })
    await connect('a')
    expect(await connect('b')).toBe(503)
    const refused = spans.filter((s) => s.name === 'realtime.handshake')[1]
    expect(refused?.status).toEqual({ code: 2, message: 'REALTIME_TRANSPORT_UNAVAILABLE' })
  })

  // Scenario: one re-authentication cycle. Expected: one `realtime.reauthenticate` span, ended once.
  it('records one span for a re-authentication cycle', async () => {
    await boot()
    await connect('a')
    await reauth.runCycle()
    const cycles = spans.filter((s) => s.name === 'realtime.reauthenticate')
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({ attributes: {}, ended: 1 })
  })
})
