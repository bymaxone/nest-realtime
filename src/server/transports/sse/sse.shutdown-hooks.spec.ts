/**
 * @fileoverview Closing an application whose consumer's disconnect hook never settles, over a real
 * HTTP server with open SSE streams.
 * @layer transport
 */
import { get } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../../realtime.module'
import { ConnectionRegistry } from '../../services/connection-registry.service'

jest.setTimeout(30_000)

const HOOK_TIMEOUT_MS = 300
const STREAMS = 5

/** Open the SSE route and resolve once `connection:established` has arrived. */
function openStream(port: number): Promise<ClientRequest> {
  return new Promise((resolve, reject) => {
    const req = get(
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
          if (text.includes('connection:established')) resolve(req)
        })
      },
    )
    req.on('error', reject)
  })
}

describe('closing an application with SSE connections whose onDisconnect never settles', () => {
  let app: INestApplication
  const streams: ClientRequest[] = []

  afterEach(() => {
    for (const stream of streams.splice(0)) stream.destroy()
    jest.restoreAllMocks()
  })

  // Nest awaits the HTTP server's close, which waits for every open stream, before it runs the later
  // shutdown hooks: a hook that holds a stream open holds the application.
  it('closes within a few hook timeouts, and ends every stream', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const hooks = { onDisconnect: (): Promise<void> => new Promise<void>(() => undefined) }
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          hooks,
          hookTimeoutMs: HOOK_TIMEOUT_MS,
          sse: { maxConnectionsPerUser: 0 },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    for (let i = 0; i < STREAMS; i++) streams.push(await openStream(port))
    const connections = module.get(ConnectionRegistry)
    expect(connections.allByTransport('sse')).toHaveLength(STREAMS)
    const startedAt = Date.now()

    await app.close()

    expect(Date.now() - startedAt).toBeLessThan(HOOK_TIMEOUT_MS * 5)
    expect(connections.allByTransport('sse')).toHaveLength(0)
  })
})
