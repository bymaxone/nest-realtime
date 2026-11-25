/**
 * @fileoverview The origin policy of the WebSocket handshake, measured against a real engine.io server created by the adapter.
 * @layer infrastructure
 *
 * Constraint under test: with `allowedOrigins` or `websocketOnly` set, a request is refused before a socket exists unless
 * it is a WebSocket upgrade that names no session and, when `allowedOrigins` is set, comes from a listed origin.
 */
import 'reflect-metadata'
import { request as httpRequest, createServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NestApplicationContext } from '@nestjs/core'
import { io as connect } from 'socket.io-client'
import type { Socket as ClientSocket } from 'socket.io-client'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeIoAdapter } from './realtime-io-adapter'

interface Booted {
  readonly port: number
  readonly engineTransports: unknown
  readonly close: () => Promise<void>
}

const LISTED = 'https://app.example'

/** Boots a real HTTP server with the adapter's Socket.IO server attached, from the options given. */
async function boot(
  websocket: NonNullable<BymaxRealtimeModuleOptions['websocket']>,
  serverOptions: Record<string, unknown> = {},
): Promise<Booted> {
  const http: HttpServer = createServer()
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
  // Nest's adapter takes anything that is not an application as the HTTP server to attach to, and this adapter reads
  // its options from `get`, so the server carries both.
  const app = Object.assign(http, {
    get: (token: symbol) => (token === REALTIME_OPTIONS_TOKEN ? { websocket } : undefined),
  })
  let server: { close: () => Promise<void>; engine: { opts: { transports: unknown } } }
  try {
    server = new RealtimeIoAdapter(app as never).createIOServer(0, serverOptions as never) as never
  } catch (error) {
    await new Promise<void>((done) => http.close(() => done()))
    throw error
  }
  return {
    port: (http.address() as AddressInfo).port,
    engineTransports: server.engine.opts.transports,
    close: async () => {
      await server.close()
      if (http.listening) await new Promise<void>((done) => http.close(() => done()))
    },
  }
}

/** Close the Socket.IO server a namespace belongs to; the adapter's `create` returns the namespace, not the server. */
async function closeServerOf(namespace: unknown): Promise<void> {
  if (typeof namespace === 'object' && namespace !== null && 'server' in namespace) {
    const { server } = namespace
    if (
      typeof server === 'object' &&
      server !== null &&
      'close' in server &&
      typeof server.close === 'function'
    ) {
      await server.close()
    }
  }
}

/**
 * The outcome of a raw request: `101` when it was upgraded, otherwise the status and the body. engine.io answers a refused
 * upgrade with a bare 400 whose body says why, and a refused plain request with the status of the refusal.
 */
function status(
  port: number,
  path: string,
  headers: Record<string, string | string[]> = {},
  upgrade = true,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        ...(upgrade
          ? {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Version': '13',
              'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            }
          : {}),
        ...headers,
      },
    })
    req.on('upgrade', (_res, socket) => {
      socket.destroy()
      resolve('101')
    })
    req.on('response', (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve(`${res.statusCode ?? 0} ${body}`))
    })
    req.on('error', reject)
    req.end()
  })
}

const FORBIDDEN = '400 forbidden'
const UNKNOWN_TRANSPORT = '400 {"code":0,"message":"Transport unknown"}'
/** What engine.io says when the host's own `allowRequest` refused, with no message of its own. */
const HOST_FORBIDDEN = '400 Forbidden'
const BAD_REQUEST = '400 Bad request'
const WS = '/socket.io/?EIO=4&transport=websocket'
const POLLING = '/socket.io/?EIO=4&transport=polling'

