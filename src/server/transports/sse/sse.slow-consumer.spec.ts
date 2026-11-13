/**
 * @fileoverview A client that stops reading must not be able to grow the server without bound.
 * @layer transport
 *
 * Over a real HTTP server, because the property is about what the socket accepts: a response that
 * is waiting for the client to drain keeps every later event queued in memory.
 */
import { connect } from 'node:net'
import type { Socket, AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { REALTIME_ERROR_CODES } from '../../../shared/constants/error-codes.constants'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import { BymaxRealtimeModule } from '../../realtime.module'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RealtimeService } from '../../services/realtime.service'

jest.setTimeout(60_000)

const EVENT_BYTES = 100_000
const ATTEMPTS = 600

describe('SSE: a client that never reads', () => {
  let app: INestApplication
  let client: Socket | undefined
  let service: RealtimeService
  let connections: ConnectionRegistry
  const reasons: Array<string | undefined> = []

  async function boot(sse: Record<string, unknown> = {}): Promise<number> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const hooks: IConnectionLifecycleHooks = {
      onDisconnect: (meta) => void reasons.push(meta.reason),
    }
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          hooks,
          sse,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    service = module.get(RealtimeService)
    connections = module.get(ConnectionRegistry)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  async function openStalledClient(port: number): Promise<void> {
    client = connect(port, '127.0.0.1')
    client.pause()
    client.write('GET /realtime/sse HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\n\r\n')
    for (let i = 0; i < 100 && connections.allByTransport('sse').length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(connections.allByTransport('sse')).toHaveLength(1)
  }

  /** Emit until the connection is gone; resolves with how many events it took, or `undefined`. */
  async function emitUntilClosed(): Promise<number | undefined> {
    const payload = { blob: 'x'.repeat(EVENT_BYTES) }
    for (let i = 1; i <= ATTEMPTS; i++) {
      await service.emitToUser('u1', 'big', payload)
      if (connections.allByTransport('sse').length === 0) return i
    }
    return undefined
  }

  afterEach(async () => {
    client?.destroy()
    client = undefined
    reasons.length = 0
    await app.close()
    jest.restoreAllMocks()
  })

  // Nothing bounded the queue behind a response that is waiting for the client to read: 60 MB of
  // events were accepted for one connection and it stayed registered.
  it('is closed, with a logged reason, once it falls too far behind', async () => {
    await openStalledClient(await boot())

    const closedAfter = await emitUntilClosed()

    expect(closedAfter).toBeDefined()
    expect(reasons).toStrictEqual([REALTIME_ERROR_CODES.SLOW_CONSUMER])
  })

  it('keeps a client that keeps up, whatever its total traffic', async () => {
    const port = await boot()
    client = connect(port, '127.0.0.1')
    client.on('data', () => undefined)
    client.write('GET /realtime/sse HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\n\r\n')
    for (let i = 0; i < 100 && connections.allByTransport('sse').length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    for (let i = 0; i < 200; i++) {
      await service.emitToUser('u1', 'big', { blob: 'x'.repeat(EVENT_BYTES) })
      await new Promise((resolve) => setImmediate(resolve))
    }

    expect(connections.allByTransport('sse')).toHaveLength(1)
  })
})
