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
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server, Socket } from 'socket.io'
import { io as ioClient } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

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
      Object.defineProperty(root, name, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      })
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

/** Runs `run` with `name` on `Object.prototype` set to `value` on both root prototypes, and puts each original back. */
function whileOverwrittenSync<T>(name: string, value: unknown, run: () => T): T {
  const before = ROOTS.map(
    (root) => Object.getOwnPropertyDescriptor(root, name) as PropertyDescriptor,
  )
  for (const root of ROOTS)
    Object.defineProperty(root, name, { ...before[ROOTS.indexOf(root)], value })
  try {
    return run()
  } finally {
    ROOTS.forEach((root, index) =>
      Object.defineProperty(root, name, before[index] as PropertyDescriptor),
    )
  }
}

/** The same for a call that settles later. */
async function whileOverwritten<T>(
  name: string,
  value: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const before = ROOTS.map(
    (root) => Object.getOwnPropertyDescriptor(root, name) as PropertyDescriptor,
  )
  for (const root of ROOTS)
    Object.defineProperty(root, name, { ...before[ROOTS.indexOf(root)], value })
  try {
    return await run()
  } finally {
    ROOTS.forEach((root, index) =>
      Object.defineProperty(root, name, before[index] as PropertyDescriptor),
    )
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
  let app: INestApplication | undefined
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
    server = new RealtimeIoAdapter(app as INestApplication).createIOServer(0, {} as never) as Server
    server.on('connection', (socket) => socket.emit('big', 'a'.repeat(6000)))
  })

  afterAll(async () => {
    // A setup that failed leaves nothing to close, and closing it would hide the failure behind its own.
    await app?.close()
    jest.restoreAllMocks()
  })

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

  // Scenario: the same request once nothing is planted. Expected: answered, so the guard is not left refusing.
  it('answers a handshake when nothing is planted', async () => {
    const response = await raw(port, 'GET', HANDSHAKE)

    expect(response.status).toBe(200)
    expect(response.body.toString()).toContain('"sid"')
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

  // Scenario: a long polling response, with the server clean. Expected: it is compressed, so the compression keys the server
  // options carry did not break the defaults they stand beside.
  it('compresses a long polling response', async () => {
    const poll = await compressedPoll()

    expect(poll.encoding).toBe('gzip')
    expect(poll.text).toContain('aaaaaaaaaa')
    expect(poll.length).toBeLessThan(500)
  })
})

/** A port nothing listens on now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })

describe('the WebSocket server, with a key planted after a client connected', () => {
  let app: INestApplication | undefined
  let server: Server
  let port: number
  let client: ClientSocket | undefined
  const connected: Socket[] = []

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    app = module.createNestApplication()
    // The module's own gateway starts a server on the application's HTTP server, which would take the upgrades; this one
    // listens on a port of its own.
    port = await freePort()
    server = new RealtimeIoAdapter(app).createIOServer(port, {} as never) as Server
    server.on('connection', (socket) => connected.push(socket))
  })

  afterEach(() => {
    client?.close()
    client = undefined
    connected.length = 0
  })

  afterAll(async () => {
    await server?.close()
    // A setup that failed leaves nothing to close, and closing it would hide the failure behind its own.
    await app?.close()
    jest.restoreAllMocks()
  })

  /** Connects a client over WebSocket and waits until the server has the connection. */
  const connect = async (): Promise<ClientSocket> => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    })
    client = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', reject)
    })
    for (let waited = 0; connected.length === 0; waited += 10) {
      if (waited >= 3000) throw new Error('the server never reported the connection')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return socket
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150))

  // Scenario: a listener list planted under `_anyListeners` once the connection exists, and the client sends an event.
  // Expected: the planted listener is never called; the guard refuses new requests, but a connection made before the
  // key was planted has to be safe on its own.
  it('does not call a planted _anyListeners on an event of an open connection', async () => {
    const calls: unknown[] = []
    const socket = await connect()

    await whilePlanted({ _anyListeners: [() => calls.push('planted')] }, async () => {
      socket.emit('probe')
      await settle()
    })

    expect(calls).toStrictEqual([])
  })

  // Scenario: the same for what the server sends, which Socket.IO passes to `_anyOutgoingListeners`.
  it('does not call a planted _anyOutgoingListeners on an event the server sends', async () => {
    const calls: unknown[] = []
    await connect()

    await whilePlanted({ _anyOutgoingListeners: [() => calls.push('planted')] }, async () => {
      ;(connected[0] as Socket).emit('probe', 1)
      await settle()
    })

    expect(calls).toStrictEqual([])
  })

  // Scenario: a namespace made after the server was created, which a socket joins over WebSocket, and a key planted once it
  // is connected. Expected: the same as for the main namespace, since every namespace gives its sockets their own state.
  it('does not call a planted _anyListeners on a socket of a namespace made later', async () => {
    const calls: unknown[] = []
    const sockets: Socket[] = []
    server.of('/chat').on('connection', (socket) => sockets.push(socket))
    const socket = ioClient(`http://127.0.0.1:${port}/chat`, {
      transports: ['websocket'],
      reconnection: false,
    })
    client = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', reject)
    })
    for (let waited = 0; sockets.length === 0; waited += 10) {
      if (waited >= 3000) throw new Error('the namespace never reported the connection')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    await whilePlanted({ _anyListeners: [() => calls.push('planted')] }, async () => {
      socket.emit('probe')
      await settle()
    })

    expect(calls).toStrictEqual([])
  })

  // Scenario: a connection over polling, where every event is a request, and a key planted once it is connected.
  // Expected: the request is refused by the guard, so the planted listener is not called either.
  it('does not call a planted _anyListeners on an event of a polling connection', async () => {
    const calls: unknown[] = []
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['polling'],
      reconnection: false,
    })
    client = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', reject)
    })

    await whilePlanted({ _anyListeners: [() => calls.push('planted')] }, async () => {
      socket.emit('probe')
      await settle()
    })

    expect(calls).toStrictEqual([])
  })

  // Scenario: the host registers its own listeners for every event, in both directions, on a socket that was given its own
  // lazy state. Expected: its listeners are called.
  it('still calls the listeners the host registered', async () => {
    const calls: string[] = []
    const socket = await connect()
    const serverSide = connected[0] as Socket
    serverSide.onAny(() => calls.push('incoming'))
    serverSide.onAnyOutgoing(() => calls.push('outgoing'))

    socket.emit('probe')
    serverSide.emit('probe', 1)
    await settle()

    expect(calls.sort()).toStrictEqual(['incoming', 'outgoing'])
  })
})

