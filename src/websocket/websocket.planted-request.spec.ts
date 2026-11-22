/**
 * @fileoverview A key planted on `Object.prototype` while a request is served changes nothing in the response, over real servers.
 * @layer transport
 *
 * The `cors` package, engine.io and Socket.IO copy what they are given into fresh objects and read names from the
 * copy, so a planted key is read at request time and not only at boot. Each row plants one key while the request is
 * asked and compares the answer with the one given without it: the response headers of a handshake and of a preflight
 * on the WebSocket transport, and the headers of an SSE response, which the library gives no CORS headers.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeModule } from '../server/realtime.module'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(30_000)

const GOOD = 'https://good.example'
const EVIL = 'https://evil.example'
const authenticator = { authenticate: async () => ({ userId: 'u1' }) }

/** What each key would do if it were read: it opens CORS, exposes a header, caches a preflight or sets a cookie. */
const PLANTED: Readonly<Record<string, unknown>> = {
  credentials: true,
  exposedHeaders: ['X-Evil'],
  allowedHeaders: ['X-Evil'],
  headers: ['X-Evil'],
  maxAge: '999',
  preflightContinue: true,
  optionsSuccessStatus: 200,
  cookie: true,
  perMessageDeflate: true,
  addTrailingSlash: false,
}

/** `values` planted on `Object.prototype` while `run` runs; they are taken away again when it settles. */
async function whilePlanted<T>(values: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const root = Object.prototype as unknown as Record<string, unknown>
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  }
  try {
    return await run()
  } finally {
    for (const name of Object.keys(values)) delete root[name]
  }
}

/** A cookie with the session id taken out, since it is new on every handshake and what the attributes follow is the point. */
const withoutSessionId = (cookies: unknown): unknown =>
  Array.isArray(cookies)
    ? cookies.map((cookie: string) => cookie.replace(/^([^=]+=)[^;]*/, '$1<id>'))
    : cookies

/** The headers of a response that name CORS or set a cookie, and its status. */
const interesting = (
  status: number,
  headers: Record<string, unknown>,
): Record<string, unknown> => ({
  status,
  ...Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => name.startsWith('access-control') || name === 'set-cookie')
      .map(([name, value]) => [name, name === 'set-cookie' ? withoutSessionId(value) : value]),
  ),
})