describe('the origin policy on a real engine.io server', () => {
  let booted: Booted | undefined
  const clients: ClientSocket[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close()
    await booted?.close()
    booted = undefined
  })

  /** Opens a websocket-only client with an `Origin` header and resolves with it once connected, or the error. */
  function open(port: number, origin: string | undefined): Promise<ClientSocket | Error> {
    const client = connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: origin === undefined ? {} : { Origin: origin },
    })
    clients.push(client)
    return new Promise((resolve) => {
      client.on('connect', () => resolve(client))
      client.on('connect_error', (error) => resolve(error))
    })
  }

  // Scenario: an origin on the list opens a WebSocket. Expected: it connects.
  it('admits a listed origin', async () => {
    booted = await boot({ allowedOrigins: [LISTED] })
    expect(await open(booted.port, LISTED)).toHaveProperty('connected', true)
  })

  // Scenario: the origin is not on the list. Expected: the policy refuses the upgrade and no socket exists.
  it.each([
    ['an unlisted origin', 'https://evil.example'],
    ['the listed origin in another case', 'https://APP.example'],
    ['the listed origin with a trailing slash', `${LISTED}/`],
    ['the string null', 'null'],
    ['two origins joined by a comma', `${LISTED}, https://evil.example`],
  ])('refuses %s ', async (_name, origin) => {
    booted = await boot({ allowedOrigins: [LISTED] })
    expect(await status(booted.port, WS, { Origin: origin })).toBe(FORBIDDEN)
  })

  // Scenario: two Origin headers on the wire. Expected: they arrive as one joined string, which is not an entry.
  it('refuses a request that carries two Origin headers', async () => {
    booted = await boot({ allowedOrigins: [LISTED] })
    expect(await status(booted.port, WS, { Origin: [LISTED, LISTED] })).toBe(FORBIDDEN)
  })

  // Scenario: a WebSocket upgrade with no Origin, which only a client that is not a browser sends. Expected: admitted.
  it('admits an upgrade that names no origin', async () => {
    booted = await boot({ allowedOrigins: [LISTED] })
    expect(await status(booted.port, WS)).toBe('101')
  })

  // Scenario: polling, including JSONP, from the listed origin. Expected: refused before allowRequest, as an unknown transport.
  it.each([
    ['polling', POLLING],
    ['JSONP polling', `${POLLING}&j=0`],
  ])('refuses %s from a listed origin', async (_name, path) => {
    booted = await boot({ allowedOrigins: [LISTED] })
    expect(await status(booted.port, path, { Origin: LISTED }, false)).toBe(UNKNOWN_TRANSPORT)
  })

  // Scenario: a second WebSocket names a live session from an unlisted origin. Expected: refused. Without the guard
  // engine.io skips allowRequest for a request with a sid and upgrades it, taking the session over.
  it.each([
    ['one sid', (id: string) => `${WS}&sid=${id}`],
    ['a repeated sid', (id: string) => `${WS}&sid=a&sid=${id}`],
    ['an encoded key', (id: string) => `${WS}&%73id=${id}`],
    ['an empty sid', () => `${WS}&sid=`],
  ])('refuses a request with %s', async (_name, path) => {
    booted = await boot({ allowedOrigins: [LISTED] })
    const live = await open(booted.port, LISTED)
    const id = (live as ClientSocket).io.engine.id as string
    expect(await status(booted.port, path(id), { Origin: 'https://evil.example' })).toBe(
      BAD_REQUEST,
    )
    expect((live as ClientSocket).connected).toBe(true)
  })

  // Scenario: websocketOnly alone. Expected: any origin may upgrade, polling is refused, and a sid is refused.
  it('serves websocket only when websocketOnly is set without a list', async () => {
    booted = await boot({ websocketOnly: true })
    expect(await open(booted.port, 'https://anything.example')).toHaveProperty('connected', true)
    expect(await status(booted.port, POLLING, {}, false)).toBe(UNKNOWN_TRANSPORT)
  })

  // Scenario: neither option set. Expected: today's behaviour, polling still served.
  it('leaves polling on when neither option is set', async () => {
    booted = await boot({})
    expect(await status(booted.port, POLLING, {}, false)).toMatch(/^200 /)
  })

  // Scenario: websocketOnly: false is not asking for the policy.
  it('treats websocketOnly false as unset', async () => {
    booted = await boot({ websocketOnly: false })
    expect(await status(booted.port, POLLING, {}, false)).toMatch(/^200 /)
  })

  // Scenario: the host gave its own allowRequest and its own transports. Expected: the policy keeps its transports, and
  // the host's function runs only after the policy admitted the request and can only refuse.
  describe('with a host allowRequest', () => {
    it('runs it after the policy and honours its refusal', async () => {
      const calls: string[] = []
      booted = await boot(
        { allowedOrigins: [LISTED] },
        {
          transports: ['polling', 'websocket'],
          allowRequest: (_req: unknown, cb: (m: null, ok: boolean) => void) => {
            calls.push('host')
            cb(null, false)
          },
        },
      )
      expect(await status(booted.port, WS, { Origin: LISTED })).toBe(HOST_FORBIDDEN)
      expect(await status(booted.port, POLLING, { Origin: LISTED }, false)).toBe(UNKNOWN_TRANSPORT)
      expect(calls).toStrictEqual(['host'])
    })

    it('does not run it for an origin the policy refused', async () => {
      const host = jest.fn()
      booted = await boot({ allowedOrigins: [LISTED] }, { allowRequest: host })
      expect(await status(booted.port, WS, { Origin: 'https://evil.example' })).toBe(FORBIDDEN)
      expect(host).not.toHaveBeenCalled()
    })

    it('admits when it answers later and positively', async () => {
      booted = await boot(
        { allowedOrigins: [LISTED] },
        {
          allowRequest: (_req: unknown, cb: (m: null, ok: boolean) => void) =>
            setTimeout(() => cb(null, true), 5),
        },
      )
      expect(await status(booted.port, WS, { Origin: LISTED })).toBe('101')
    })

    it('refuses when it throws', async () => {
      booted = await boot(
        { allowedOrigins: [LISTED] },
        {
          allowRequest: () => {
            throw new Error('boom')
          },
        },
      )
      expect(await status(booted.port, WS, { Origin: LISTED })).toBe(FORBIDDEN)
    })

    it('takes the first answer when it calls back twice', async () => {
      booted = await boot(
        { allowedOrigins: [LISTED] },
        {
          allowRequest: (_req: unknown, cb: (m: null, ok: boolean) => void) => {
            cb(null, false)
            cb(null, true)
          },
        },
      )
      expect(await status(booted.port, WS, { Origin: LISTED })).toBe(HOST_FORBIDDEN)
    })
  })

  // Scenario: the host lists webtransport, or polling, in its own server options. Expected: the policy decides, so the
  // engine serves websocket alone and webtransport, which bypasses allowRequest and the middlewares, is not offered.
  it('keeps websocket as the only transport whatever the host lists', async () => {
    booted = await boot(
      { allowedOrigins: [LISTED] },
      { transports: ['webtransport', 'polling', 'websocket'] },
    )
    expect(booted.engineTransports).toStrictEqual(['websocket'])
  })

  // Scenario: a gateway on a custom namespace, and one on its own port. Expected: the policy is the engine's, so both
  // are covered.
  it('covers a gateway on a custom namespace', async () => {
    const http = createServer()
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
    const app = Object.assign(http, {
      get: (token: symbol) =>
        token === REALTIME_OPTIONS_TOKEN ? { websocket: { allowedOrigins: [LISTED] } } : undefined,
    })
    const namespace = new RealtimeIoAdapter(app as never).create(0, { namespace: '/chat' } as never)
    const port = (http.address() as AddressInfo).port
    try {
      expect(await status(port, WS, { Origin: 'https://evil.example' })).toBe(FORBIDDEN)
      expect(await status(port, POLLING, { Origin: LISTED }, false)).toBe(UNKNOWN_TRANSPORT)
    } finally {
      await closeServerOf(namespace)
    }
  })

  it('covers a gateway on its own port', async () => {
    // An application context with no HTTP server of its own, so the adapter listens on the port it is given.
    const context = Object.assign(Object.create(NestApplicationContext.prototype), {
      get: (token: symbol) =>
        token === REALTIME_OPTIONS_TOKEN ? { websocket: { allowedOrigins: [LISTED] } } : undefined,
    })
    const probe = createServer()
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done))
    const free = (probe.address() as AddressInfo).port
    await new Promise<void>((done) => probe.close(() => done()))
    const server = new RealtimeIoAdapter(context as never).createIOServer(free) as never as {
      httpServer: HttpServer
      close: () => Promise<void>
    }
    try {
      await new Promise<void>((done) =>
        server.httpServer.listening ? done() : server.httpServer.once('listening', () => done()),
      )
      expect(await status(free, WS, { Origin: 'https://evil.example' })).toBe(FORBIDDEN)
      expect(await status(free, WS, { Origin: LISTED })).toBe('101')
    } finally {
      await server.close()
    }
  })

  // Scenario: the options cannot be applied together. Expected: the server is refused at boot.
  it('refuses a cors origin beside allowedOrigins', async () => {
    await expect(
      boot({ allowedOrigins: [LISTED], cors: { origin: 'https://other.example' } }),
    ).rejects.toThrow(/allowedOrigins cannot be set together/)
  })

  it('accepts a cors block whose origin is false', async () => {
    booted = await boot({ allowedOrigins: [LISTED], cors: { origin: false } })
    expect(await status(booted.port, WS, { Origin: LISTED })).toBe('101')
  })

  it('refuses a gateway cors origin beside allowedOrigins', async () => {
    await expect(boot({ allowedOrigins: [LISTED] }, { cors: { origin: '*' } })).rejects.toThrow(
      /allowedOrigins cannot be set together/,
    )
  })

  it('refuses an allowRequest that is not a function', async () => {
    await expect(boot({ websocketOnly: true }, { allowRequest: 'yes' })).rejects.toThrow(
      /allowRequest must be a function/,
    )
  })
})
