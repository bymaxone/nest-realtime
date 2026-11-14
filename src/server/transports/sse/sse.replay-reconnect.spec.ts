/**
 * @fileoverview A client that reconnects with Last-Event-ID is replayed what it missed, within the
 * time the buffer keeps an idle user, over a real HTTP server.
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
import { RealtimeService } from '../../services/realtime.service'

jest.setTimeout(20_000)

interface Stream {
  readonly req: ClientRequest
  text(): string
  seen(needle: string): Promise<void>
}

function open(port: number, lastEventId?: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: '/realtime/sse',
        headers: {
          accept: 'text/event-stream',
          ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }),
        },
        agent: false,
      },
      (res) => {
        let text = ''
        const waiting: Array<{ needle: string; done: () => void }> = []
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          text += chunk
          for (const w of waiting.filter((x) => text.includes(x.needle))) w.done()
        })
        resolve({
          req,
          text: () => text,
          seen: (needle) =>
            new Promise<void>((done) => {
              if (text.includes(needle)) done()
              else waiting.push({ needle, done })
            }),
        })
      },
    )
    req.on('error', reject)
  })
}

/** The id of the event named `type` in what a stream has received. */
function idOf(text: string, type: string): string {
  return new RegExp(`event: ${type}\\nid: ([^\\n]+)`).exec(text)?.[1] ?? ''
}

describe('SSE reconnection within the time an idle user is kept', () => {
  let app: INestApplication
  let port: number
  let service: RealtimeService
  let connections: ConnectionRegistry
  const streams: Stream[] = []

  async function boot(replayTtlMs?: number): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          sse: { maxConnectionsPerUser: 0, ...(replayTtlMs === undefined ? {} : { replayTtlMs }) },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    service = module.get(RealtimeService)
    connections = module.get(ConnectionRegistry)
  }

  async function connect(lastEventId?: string): Promise<Stream> {
    const stream = await open(port, lastEventId)
    streams.push(stream)
    await stream.seen('connection:established')
    return stream
  }

  async function gone(): Promise<void> {
    for (let i = 0; i < 100 && connections.allByTransport('sse').length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(connections.allByTransport('sse')).toHaveLength(0)
  }

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.req.destroy()
    await app.close()
    jest.restoreAllMocks()
  })

  // The user's ring is the same one after the gap: opening on an idle entry revives it.
  it('replays the events emitted while the client was away, and then the live ones', async () => {
    await boot()
    const first = await connect()
    await service.emitToUser('u1', 'tick', { n: 1 })
    await first.seen('"n":1')
    const lastId = idOf(first.text(), 'tick')
    expect(lastId).not.toBe('')
    first.req.destroy()
    await gone()
    await service.emitToUser('u1', 'tick', { n: 2 })
    await service.emitToUser('u1', 'tick', { n: 3 })

    const second = await connect(lastId)
    await second.seen('"n":3')
    await service.emitToUser('u1', 'tick', { n: 4 })
    await second.seen('"n":4')

    const text = second.text()
    expect(text).not.toContain('"n":1')
    expect(text.indexOf('"n":2')).toBeLessThan(text.indexOf('"n":3'))
    expect(text.indexOf('"n":3')).toBeLessThan(text.indexOf('"n":4'))
  })

  it('replays nothing once the user has been away longer than the time', async () => {
    await boot(50)
    const first = await connect()
    await service.emitToUser('u1', 'tick', { n: 1 })
    await first.seen('"n":1')
    const lastId = idOf(first.text(), 'tick')
    first.req.destroy()
    await gone()
    await service.emitToUser('u1', 'tick', { n: 2 })
    await new Promise((resolve) => setTimeout(resolve, 120))

    const second = await connect(lastId)
    await service.emitToUser('u1', 'tick', { n: 3 })
    await second.seen('"n":3')

    expect(second.text()).not.toContain('"n":2')
  })
})
