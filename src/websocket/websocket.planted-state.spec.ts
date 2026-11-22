/**
 * @fileoverview A key planted on `Object.prototype` is not read by the WebSocket server as its own state, over real requests.
 * @layer transport
 *
 * engine.io and Socket.IO read some names off themselves that they set only on some paths: the server's cors
 * middleware, and the state of a socket, a client and a polling transport. A key planted under one of those names would
 * answer the read. The server instance is given an own key for the names it can hold; for the objects it creates per
 * connection, which cannot be given keys, a planted name is refused: at boot, and with a 500 before engine.io reads a
 * request, naming the field and never what it holds.
 */
import { EventEmitter } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'socket.io'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'
import { CONNECTION_STATE_NAMES } from './transports/websocket/server-option-names'

jest.setTimeout(30_000)

const SECRET = 'planted-secret-value'
const authenticator = { authenticate: async () => ({ userId: 'u1' }) }

/**
 * The root prototypes a planted key has to reach for the server to read it: this realm's, and the one that Node's own
 * classes (`EventEmitter`, which the servers extend) end in, which differs under a test runner that runs the code in a
 * realm of its own. In a plain process they are one.
 */
const ROOTS: object[] = [
  ...new Set<object>([Object.prototype, Object.getPrototypeOf(EventEmitter.prototype) as object]),
]

/** `values` planted on the root prototypes while `run` runs; they are taken away again when it settles. */
async function whilePlanted<T>(values: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  for (const root of ROOTS) {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(root, name, { value, configurable: true, writable: true })
    }
  }
  try {
    return await run()
  } finally {
    for (const root of ROOTS) {
      for (const name of Object.keys(values)) delete (root as Record<string, unknown>)[name]
    }
  }
}

interface Raw {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

/** One request, with the body kept as bytes. */
const raw = (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Raw> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })

describe('the WebSocket server, with a key planted as connection state', () => {
  let app: INestApplication
  let server: Server
  let port: number
  const HANDSHAKE = '/socket.io/?EIO=4&transport=polling'

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    // No `cors` option: the Socket.IO server never sets its cors middleware.
    server = new RealtimeIoAdapter(app).createIOServer(0, {} as never) as Server
    server.on('connection', (socket) => socket.emit('big', 'a'.repeat(6000)))
  })

  afterAll(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  const clients = (): number => (server.engine as unknown as { clientsCount: number }).clientsCount

  // Scenario: a function planted under `_corsMiddleware`, which Socket.IO calls on a request for its client file when it
  // holds one, and a server that has none. Expected: it is never called, and the answer is as it was.
  it('does not call a planted _corsMiddleware', async () => {
    const calls: unknown[] = []
    const baseline = await raw(port, 'GET', '/socket.io/socket.io.js')

    const planted = await whilePlanted(
      {
        _corsMiddleware: (_req: unknown, _res: unknown, next: () => void) => (
          calls.push('planted'),
          next()
        ),
      },
      () => raw(port, 'GET', '/socket.io/socket.io.js'),
    )

    expect(calls).toStrictEqual([])
    expect(planted.status).toBe(baseline.status)
  })

  // Scenario: the server just created, which set none of these itself. Expected: each name is an own key, holding
  // `undefined`, so no planted key can answer it.
  it.each([['_corsMiddleware'], ['_serveClient'], ['httpServer']])(
    'holds %s as its own',
    (name) => {
      expect(Object.hasOwn(server, name)).toBe(true)
    },
  )

  // Scenario: one of the connection-state names planted while a handshake is asked. Expected: a 500 that names the field
  // and not its value, and no connection is made.
  it.each([...CONNECTION_STATE_NAMES])('refuses a request with %s planted', async (name) => {
    const before = clients()

    const refused = await whilePlanted({ [name]: SECRET }, () => raw(port, 'GET', HANDSHAKE))

    expect(refused.status).toBe(500)
    expect(refused.body.toString()).toContain(name)
    expect(refused.body.toString()).not.toContain(SECRET)
    expect(JSON.parse(refused.body.toString())).toHaveProperty(
      'code',
      'REALTIME_TRANSPORT_UNAVAILABLE',
    )
    expect(clients()).toBe(before)
  })

  // Scenario: the same request once nothing is planted. Expected: answered, so the guard is not left refusing.
  it('answers a handshake when nothing is planted', async () => {
    const response = await raw(port, 'GET', HANDSHAKE)

    expect(response.status).toBe(200)
    expect(response.body.toString()).toContain('"sid"')
  })

  // Scenario: a name planted when the server is created. Expected: refused at boot with the library's code, naming the
  // field and not its value.
  it.each([['req'], ['writable']])('refuses to create a server with %s planted', async (name) => {
    const outcome = await whilePlanted({ [name]: SECRET }, async () => {
      try {
        new RealtimeIoAdapter(app).createIOServer(0, {} as never)
        return undefined
      } catch (error) {
        return error as Error & { code?: string }
      }
    })

    expect(outcome?.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(outcome?.message).toContain(name)
    expect(outcome?.message).not.toContain(SECRET)
  })

  /** Opens a polling connection, takes the first poll that the server compresses, and returns how long it is. */
  const compressedPoll = async (): Promise<{ encoding: unknown; length: number; text: string }> => {
    const open = await raw(port, 'GET', HANDSHAKE)
    const sid = (JSON.parse(open.body.toString().slice(1)) as { sid: string }).sid
    const path = `${HANDSHAKE}&sid=${sid}`
    await raw(port, 'POST', path, { 'Content-Type': 'text/plain' }, '40')
    const poll = await raw(port, 'GET', path, { 'Accept-Encoding': 'gzip' })
    const decoded = poll.headers['content-encoding'] === 'gzip' ? gunzipSync(poll.body) : poll.body
    return {
      encoding: poll.headers['content-encoding'],
      length: poll.body.length,
      text: decoded.toString(),
    }
  }

  // Scenario: zlib options planted while a long response is compressed: a level that stores the bytes and a window.
  // Expected: the response is compressed as without them.
  it('compresses a response as before with zlib options planted', async () => {
    const baseline = await compressedPoll()

    const planted = await whilePlanted({ level: 0, memLevel: 1, windowBits: 9 }, compressedPoll)

    expect(baseline.encoding).toBe('gzip')
    expect(baseline.text).toContain('aaaaaaaaaa')
    expect(planted.encoding).toBe('gzip')
    // The text holds a session id that differs per connection, so the lengths differ by a byte or two; a stored stream
    // (level 0) of the 6,000 bytes would be several thousand.
    expect(baseline.length).toBeLessThan(500)
    expect(planted.length).toBeLessThan(500)
  })
})
