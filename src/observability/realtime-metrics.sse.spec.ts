/**
 * @fileoverview The metrics an SSE application publishes after real handshakes, over a real HTTP server.
 * @layer observability
 */
import { get } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'
import { BymaxRealtimeModule } from '../server/realtime.module'
import { RealtimeMetricsTally } from '../server/observability/realtime-metrics-tally'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import { RealtimeService } from '../server/services/realtime.service'
import { SseTransport } from '../server/transports/sse/sse.transport'
import { RealtimeMetrics } from './realtime-metrics'

jest.setTimeout(20_000)

interface Reply {
  readonly status: number
  readonly req: ClientRequest
}

/** Open the stream and resolve with what the server answered first. */
function open(port: number, user: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: `/realtime/sse?u=${user}`,
        headers: { accept: 'text/event-stream' },
        agent: false,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
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

async function sample(registry: Registry, name: string, label: string): Promise<number> {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name)
  const found = metric?.values.find((v) => Object.values(v.labels).join() === label)
  return found?.value ?? Number.NaN
}

describe('metrics after real SSE handshakes', () => {
  let app: INestApplication
  let port: number
  let registry: Registry
  let connections: ConnectionRegistry
  let service: RealtimeService
  let transport: SseTransport
  const replies: Reply[] = []

  async function boot(options: Record<string, unknown> = {}, authenticated = true): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
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
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    connections = module.get(ConnectionRegistry)
    service = module.get(RealtimeService)
    transport = module.get(SseTransport)
    registry = new Registry()
    new RealtimeMetrics(module.get(RealtimeMetricsTally), connections).registerMetrics(registry)
  }

  async function connect(user: string): Promise<Reply> {
    const reply = await open(port, user)
    if (reply.status === 200) replies.push(reply)
    return reply
  }

  afterEach(async () => {
    for (const reply of replies.splice(0)) reply.req.destroy()
    await app.close()
    jest.restoreAllMocks()
  })

  // Scenario: two connections are open. Expected: the gauge reads two on SSE and none on WebSocket.
  it('reads the open connections', async () => {
    await boot()
    await connect('a')
    await connect('b')
    expect(await sample(registry, 'bymax_realtime_connections', 'sse')).toBe(2)
    expect(await sample(registry, 'bymax_realtime_connections', 'websocket')).toBe(0)
  })

  // Scenario: a handshake past `maxConnections`. Expected: one refusal for `limit`.
  it('counts a handshake refused at the cap', async () => {
    await boot({ maxConnections: 1 })
    await connect('a')
    expect((await connect('b')).status).toBe(503)
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'limit')).toBe(1)
  })

  // Scenario: the authenticator rejects the handshake. Expected: one refusal for `unauthorized`.
  it('counts a handshake the authenticator rejected', async () => {
    await boot({}, false)
    expect((await connect('a')).status).toBe(401)
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unauthorized')).toBe(
      1,
    )
  })

  // Scenario: the authenticator answers with an HTTP exception or an error of its own. Expected: only a 401 is a
  // refusal for `unauthorized`; a 403 and an unexpected error are neither.
  it.each([
    ['a 401', () => new UnauthorizedException(), 401, 1],
    ['a 403', () => new ForbiddenException(), 403, 0],
    ['an unexpected error', () => new Error('boom'), 500, 0],
  ])(
    'counts %s from the authenticator as unauthorized only when it is a 401',
    async (_name, make, status, counted) => {
      await boot({
        authenticator: {
          authenticate: async () => {
            throw make()
          },
        },
      })
      expect((await connect('a')).status).toBe(status)
      expect(
        await sample(registry, 'bymax_realtime_connections_refused_total', 'unauthorized'),
      ).toBe(counted)
    },
  )

  // Scenario: a handshake once shutdown has begun. Expected: one refusal for `unavailable`.
  it('counts a handshake refused during shutdown', async () => {
    await boot()
    transport.onModuleDestroy()
    expect((await connect('a')).status).toBe(503)
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unavailable')).toBe(
      1,
    )
  })

  // Scenario: the authenticator never answers within the bound. Expected: a 503 and one refusal for `unavailable`.
  it('counts a handshake the authenticator did not answer in time', async () => {
    await boot({
      authenticateTimeoutMs: 50,
      authenticator: { authenticate: () => new Promise(() => undefined) },
    })
    expect((await connect('a')).status).toBe(503)
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unavailable')).toBe(
      1,
    )
  })

  // Scenario: a user past `maxConnectionsPerUser`, an event delivered and a revocation. Expected: each is counted
  // once, under its own closed reason.
  it('counts evictions, revocations and deliveries', async () => {
    await boot({ sse: { maxConnectionsPerUser: 1 } })
    await connect('a')
    await connect('a')
    expect(await sample(registry, 'bymax_realtime_evictions_total', 'per_user_cap')).toBe(1)
    await service.emitToUser('a', 'tick', { n: 1 })
    expect(await sample(registry, 'bymax_realtime_events_emitted_total', 'sse')).toBe(1)
    const [live] = connections.allByTransport('sse')
    await service.disconnect(live!.connectionId, 'REVOKED')
    expect(await sample(registry, 'bymax_realtime_evictions_total', 'revoked')).toBe(1)
  })
})