describe('the WebSocket server, with a key planted after a session was recovered', () => {
  let app: INestApplication | undefined
  let server: Server
  let port: number
  let client: ClientSocket | undefined
  const connected: Socket[] = []

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    app = module.createNestApplication()
    port = await freePort()
    // With `skipMiddlewares` Socket.IO does not run the namespace middleware for a socket whose session it recovers.
    server = new RealtimeIoAdapter(app).createIOServer(port, {
      connectionStateRecovery: { maxDisconnectionDuration: 60_000, skipMiddlewares: true },
    } as never) as Server
    // An event with an offset is what a client needs to have received for its session to be recovered. Only the first
    // socket sends it: the client of the test reads its own listeners off the planted key, so an event that reached it
    // from the recovered socket during the plant would be counted as the server's.
    server.on('connection', (socket) => {
      if (connected.push(socket) === 1) socket.emit('hello', 1)
    })
  })

  afterEach(() => {
    client?.close()
    client = undefined
    connected.length = 0
  })

  afterAll(async () => {
    await server?.close()
    // A setup that failed leaves nothing to close, and closing it would hide the failure behind its own.
    await app?.close()
    jest.restoreAllMocks()
  })

  // Scenario: a client connects, loses its transport, and reconnects with its session recovered; a key is planted once the
  // recovered socket exists and the client sends an event. Expected: the planted listener is never called, though no
  // namespace middleware ran for the recovered socket.
  it('does not call a planted _anyListeners on an event of a recovered socket', async () => {
    const calls: unknown[] = []
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnectionDelay: 50,
      reconnectionDelayMax: 50,
    })
    client = socket
    await new Promise<void>((resolve) => socket.once('hello', () => resolve()))
    socket.io.engine.close()
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    for (let waited = 0; connected.length < 2; waited += 10) {
      if (waited >= 3000) throw new Error('the session was never reported as reconnected')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    expect(socket.recovered).toBe(true)
    expect((connected[1] as Socket).recovered).toBe(true)
    await whilePlanted({ _anyListeners: [() => calls.push('planted')] }, async () => {
      socket.emit('probe')
      await new Promise((resolve) => setTimeout(resolve, 150))
    })

    expect(calls).toStrictEqual([])
  })
})

/** Names a package reads off an object it copies, one that crashes the process, one that breaks an upgrade, and one nothing reads. */
const ANY_NAME = ['reconstructor', 'clients', 'zzNotAKnownName'] as const

