/**
 * @fileoverview The origin allowlist of `websocket.cors` holds, whatever way the host defines `origin`, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const GOOD = 'https://good.example'
const EVIL = 'https://evil.example'
const ALLOWED = [GOOD]

/** Each way `origin` can be defined; a spread of the block loses every one except the first. */
const shapes: ReadonlyArray<readonly [string, () => object]> = [
  ['an own data property', () => ({ origin: ALLOWED, credentials: true })],
  [
    'a class getter',
    () =>
      new (class {
        credentials = true
        get origin(): string[] {
          return ALLOWED
        }
      })(),
  ],
  [
    'a non-enumerable property',
    () => Object.defineProperties({ credentials: true }, { origin: { value: ALLOWED } }),
  ],
  [
    'a prototype property',
    () => Object.assign(Object.create({ origin: ALLOWED }), { credentials: true }),
  ],
]

/** Blocks a type tag or a strict proxy makes `Object.prototype.toString` mis-report or throw on; the names are still readable. */
const tagged: ReadonlyArray<readonly [string, () => object]> = [
  [
    'a class with a Symbol.toStringTag getter and an origin getter',
    () =>
      new (class {
        get [Symbol.toStringTag](): string {
          return 'Config'
        }
        get origin(): string[] {
          return ALLOWED
        }
      })(),
  ],
  [
    'a non-enumerable origin on a block with a Symbol.toStringTag',
    () =>
      Object.defineProperties({ [Symbol.toStringTag]: 'Config' }, { origin: { value: ALLOWED } }),
  ],
  [
    'a strict proxy that answers the CorsConfig names and throws for every other key',
    () =>
      new Proxy(
        {},
        {
          get: (_target, key) => {
            if (key === 'origin') return ALLOWED
            if (key === 'credentials' || key === 'methods') return undefined
            throw new Error(`strict: ${String(key)}`)
          },
        },
      ),
  ],
  [
    'a strict proxy over a target whose origin is non-enumerable',
    () =>
      new Proxy(Object.defineProperties({}, { origin: { value: ALLOWED } }), {
        get: (target, key) => {
          if (key === 'credentials' || key === 'methods') return undefined
          return (target as Record<PropertyKey, unknown>)[key]
        },
      }),
  ],
]

describe('websocket.cors over a real server', () => {
  let app: INestApplication

  afterEach(async () => {
    await (app as INestApplication | undefined)?.close()
    jest.restoreAllMocks()
  })

  async function answerTo(
    cors: object,
    origin: string,
    wrap: (websocket: object) => object = (websocket) => websocket,
  ): Promise<unknown> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => null },
          websocket: wrap({ cors }),
        } as never),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    const response = await request(`http://127.0.0.1:${port}`)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', origin)
    return response.headers['access-control-allow-origin']
  }

  // Scenario: an allowlist of one origin, and a request from another. Expected: no allow-all header, and the
  // allowed origin is answered with itself.
  it.each(shapes)('answers the allowed origin only, when origin is %s', async (_name, build) => {
    expect(await answerTo(build(), EVIL)).toBeUndefined()
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(GOOD)
  })

  // Scenario: a block `Object.prototype.toString` does not call a plain object, or that throws when asked.
  // Expected: the names of CorsConfig are still read, so the allowlist holds and an evil origin gets no header.
  it.each(tagged)('keeps the allowlist when the block is %s', async (_name, build) => {
    expect(await answerTo(build(), EVIL)).toBeUndefined()
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(GOOD)
  })

  // Scenario: a proxy that throws when a CorsConfig name is read. Expected: the library's refusal, with the
  // host's error as the cause, never a server that answers every origin.
  it('refuses a block whose CorsConfig name cannot be read, with the host error as the cause', async () => {
    const host = new Error('strict: credentials')
    const block = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'origin') return ALLOWED
          throw host
        },
      },
    )
    let caught: unknown
    try {
      await Test.createTestingModule({
        imports: [
          BymaxRealtimeWebSocketModule.forRoot({
            transport: 'websocket',
            authenticator: { authenticate: async () => null },
            websocket: { cors: block },
          } as never),
        ],
      }).compile()
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string }).code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).cause).toBe(host)
  })

  // Scenario: the websocket block that holds the cors block is itself type-tagged or a strict proxy, with a
  // getter as the origin. Expected: the module refuses it as an options error, so no server is built that could
  // answer every origin; a proxy that answers every key is an ordinary block, and its allowlist holds.
  describe('when the websocket block itself is unusual', () => {
    const cors = {
      get origin(): string[] {
        return ALLOWED
      },
    }
    const compile = async (websocket: object): Promise<unknown> =>
      Test.createTestingModule({
        imports: [
          BymaxRealtimeWebSocketModule.forRoot({
            transport: 'websocket',
            authenticator: { authenticate: async () => null },
            websocket,
          } as never),
        ],
      }).compile()

    it('refuses a block with a Symbol.toStringTag', async () => {
      const block = Object.defineProperty({ cors }, Symbol.toStringTag, { value: 'Websocket' })

      await expect(compile(block)).rejects.toMatchObject({ code: 'REALTIME_INVALID_OPTIONS' })
    })

    it('refuses a strict proxy that throws for a key it does not know, with the host error as the cause', async () => {
      const host = new Error('strict')
      const block = new Proxy(
        { cors },
        {
          get: (target, key) => {
            if (key === 'cors') return target.cors
            throw host
          },
        },
      )

      await expect(compile(block)).rejects.toMatchObject({
        code: 'REALTIME_INVALID_OPTIONS',
        cause: host,
      })
    })

    it('refuses a cors block that is a revoked proxy, with the engine error as the cause', async () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()

      const error = await compile({ cors: proxy }).then(
        () => undefined,
        (thrown: unknown) => thrown,
      )

      expect(error).toMatchObject({ code: 'REALTIME_INVALID_OPTIONS' })
      expect((error as Error).cause).toBeInstanceOf(TypeError)
    })

    it('keeps the allowlist when a proxy answers every key', async () => {
      const block = new Proxy(
        { cors },
        { get: (target, key) => Reflect.get(target, key) as unknown },
      )

      expect(await answerTo(block.cors, EVIL)).toBeUndefined()
    })
  })
})
