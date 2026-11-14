/**
 * @fileoverview The instance-wide connection bound on SSE, over a real HTTP server: a handshake past
 * `maxConnections` is refused before the authenticator is asked, and the room comes back when a
 * connection closes.
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

jest.setTimeout(20_000)

interface Reply {
  readonly status: number
  readonly body: string
  readonly req: ClientRequest
}

/** Open the stream and resolve with what the server answered first. */
function open(port: number): Promise<Reply> {
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
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          if (res.statusCode === 200 && body.includes('connection:established')) {
            resolve({ status: 200, body, req })
          }
        })
        if (res.statusCode !== 200) {
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body, req }))
        }
      },
    )
    req.on('error', reject)
  })
}

describe('SSE connection cap (maxConnections)', () => {
  let app: INestApplication
  let port: number
  let connections: ConnectionRegistry
  let authenticate: jest.Mock
  const open$: Reply[] = []

  async function boot(maxConnections?: number): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    authenticate = jest.fn(async () => ({ userId: `u${authenticate.mock.calls.length}` }))
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate },
          ...(maxConnections === undefined ? {} : { maxConnections }),
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    connections = module.get(ConnectionRegistry)
  }

  async function connect(): Promise<Reply> {
    const reply = await open(port)
    if (reply.status === 200) open$.push(reply)
    return reply
  }

  async function registered(count: number): Promise<void> {
    for (let i = 0; i < 200 && connections.count() !== count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(connections.count()).toBe(count)
  }

  afterEach(async () => {
    for (const reply of open$.splice(0)) reply.req.destroy()
    await app.close()
    jest.restoreAllMocks()
  })

  it('refuses the handshake past the cap with a 503, without asking the authenticator', async () => {
    await boot(2)
    expect((await connect()).status).toBe(200)
    expect((await connect()).status).toBe(200)
    expect(authenticate).toHaveBeenCalledTimes(2)

    const refused = await connect()

    expect(refused.status).toBe(503)
    expect(refused.body).not.toContain('connections')
    expect(authenticate).toHaveBeenCalledTimes(2)
    expect(connections.count()).toBe(2)
  })

  it('admits the next handshake when one connection closes', async () => {
    await boot(2)
    const first = await connect()
    await connect()
    expect((await connect()).status).toBe(503)

    first.req.destroy()
    await registered(1)

    expect((await connect()).status).toBe(200)
    expect(connections.count()).toBe(2)
  })

  it('holds nothing after many connections have come and gone', async () => {
    // Twenty cycles at a cap of one: a place that was not given back would refuse the next.
    await boot(1)
    for (let i = 0; i < 20; i += 1) {
      const reply = await connect()
      expect(reply.status).toBe(200)
      reply.req.destroy()
      open$.splice(open$.indexOf(reply), 1)
      await registered(0)
    }

    expect((await connect()).status).toBe(200)
  })

  it('admits a connection when the option is not set', async () => {
    await boot()
    expect((await connect()).status).toBe(200)
  })
})