describe('the WebSocket server, with any key planted outside the standard set', () => {
  let app: INestApplication | undefined
  let server: Server
  let port: number
  let client: ClientSocket | undefined
  const connected: Socket[] = []
  const HANDSHAKE = '/socket.io/?EIO=4&transport=polling'

  /** The parser of the server under test, whose decoders hold their lazy names, so the client of the test does not read a planted one. */
  const clientParser = (): never => (server as unknown as { _parser: never })._parser

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    app = module.createNestApplication()
    port = await freePort()
    server = new RealtimeIoAdapter(app).createIOServer(port, {} as never) as Server
    server.on('connection', (socket) => connected.push(socket))
  })

  afterEach(() => {
    client?.close()
    client = undefined
    connected.length = 0
  })

  afterAll(async () => {
    await server?.close()
    // A setup that failed leaves nothing to close, and closing it would hide the failure behind its own.
    await app?.close()
    jest.restoreAllMocks()
  })

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200))

  // Scenario: a key outside the standard set planted after boot, and a request. Expected: a 500 that says how many keys and
  // names neither them nor their values, and no connection is made.
  it.each(ANY_NAME)(
    'answers a request with %s planted by a 500 that names only a count',
    async (name) => {
      const before = (server.engine as unknown as { clientsCount: number }).clientsCount

      const refused = await whilePlanted({ [name]: SECRET }, () => raw(port, 'GET', HANDSHAKE))

      expect(refused.status).toBe(500)
      expect(JSON.parse(refused.body.toString())).toStrictEqual({
        code: 'REALTIME_TRANSPORT_UNAVAILABLE',
        count: 1,
      })
      expect(refused.body.toString()).not.toContain(name)
      expect(refused.body.toString()).not.toContain(SECRET)
      expect((server.engine as unknown as { clientsCount: number }).clientsCount).toBe(before)
    },
  )

  // Scenario: a key outside the standard set when the server is created. Expected: refused with the library's code, saying how
  // many and naming neither the keys nor their values.
  it.each(ANY_NAME)('refuses to create a server with %s planted', async (name) => {
    const outcome = await whilePlanted({ [name]: SECRET }, async () => {
      try {
        new RealtimeIoAdapter(app as INestApplication).createIOServer(0, {} as never)
        return undefined
      } catch (error) {
        return error as Error & { code?: string }
      }
    })

    expect(outcome?.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
    expect(outcome?.message).toMatch(/\b1 change\b/)
    expect(outcome?.message).not.toContain(name)
    expect(outcome?.message).not.toContain(SECRET)
  })

  // Scenario: a standard name overwritten after boot (`hasOwnProperty = 1` ended the process on the next request, because
  // engine.io calls it). Expected: refused like any other planted key, with a count and nothing else.
  it.each(['hasOwnProperty', 'toString', 'constructor'])(
    'answers a request with %s overwritten by a 500 that names only a count',
    async (name) => {
      const refused = await whileOverwritten(name, 1, () => raw(port, 'GET', HANDSHAKE))

      expect(refused.status).toBe(500)
      expect(JSON.parse(refused.body.toString())).toStrictEqual({
        code: 'REALTIME_TRANSPORT_UNAVAILABLE',
        count: 1,
      })
      expect(refused.body.toString()).not.toContain(name)
    },
  )

  it.each(['hasOwnProperty', 'toString', 'constructor'])(
    'refuses to create a server with %s overwritten',
    (name) => {
      const outcome = whileOverwrittenSync(name, 1, () => {
        try {
          new RealtimeIoAdapter(app as INestApplication).createIOServer(0, {} as never)
          return undefined
        } catch (error) {
          return error as Error & { code?: string }
        }
      })

      expect(outcome?.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
      expect(outcome?.message).toMatch(/\b1 change\b/)
    },
  )

  // Scenario: a client is connected, a standard name is overwritten, and a text event arrives on that connection. The event is
  // handed to the server's side of the connection directly, since the client library of the test calls the overwritten
  // names too. Expected: the connection is closed without the process ending, and the event is not delivered.
  it.each(['hasOwnProperty', 'toString'])(
    'closes an open connection that receives an event with %s overwritten',
    async (name) => {
      const calls: unknown[] = []
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      })
      client = socket
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('connect_error', reject)
      })
      for (let waited = 0; connected.length === 0; waited += 10) {
        if (waited >= 3000) throw new Error('the server never reported the connection')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const serverSide = connected[0] as Socket
      serverSide.on('probe', () => calls.push('received'))
      const engineSocket = serverSide.conn as unknown as {
        onPacket: (packet: { type: string; data: string }) => void
      }

      await whileOverwritten(name, 1, async () => {
        engineSocket.onPacket({ type: 'message', data: '2["probe","a text event"]' })
        await settle()
      })

      expect(calls).toStrictEqual([])
      expect(serverSide.connected).toBe(false)
    },
  )

  // Scenario: a WebSocket upgrade with the key planted. Expected: refused, so the client does not connect and nothing
  // is read off the planted key.
  it.each(ANY_NAME)('refuses a WebSocket upgrade with %s planted', async (name) => {
    const outcome = await whilePlanted({ [name]: SECRET }, async () => {
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        parser: clientParser(),
      })
      client = socket
      return new Promise<string>((resolve) => {
        socket.once('connect', () => resolve('connected'))
        socket.once('connect_error', () => resolve('refused'))
      })
    })

    expect(outcome).toBe('refused')
  })

  // Scenario: a client is connected, the key is planted, and the client sends a text event. Expected: the connection is
  // closed and the decoder never runs on the event, so nothing is read off the planted key and the process goes on.
  it.each(ANY_NAME)(
    'closes an open connection that sends an event with %s planted',
    async (name) => {
      const calls: unknown[] = []
      const socket = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
        parser: clientParser(),
      })
      client = socket
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('connect_error', reject)
      })
      for (let waited = 0; connected.length === 0; waited += 10) {
        if (waited >= 3000) throw new Error('the server never reported the connection')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const serverSide = connected[0] as Socket
      serverSide.on('probe', () => calls.push('received'))

      await whilePlanted({ [name]: SECRET }, async () => {
        socket.emit('probe', 'a text event')
        await settle()
      })

      expect(calls).toStrictEqual([])
      expect(serverSide.connected).toBe(false)
    },
  )
})
