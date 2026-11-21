/**
 * @fileoverview The origin allowlist of `websocket.cors` holds, whatever way the host defines `origin`, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import vm from 'node:vm'
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

/** Origins the block may carry besides a list: refused-by-default, a pattern, a function, and a proxy that answers by name only. */
const answers: ReadonlyArray<
  readonly [string, () => object, string | undefined, string | undefined]
> = [
  ['origin false', () => ({ origin: false }), undefined, undefined],
  ['a RegExp origin', () => ({ origin: /^https:\/\/good\.example$/ }), undefined, GOOD],
  [
    'a function origin',
    () => ({
      origin: (origin: string | undefined, done: (error: Error | null, ok?: boolean) => void) =>
        done(null, origin === GOOD),
    }),
    undefined,
    GOOD,
  ],
  [
    'a proxy over an empty target that answers by name',
    () => new Proxy({}, { get: (_target, key) => (key === 'origin' ? ALLOWED : undefined) }),
    undefined,
    GOOD,
  ],
]

describe('websocket.cors over a real server', () => {
  let app: INestApplication

  afterEach(async () => {
    await (app as INestApplication | undefined)?.close()
    jest.restoreAllMocks()
  })

  /** Boots a server with `cors` and returns the port it listens on. */
  async function boot(
    cors: object,
    wrap: (websocket: object) => object = (websocket) => websocket,
  ): Promise<number> {
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
    return (app.getHttpServer().address() as AddressInfo).port
  }

  /**
   * Boots a server with `cors`, asks it from `origin`, runs `between` while the server is still up, and asks
   * again. Resolves to both answers.
   */
  async function answersAround(
    cors: object,
    origin: string,
    between: () => void = () => undefined,
    wrap: (websocket: object) => object = (websocket) => websocket,
  ): Promise<[unknown, unknown]> {
    const port = await boot(cors, wrap)
    const ask = async (): Promise<unknown> =>
      (
        await request(`http://127.0.0.1:${port}`)
          .get('/socket.io/?EIO=4&transport=polling')
          .set('Origin', origin)
      ).headers['access-control-allow-origin']
    const before = await ask()
    between()
    return [before, await ask()]
  }

  async function answerTo(
    cors: object,
    origin: string,
    wrap: (websocket: object) => object = (websocket) => websocket,
  ): Promise<unknown> {
    return (await answersAround(cors, origin, undefined, wrap))[0]
  }

  // Scenario: an allowlist of one origin, and a request from another. Expected: no allow-all header, and the
  // allowed origin is answered with itself.
  it.each(shapes)('answers the allowed origin only, when origin is %s', async (_name, build) => {
    expect(await answerTo(build(), EVIL)).toBeUndefined()
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(GOOD)
  })

  // Scenario: origins that are not a list. Expected: the evil origin gets no header, and the allowed one is
  // answered only where the block allows it.
  it.each(answers)('answers by the rule of %s', async (_name, build, evil, good) => {
    expect(await answerTo(build(), EVIL)).toBe(evil)
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(good)
  })

  // Scenario: a block `Object.prototype.toString` does not call a plain object, or that throws when asked.
  // Expected: the names of CorsConfig are still read, so the allowlist holds and an evil origin gets no header.
  it.each(tagged)('keeps the allowlist when the block is %s', async (_name, build) => {
    expect(await answerTo(build(), EVIL)).toBeUndefined()
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(GOOD)
  })

  // Scenario: an origin that is set to nothing: `null`, `undefined`, or an environment variable that is missing.
  // Socket.IO answers no origin for these, so reading them as "unset" would open the server to every origin.
  // Expected: the module refuses to boot, and no server answers.
  it.each([
    ['null', () => ({ origin: null })],
    ['undefined', () => ({ origin: undefined, credentials: true })],
    [
      'an environment variable that is missing',
      () => ({ origin: process.env.NO_SUCH_ORIGIN_9F2C }),
    ],
  ])('refuses to boot when origin is %s', async (_name, build) => {
    let caught: unknown
    try {
      await answerTo(build(), EVIL)
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string } | undefined)?.code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).message).toContain('options.websocket.cors.origin must be')
  })

  // Scenario: an origin of a kind Socket.IO reads as "any origin": an object, a number, a symbol, an array with an
  // entry that is neither a string nor a RegExp, an object that only has a RegExp's prototype and a Proxy over a
  // RegExp. Expected: the module refuses to
  // boot, and no server reflects the origin it was asked from.
  const wrongOrigins: ReadonlyArray<readonly [string, () => unknown]> = [
    ['an empty object', () => ({})],
    ['a number', () => 5],
    ['a symbol', () => Symbol('origin')],
    ['an array holding a number', () => [GOOD, 1]],
    ['an array holding an object', () => [{}]],
    ['an array holding an array', () => [[GOOD]]],
    ['a RegExp-shaped object that is not one', () => Object.create(RegExp.prototype) as unknown],
    ['a Proxy over a RegExp', () => new Proxy(/good\\.example$/, {})],
    ['a list holding false', () => [GOOD, false]],
  ]

  it.each(wrongOrigins)('refuses to boot when origin is %s', async (_name, build) => {
    let caught: unknown
    try {
      await answerTo({ origin: build() }, EVIL)
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string } | undefined)?.code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).message).toContain('options.websocket.cors.origin must be')
  })

  // Scenario: an origin list the host can change after validation, or that reads differently by iterator and by
  // index (Socket.IO's own matching reads it by index and length on every request). Expected: the list that was
  // validated is the list that is used, so no later change or second reading reaches the answer.
  const WITH = 'https://good.example'

  it('answers by the list that was validated, whatever the host pushes after boot', async () => {
    const list: unknown[] = [WITH]

    const [before, after] = await answersAround({ origin: list }, EVIL, () => {
      list.push(/./, {})
    })

    expect(before).toBeUndefined()
    expect(after).toBeUndefined()
  })

  it('refuses a list whose iterator yields a string where its index holds an object', async () => {
    class Split extends Array<unknown> {
      override [Symbol.iterator](): ArrayIterator<unknown> {
        return ['https://ok.test'][Symbol.iterator]()
      }
    }
    const list = new Split()
    list[0] = {}
    let caught: unknown
    try {
      await answerTo({ origin: list }, EVIL)
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string } | undefined)?.code).toBe('REALTIME_INVALID_OPTIONS')
  })

  it('uses the first reading of an entry that a proxy answers differently afterwards', async () => {
    let reads = 0
    const list = new Proxy([WITH], {
      get: (target, key, receiver) =>
        key === '0' ? (reads++ === 0 ? WITH : {}) : (Reflect.get(target, key, receiver) as unknown),
    })

    const [first, second] = await answersAround({ origin: list }, EVIL)

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
  })

  // Scenario: RegExp entries the host can change after boot, or that keep state between requests. Expected: each
  // RegExp is copied without its g and y flags once at boot, so what the host does to the original reaches nothing,
  // and a request is answered the same however many came before it.
  it('answers by the RegExp that was validated, whatever the host does to it after boot', async () => {
    const pattern = /good\.example$/
    const list: unknown[] = [pattern]

    const [before, after] = await answersAround({ origin: list }, EVIL, () => {
      Object.setPrototypeOf(pattern, {})
      list[0] = {}
    })

    expect(before).toBeUndefined()
    expect(after).toBeUndefined()
  })

  it('answers every request the same for a RegExp entry with the g or y flag', async () => {
    const [first, second] = await answersAround({ origin: [/good\.example$/g] }, GOOD)

    expect(first).toBe(GOOD)
    expect(second).toBe(GOOD)
  })

  it.each([['a RegExp origin', () => /good\.example$/y]])(
    'answers every request the same for %s',
    async (_name, build) => {
      const [first, second] = await answersAround({ origin: build() }, GOOD)

      expect(first).toBe(GOOD)
      expect(second).toBe(GOOD)
    },
  )

  // Scenario: a RegExp that is not a plain one: a subclass, one with a property of its own, one from another realm.
  // Socket.IO would call its own `test`, which a plain copy cannot keep, and a copy that is more permissive than the
  // original would answer origins the host meant to refuse. Expected: refused at boot, with the way out.
  class StrictPattern extends RegExp {
    override test(origin: string): boolean {
      return super.test(origin) && origin !== 'https://blocked.good.example'
    }
  }
  it.each([
    ['a RegExp subclass', () => new StrictPattern('good\\.example$')],
    [
      'a RegExp with a test of its own',
      () => Object.assign(/good\.example$/, { test: () => false }),
    ],
    ['a RegExp from another realm', () => vm.runInNewContext('/good\\.example$/') as unknown],
    ['a list holding a RegExp subclass', () => [new StrictPattern('good\\.example$')]],
  ])('refuses to boot when origin is %s', async (_name, build) => {
    let caught: unknown
    try {
      await answerTo({ origin: build() }, EVIL)
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string } | undefined)?.code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).message).toContain('use a function origin for custom matching')
  })

  // Scenario: a key of the block that the options do not name, here the headers a preflight may ask for. Expected:
  // it reaches Socket.IO as written, which a real preflight shows.
  it('forwards a key the options do not name to Socket.IO as written', async () => {
    const port = await boot({ origin: GOOD, allowedHeaders: 'x-forwarded-key' })

    const response = await request(`http://127.0.0.1:${port}`)
      .options('/socket.io/?EIO=4&transport=polling')
      .set('Origin', GOOD)
      .set('Access-Control-Request-Method', 'GET')

    expect(response.headers['access-control-allow-headers']).toBe('x-forwarded-key')
  })

  // Scenario: the kinds the option documents. Expected: each is accepted and answers by its own rule.
  it.each([
    ['a RegExp', () => /^https:\/\/good\.example$/, GOOD, EVIL],
    [
      'an array of a string and a RegExp',
      () => ['https://other.example', /good\.example$/],
      GOOD,
      EVIL,
    ],
    [
      'a function',
      () => (origin: string | undefined, done: (error: null, allow: boolean) => void) =>
        done(null, origin === GOOD),
      GOOD,
      EVIL,
    ],
  ])('answers by the rule of %s', async (_name, build, good, evil) => {
    expect(await answerTo({ origin: build() }, evil)).toBeUndefined()
    await app.close()
    expect(await answerTo({ origin: build() }, good)).toBe(good)
  })

  // Scenario: a cors block that is present and is not an object. Expected: refused, not ignored (Socket.IO answers
  // every origin for each of these).
  it.each([
    ['a string', () => 'https://good.example'],
    ['a number', () => 5],
    ['true', () => true],
    ['false', () => false],
    ['an array', () => [GOOD]],
    ['a Map', () => new Map()],
    ['a Map from another realm', () => vm.runInNewContext('new Map()') as unknown],
    ['an Error', () => new Error('not options')],
    ['a Date', () => new Date(0)],
  ])('refuses to boot when the cors block is %s', async (_name, build) => {
    let caught: unknown
    try {
      await answerTo(build() as never, EVIL)
    } catch (error) {
      caught = error
    }
    app = undefined as never
    expect((caught as { code?: string } | undefined)?.code).toBe('REALTIME_INVALID_OPTIONS')
    expect((caught as Error).message).toContain('options.websocket.cors must be')
  })

  // Scenario: a block with no origin key at all. Expected: the documented default, which answers every origin.
  it('keeps the documented default when the origin key is absent', async () => {
    expect(await answerTo({ credentials: true }, EVIL)).toBe('*')
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
    const cors = Object.defineProperty({}, 'origin', { get: () => ALLOWED })
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
      let reads = 0
      const wrap = (websocket: object): object =>
        new Proxy(websocket, {
          get: (target, key) => {
            reads += 1
            return Reflect.get(target, key) as unknown
          },
        })

      expect(await answerTo(cors, EVIL, wrap)).toBeUndefined()
      expect(reads).toBeGreaterThan(0)
      await app.close()
      expect(await answerTo(cors, GOOD, wrap)).toBe(GOOD)
    })
  })
})
