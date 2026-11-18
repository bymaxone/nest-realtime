/**
 * @fileoverview The metrics a WebSocket application publishes after real handshakes, over real Socket.IO clients.
 * @layer observability
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { RealtimeMetricsTally } from '../server/observability/realtime-metrics-tally'
import { ConnectionRegistry } from '../server/services/connection-registry.service'
import { RealtimeService } from '../server/services/realtime.service'
import { BymaxRealtimeWebSocketModule } from '../websocket/realtime-websocket.module'
import { RealtimeIoAdapter } from '../websocket/transports/websocket/realtime-io-adapter'
import { WebSocketTransport } from '../websocket/transports/websocket/websocket.transport'
import { RealtimeMetrics } from './realtime-metrics'

jest.setTimeout(20_000)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function sample(registry: Registry, name: string, label: string): Promise<number> {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name)
  const found = metric?.values.find((v) => Object.values(v.labels).join() === label)
  return found?.value ?? Number.NaN
}

describe('metrics after real WebSocket handshakes', () => {
  let app: INestApplication
  let url: string
  let registry: Registry
  let service: RealtimeService
  let transport: WebSocketTransport
  let connections: ConnectionRegistry
  const sockets: Socket[] = []

  async function boot(options: Record<string, unknown> = {}, authenticated = true): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: {
            authenticate: async (ctx) =>
              authenticated ? { userId: String(ctx.query['u'] ?? 'a'), tenantId: 't1' } : null,
          },
          ...options,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    service = module.get(RealtimeService)
    transport = module.get(WebSocketTransport)
    connections = module.get(ConnectionRegistry)
    registry = new Registry()
    new RealtimeMetrics(module.get(RealtimeMetricsTally), connections).registerMetrics(registry)
  }

  /** Connect as `user`; resolves with the connection id, or rejects with the refusal's `data.code`. */
  function connect(user = 'a'): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false, query: { u: user } })
      sockets.push(socket)
      socket.on('connection:established', (hello: { connectionId: string }) =>
        resolve(hello.connectionId),
      )
      socket.on('connect_error', (err: Error & { data?: { code?: string } }) =>
        reject(new Error(err.data?.code ?? err.message)),
      )
    })
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close()
    await app.close()
    jest.restoreAllMocks()
  })

  // Scenario: one WebSocket connection is open. Expected: the gauge reads one on WebSocket and none on SSE.
  it('reads the open connections', async () => {
    await boot()
    await connect()
    expect(await sample(registry, 'bymax_realtime_connections', 'websocket')).toBe(1)
    expect(await sample(registry, 'bymax_realtime_connections', 'sse')).toBe(0)
  })

  // Scenario: a handshake past `maxConnections`. Expected: one refusal for `limit`.
  it('counts a handshake refused at the cap', async () => {
    await boot({ maxConnections: 1 })
    await connect('a')
    await expect(connect('b')).rejects.toThrow('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'limit')).toBe(1)
  })

  // Scenario: the authenticator rejects the handshake. Expected: one refusal for `unauthorized`.
  it('counts a handshake the authenticator rejected', async () => {
    await boot({}, false)
    await expect(connect()).rejects.toThrow('REALTIME_AUTH_FAILED')
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unauthorized')).toBe(
      1,
    )
  })

  // Scenario: a handshake once shutdown has begun. Expected: one refusal for `unavailable`.
  it('counts a handshake refused during shutdown', async () => {
    await boot()
    transport.onModuleDestroy()
    await expect(connect()).rejects.toThrow('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unavailable')).toBe(
      1,
    )
  })

  // Scenario: shutdown begins while the authenticator is answering. Expected: the handshake is refused and counted
  // as `unavailable`, the same as one that arrived after shutdown began.
  it('counts a handshake that shutdown overtook while it was authenticated', async () => {
    let begin: () => void = () => undefined
    await boot({
      authenticator: {
        authenticate: async () => {
          begin()
          return { userId: 'a', tenantId: 't1' }
        },
      },
    })
    begin = () => transport.onModuleDestroy()
    await expect(connect()).rejects.toThrow('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unavailable')).toBe(
      1,
    )
  })

  // Scenario: the authenticator never answers within the bound. Expected: one refusal for `unavailable`.
  it('counts a handshake the authenticator did not answer in time', async () => {
    await boot({
      authenticateTimeoutMs: 50,
      authenticator: { authenticate: () => new Promise(() => undefined) },
    })
    await expect(connect()).rejects.toThrow('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(await sample(registry, 'bymax_realtime_connections_refused_total', 'unavailable')).toBe(
      1,
    )
  })

  // Scenario: a user past `websocket.maxConnectionsPerUser`. Expected: one eviction for the cap and none
  // for a revocation, though the eviction closes the socket through the same path.
  it('counts an eviction for the per-user cap and not as a revocation', async () => {
    await boot({ websocket: { maxConnectionsPerUser: 1 } })
    await connect('a')
    await connect('a')
    await sleep(100)
    expect(await sample(registry, 'bymax_realtime_evictions_total', 'per_user_cap')).toBe(1)
    expect(await sample(registry, 'bymax_realtime_evictions_total', 'revoked')).toBe(0)
  })

  // Scenario: an event delivered, then a revocation. Expected: one delivery on WebSocket and one revocation.
  it('counts a delivery and a revocation', async () => {
    await boot()
    const id = await connect('a')
    await service.emitToUser('a', 'tick', { n: 1 })
    expect(await sample(registry, 'bymax_realtime_events_emitted_total', 'websocket')).toBe(1)
    await service.emitToTenant('t1', 'tick', { n: 2 })
    await service.emitToRoom('resource:thing:1', 'tick', { n: 3 })
    await service.broadcast('tick', { n: 4 })
    expect(await sample(registry, 'bymax_realtime_events_emitted_total', 'websocket')).toBe(4)
    await service.disconnect(id, 'REVOKED')
    expect(await sample(registry, 'bymax_realtime_evictions_total', 'revoked')).toBe(1)
  })
})
