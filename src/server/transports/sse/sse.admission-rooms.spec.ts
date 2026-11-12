/**
 * @fileoverview Rooms an authenticator returns are joined at admission, over a real HTTP server.
 * @layer transport
 */
import { get } from 'node:http'
import type { ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { AuthenticationResult } from '../../interfaces/connection-authenticator.interface'
import type { IConnectionLifecycleHooks } from '../../interfaces/connection-lifecycle-hooks.interface'
import { BymaxRealtimeModule } from '../../realtime.module'
import { ConnectionRegistry } from '../../services/connection-registry.service'
import { RealtimeService } from '../../services/realtime.service'
import { RoomRegistry } from '../../services/room-registry.service'

jest.setTimeout(20_000)

const ROOM = 'workspace:w1'

interface Stream {
  readonly req: ClientRequest
  /** Everything the server has written to the stream so far. */
  text(): string
  /** Resolves once the stream's text contains `needle`. */
  seen(needle: string): Promise<void>
}

function openStream(port: number): Promise<Stream> {
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

/** Resolves once `release` is called; `entered` resolves when the hook starts. */
function gate(): { entered: Promise<void>; release: () => void; hook: () => Promise<void> } {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const held = new Promise<void>((resolve) => (release = resolve))
  return {
    entered,
    release,
    hook: async () => {
      enter()
      await held
    },
  }
}

describe('SSE: a room an authenticator returns is joined at admission', () => {
  let app: INestApplication
  let port: number
  let service: RealtimeService
  let connections: ConnectionRegistry
  let roomRegistry: RoomRegistry
  let stream: Stream | undefined

  async function boot(
    authenticate: () => Promise<AuthenticationResult | null>,
    hooks: IConnectionLifecycleHooks,
  ): Promise<void> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator: { authenticate }, hooks }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    service = module.get(RealtimeService)
    connections = module.get(ConnectionRegistry)
    roomRegistry = module.get(RoomRegistry)
  }

  afterEach(async () => {
    stream?.req.destroy()
    stream = undefined
    await app.close()
    jest.restoreAllMocks()
  })

  // Characterizes the window `rooms` closes: onConnect is not awaited, so the connection is live before the host's join runs.
  // A publish made in that interval is missed for good, because room events have no replay.
  it('misses a publish made while a join from onConnect is still pending', async () => {
    const hold = gate()
    await boot(async () => ({ userId: 'u1' }), {
      onConnect: async (meta) => {
        await hold.hook()
        await service.joinRoom(meta.connectionId, ROOM)
      },
    })
    stream = await openStream(port)
    await stream.seen('connection:established')
    await hold.entered

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    hold.release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await service.emitToRoom(ROOM, 'scoped', { n: 2 })
    await stream.seen('"n":2')

    expect(stream.text()).not.toContain('"n":1')
  })

  it('delivers a publish made while onConnect has not finished, to a room in `rooms`', async () => {
    const hold = gate()
    await boot(async () => ({ userId: 'u1', rooms: [ROOM] }), { onConnect: hold.hook })
    stream = await openStream(port)
    await stream.seen('connection:established')
    await hold.entered

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    await stream.seen('"n":1')
    hold.release()
  })

  // Duplicates join once, the registry holds the room, and the original result keeps the list.
  it('joins a duplicated room once and keeps the list on the connection record', async () => {
    await boot(async () => ({ userId: 'u1', rooms: [ROOM, ROOM, 'other'] }), {})
    stream = await openStream(port)
    await stream.seen('connection:established')

    const [record] = connections.byUser('u1', 'sse')
    expect(record?.originalAuth.rooms).toStrictEqual([ROOM, ROOM, 'other'])
    expect(roomRegistry.members(ROOM)).toStrictEqual([record?.connectionId])

    await service.emitToRoom(ROOM, 'scoped', { n: 1 })
    await service.emitToRoom('other', 'scoped', { n: 2 })
    await stream.seen('"n":2')
    expect(stream.text().match(/"n":1/g)).toHaveLength(1)
  })

  it('leaves no room behind when the connection closes', async () => {
    await boot(async () => ({ userId: 'u1', rooms: [ROOM] }), {})
    stream = await openStream(port)
    await stream.seen('connection:established')
    stream.req.destroy()
    while (roomRegistry.members(ROOM).length > 0) await new Promise((r) => setTimeout(r, 10))

    expect(roomRegistry.members(ROOM)).toStrictEqual([])
  })

  it('refuses a connection whose rooms break the rules with a 500, and registers nothing', async () => {
    await boot(async () => ({ userId: 'u1', rooms: ['tenant:t2'] }), {})
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = get(
        {
          host: '127.0.0.1',
          port,
          path: '/realtime/sse',
          headers: { accept: 'text/event-stream' },
          agent: false,
        },
        (res) => {
          resolve(res.statusCode)
          res.resume()
        },
      )
      req.on('error', reject)
    })

    expect(status).toBe(500)
    expect(connections.byUser('u1', 'sse')).toHaveLength(0)
  })
})