describe('the WebSocket transport, with a key planted while a request is served', () => {
  let app: INestApplication
  let port: number

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator,
          websocket: { cors: { origin: [GOOD] } },
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterAll(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  const handshake = async (origin: string): Promise<Record<string, unknown>> => {
    const response = await request(`http://127.0.0.1:${port}`)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', origin)
    return interesting(response.status, response.headers)
  }

  const preflight = async (origin: string): Promise<Record<string, unknown>> => {
    const response = await request(`http://127.0.0.1:${port}`)
      .options('/socket.io/?EIO=4&transport=polling')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-client')
    return interesting(response.status, response.headers)
  }

  // Scenario: one key planted while a handshake is asked from the allowed origin, and from another. Expected: the headers
  // and the status are those of the same request without it, so no credentials, exposed header or cookie appears.
  it.each(Object.keys(PLANTED))('answers a handshake as before with %s planted', async (key) => {
    const baseline = [await handshake(GOOD), await handshake(EVIL)]

    const planted = await whilePlanted({ [key]: PLANTED[key] }, async () => [
      await handshake(GOOD),
      await handshake(EVIL),
    ])

    expect(planted).toStrictEqual(baseline)
    expect(baseline[0]).toHaveProperty('access-control-allow-origin', GOOD)
  })

  // Scenario: the same for a preflight, where the max age, the allowed headers and the status of the answer are read.
  it.each(Object.keys(PLANTED))('answers a preflight as before with %s planted', async (key) => {
    const baseline = await preflight(GOOD)

    const planted = await whilePlanted({ [key]: PLANTED[key] }, () => preflight(GOOD))

    expect(planted).toStrictEqual(baseline)
    expect(baseline).not.toHaveProperty('access-control-max-age')
  })

  // Scenario: a function planted under `allowRequest`, which engine.io calls on each handshake when it finds one.
  // Expected: it is never called, and the handshake is answered as before.
  it('does not call a planted allowRequest', async () => {
    const calls: unknown[] = []
    const baseline = await handshake(GOOD)

    const planted = await whilePlanted(
      {
        allowRequest: (_request: unknown, done: (error: null, ok: boolean) => void) => (
          calls.push('planted'),
          done(null, false)
        ),
      },
      () => handshake(GOOD),
    )

    expect(calls).toStrictEqual([])
    expect(planted).toStrictEqual(baseline)
  })
})

describe('the SSE transport, with a key planted while a request is served', () => {
  let app: INestApplication
  let port: number

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterAll(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  /** Opens the stream, takes the status and the headers, and closes it. */
  const open = (origin: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/realtime/sse`,
        { headers: { Origin: origin, Accept: 'text/event-stream' } },
        (response) => {
          resolve(interesting(response.statusCode ?? 0, response.headers))
          response.destroy()
        },
      )
      req.on('error', reject)
    })

  // Scenario: one key planted while the stream is opened with an Origin header. Expected: the library gives the SSE
  // response no CORS header, with the key or without it: cross-origin access to the stream is the host's, through
  // `app.enableCors`.
  it.each(Object.keys(PLANTED))('gives the stream no CORS header with %s planted', async (key) => {
    const baseline = await open(GOOD)

    const planted = await whilePlanted({ [key]: PLANTED[key] }, () => open(GOOD))

    expect(planted).toStrictEqual(baseline)
    expect(Object.keys(planted).filter((name) => name.startsWith('access-control'))).toStrictEqual(
      [],
    )
    expect(planted.status).toBe(200)
  })
})

describe('the cors block Nest hands the adapter, with a key planted while a request is served', () => {
  let app: INestApplication
  let port: number

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
    // The block comes from the options Nest passes for a gateway, since the module has no `websocket.cors`; with port 0
    // Nest attaches the server to the application's own HTTP server, which is listening.
    new RealtimeIoAdapter(app).createIOServer(0, { cors: { origin: [GOOD] } } as never)
  })

  afterAll(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  const handshake = async (): Promise<Record<string, unknown>> => {
    const response = await request(`http://127.0.0.1:${port}`)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', GOOD)
    return interesting(response.status, response.headers)
  }

  // Scenario: one key planted while a handshake is asked from the origin the block allows. Expected: the answer is the
  // one given without it.
  it.each(['credentials', 'exposedHeaders', 'cookie'])(
    'answers as before with %s planted',
    async (key) => {
      const baseline = await handshake()

      const planted = await whilePlanted({ [key]: PLANTED[key] }, handshake)

      expect(planted).toStrictEqual(baseline)
      expect(baseline).toHaveProperty('access-control-allow-origin', GOOD)
    },
  )
})

/** Keys that a cookie, and the compression of the response, would read: planted one at a time. */
const NESTED_PLANTED: Readonly<Record<string, unknown>> = {
  domain: 'evil.example',
  secure: true,
  maxAge: 999,
  expires: new Date('2099-01-01T00:00:00Z'),
  partitioned: true,
  priority: 'high',
  credentials: true,
  exposedHeaders: ['X-Evil'],
  allowedHeaders: ['X-Evil'],
}

/** The options Nest can hand the adapter for a gateway, each in a form `cors` or engine.io copy again. */
const GATEWAY_OPTIONS: ReadonlyArray<readonly [string, () => object]> = [
  [
    'a cors function',
    () => ({
      cors: (_request: unknown, done: (error: null, options: object) => void) =>
        done(null, { origin: [GOOD] }),
    }),
  ],
  ['cors: true', () => ({ cors: true })],
  ['a cookie object', () => ({ cors: { origin: [GOOD] }, cookie: { name: 'io' } })],
  ['cookie: true', () => ({ cors: { origin: [GOOD] }, cookie: true })],
]

describe.each(GATEWAY_OPTIONS)(
  'the options Nest hands the adapter as %s, with a key planted while a request is served',
  (_name, build) => {
    let app: INestApplication
    let port: number

    beforeAll(async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
      const module = await Test.createTestingModule({
        imports: [BymaxRealtimeWebSocketModule.forRoot({ transport: 'websocket', authenticator })],
      }).compile()
      app = module.createNestApplication()
      await app.listen(0)
      port = (app.getHttpServer().address() as AddressInfo).port
      new RealtimeIoAdapter(app).createIOServer(0, build() as never)
    })

    afterAll(async () => {
      await app.close()
      jest.restoreAllMocks()
    })

    const handshake = async (): Promise<Record<string, unknown>> => {
      const response = await request(`http://127.0.0.1:${port}`)
        .get('/socket.io/?EIO=4&transport=polling')
        .set('Origin', GOOD)
      return interesting(response.status, response.headers)
    }

    const preflight = async (): Promise<Record<string, unknown>> => {
      const response = await request(`http://127.0.0.1:${port}`)
        .options('/socket.io/?EIO=4&transport=polling')
        .set('Origin', GOOD)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'x-client')
      return interesting(response.status, response.headers)
    }

    // Scenario: one key planted while a handshake and a preflight are asked. Expected: each answer is the one given
    // without it, so no cookie attribute, credentials or exposed header appears.
    it.each(Object.keys(NESTED_PLANTED))('answers as before with %s planted', async (key) => {
      const baseline = [await handshake(), await preflight()]

      const planted = await whilePlanted({ [key]: NESTED_PLANTED[key] }, async () => [
        await handshake(),
        await preflight(),
      ])

      expect(planted).toStrictEqual(baseline)
      if (_name.includes('cookie')) expect(baseline[0]).toHaveProperty('set-cookie')
    })

    // Scenario: a function planted under `encode`, which the cookie package calls on the value it writes. Expected: it is
    // never called.
    it('does not call a planted encode', async () => {
      const calls: unknown[] = []

      await whilePlanted({ encode: (value: string) => (calls.push('planted'), value) }, handshake)

      expect(calls).toStrictEqual([])
    })
  },
)
