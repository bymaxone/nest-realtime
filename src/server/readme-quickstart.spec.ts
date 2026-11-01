/**
 * @fileoverview Executes the README Quick Start as written.
 * @layer composition
 *
 * `check:published` compiles the README's snippets, but a type check cannot see a wrong
 * option shape, a route that is never mounted or a service that cannot be injected, so a Quick
 * Start can compile and still fail for the reader. The blocks below are taken from the README
 * text at test time, not copied, compiled and run against a real Nest application, so the README
 * and this test cannot drift: a change to a block is a change to what runs here.
 *
 * Three things stand in for what the README leaves to the reader, and nothing else does: `./jwt`
 * (the consumer's own token helper), `ioredis` (an in-memory client) and `NestFactory.create`
 * in the `main.ts` block, whose `listen(3000)` is redirected to a free port.
 */
import { readFileSync } from 'node:fs'
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { compileFunction } from 'node:vm'
import { Logger } from '@nestjs/common'
import type { INestApplication, Type } from '@nestjs/common'
import * as nestCommon from '@nestjs/common'
import * as nestCore from '@nestjs/core'
import { Test } from '@nestjs/testing'
import RedisMock from 'ioredis-mock'
import { io } from 'socket.io-client'
import request from 'supertest'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as websocket from '../websocket/index'
import * as server from './index'

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')

/** The fenced TypeScript blocks of the Quick Start section, in the order the README shows them. */
function quickStartBlocks(): string[] {
  const start = README.indexOf('## 🚀 Quick Start')
  const end = README.indexOf('## ⚙️ Configuration')
  if (start === -1 || end === -1) throw new Error('README has no Quick Start section')
  return Array.from(
    README.slice(start, end).matchAll(/```typescript\n([\s\S]*?)```/g),
    (match) => match[1] ?? '',
  )
}

/** The one Quick Start block that contains `marker`; zero or several is a README this test no longer reads. */
function block(marker: string): string {
  const found = quickStartBlocks().filter((candidate) => candidate.includes(marker))
  if (found.length !== 1) {
    throw new Error(`Expected one Quick Start block containing "${marker}", found ${found.length}`)
  }
  return found[0] as string
}

type Modules = Readonly<Record<string, unknown>>

/** Compile one README block and run it, resolving its imports through `modules`. */
function runBlock(
  source: string,
  modules: Modules,
  globals: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const { outputText } = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  })
  const exported: Record<string, unknown> = {}
  const load = (specifier: string): unknown => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`The Quick Start imports "${specifier}", which this test does not provide`)
  }
  // `Reflect` is passed in because `vm` compiles in the realm outside Jest's sandbox, where
  // `reflect-metadata` has not run, so decorator metadata would silently not be recorded.
  const scope = { Reflect, ...globals }
  compileFunction(outputText, ['require', 'exports', ...Object.keys(scope)])(
    load,
    exported,
    ...Object.values(scope),
  )
  return exported
}

/** The consumer's own token helper, which the README's authenticator imports without showing. */
const jwt = {
  verifyAccessToken: (token: string): Promise<{ sub: string; tid: string }> =>
    token === 'good-token'
      ? Promise.resolve({ sub: 'user-1', tid: 'tenant-1' })
      : Promise.reject(new Error('invalid token')),
}

/** An in-memory `ioredis`, with the default export the README imports. */
const ioredis = { __esModule: true, default: RedisMock }

const publicModules: Modules = {
  '@nestjs/common': nestCommon,
  '@nestjs/core': nestCore,
  '@bymax-one/nest-realtime': server,
  '@bymax-one/nest-realtime/websocket': websocket,
  './jwt': jwt,
  ioredis,
}

/** The `CookieAuthenticator` class the README's second block declares. */
function loadAuthenticator(): Type<{ authenticate: unknown }> {
  const exported = runBlock(block('class CookieAuthenticator'), publicModules)
  return exported['CookieAuthenticator'] as Type<{ authenticate: unknown }>
}

interface SseStream {
  readonly status: number | undefined
  readonly contentType: string | undefined
  text(): string
  waitFor(needle: string): Promise<void>
  close(): void
}

/** Open `GET /realtime/sse` on `port` with an optional cookie, as a browser `EventSource` would. */
function openStream(port: number, cookie?: string): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: '/realtime/sse',
        headers: { accept: 'text/event-stream', ...(cookie ? { cookie } : {}) },
        agent: false,
      },
      (res) => {
        let text = ''
        const waiting = new Set<() => void>()
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          text += chunk
          for (const wake of waiting) wake()
        })
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          text: () => text,
          waitFor: (needle) =>
            new Promise((done, fail) => {
              const timer = setTimeout(() => {
                waiting.delete(check)
                fail(new Error(`Stream never carried "${needle}"; it carried:\n${text}`))
              }, 1500)
              const check = (): void => {
                if (!text.includes(needle)) return
                clearTimeout(timer)
                waiting.delete(check)
                done()
              }
              waiting.add(check)
              check()
            }),
          close: () => req.destroy(),
        })
      },
    )
    req.on('error', reject)
  })
}

async function listen(app: INestApplication): Promise<number> {
  await app.listen(0)
  return (app.getHttpServer().address() as AddressInfo).port
}

describe('README Quick Start — SSE', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('authenticates with the cookie authenticator and delivers what the controller emits', async () => {
    /**
     * Guards the README section "Quick Start", steps 2 to 4, and changes when they do: the
     * `CookieAuthenticator`, the `AppModule` that registers it and the `InvoicesController` are
     * run as the README prints them. A request with the good cookie opens the stream the README
     * describes, a request without a valid cookie gets the `401` step 2 states, and a POST to
     * the controller reaches the connected user as the named event step 4 emits.
     */
    const exports3 = runBlock(
      block(
        "import { BymaxRealtimeModule } from '@bymax-one/nest-realtime'\nimport { CookieAuthenticator }",
      ),
      {
        ...publicModules,
        './auth/cookie-authenticator': { CookieAuthenticator: loadAuthenticator() },
      },
    )
    const { InvoicesController } = runBlock(block('class InvoicesController'), publicModules) as {
      InvoicesController: Type<unknown>
    }
    const moduleRef = await Test.createTestingModule({
      imports: [exports3['AppModule'] as Type<unknown>],
      controllers: [InvoicesController],
    }).compile()
    app = moduleRef.createNestApplication()
    const port = await listen(app)

    const stream = await openStream(port, 'access_token=good-token')
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')
    await stream.waitFor('event: connection:established')

    await request(app.getHttpServer())
      .post('/invoices/inv-1/pay')
      .send({ userId: 'user-1', amount: 42 })
      .expect(201)
    await stream.waitFor('event: invoice.paid')
    expect(stream.text()).toContain('"invoiceId":"inv-1"')
    expect(stream.text()).toContain('"amount":42')
    stream.close()

    expect((await openStream(port)).status).toBe(401)
    expect((await openStream(port, 'access_token=forged')).status).toBe(401)
  })

  it('boots the scaled-out registration of step 6 and still delivers', async () => {
    /**
     * Guards the README section "Quick Start", step 6, and changes when it does: the block is run
     * as written, with `CookieAuthenticator` in scope the way step 2 left it, and the module it
     * configures is the one booted here. The Redis pub/sub, the offline queue and the `sse`
     * options it passes must be accepted, the connected user still receives an emit and the
     * emit goes out through the Redis client the block created.
     */
    const forRoot = jest.spyOn(server.BymaxRealtimeModule, 'forRoot')
    try {
      runBlock(block('pubsub: new RedisRealtimePubSub'), publicModules, {
        CookieAuthenticator: loadAuthenticator(),
      })
      // A second client on the same in-memory server sees whatever the README's client publishes.
      const observer = new RedisMock('redis://localhost:6379')
      const published: string[] = []
      await observer.psubscribe('*')
      observer.on('pmessage', (_pattern: string, _channel: string, message: string) => {
        published.push(message)
      })
      const dynamicModule = forRoot.mock.results[0]?.value as nestCommon.DynamicModule
      app = (
        await Test.createTestingModule({ imports: [dynamicModule] }).compile()
      ).createNestApplication()
      const port = await listen(app)
      const stream = await openStream(port, 'access_token=good-token')
      await stream.waitFor('event: connection:established')
      await app.get(server.RealtimeService).emitToUser('user-1', 'invoice.paid', { invoiceId: 'x' })
      await stream.waitFor('event: invoice.paid')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(published.some((message) => message.includes('invoice.paid'))).toBe(true)
      observer.disconnect()
      stream.close()
    } finally {
      jest.restoreAllMocks()
    }
  })
})

/**
 * Run the README's `app.module.ts` and `main.ts` blocks as printed. `NestFactory.create` is wrapped
 * only to hand the application to `onCreate` and to turn `listen(3000)` into a free port; the
 * promise resolves with that port once the application is listening.
 */
async function startMainTs(onCreate: (app: INestApplication) => void): Promise<number> {
  let started: INestApplication | undefined
  const nestFactory = {
    create: async (...args: Parameters<typeof nestCore.NestFactory.create>) => {
      const app = await nestCore.NestFactory.create(...args)
      started = app
      onCreate(app)
      const listenOn = app.listen.bind(app)
      app.listen = ((_port: number | string, ...rest: unknown[]) =>
        (listenOn as (...a: unknown[]) => Promise<unknown>)(0, ...rest)) as typeof app.listen
      return app
    },
  }
  const moduleExports = runBlock(block('BymaxRealtimeWebSocketModule.forRoot'), {
    ...publicModules,
    './auth/cookie-authenticator': { CookieAuthenticator: loadAuthenticator() },
  })
  runBlock(block('NestFactory.create'), {
    ...publicModules,
    '@nestjs/core': { ...nestCore, NestFactory: nestFactory },
    './app.module': moduleExports,
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const address = started?.getHttpServer().address() as AddressInfo | null | undefined
    if (address) return address.port
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('main.ts never started listening')
}

/** Connect to `url` with the good cookie; resolves once `connection:established` arrives. */
async function connectAccepted(url: string): Promise<void> {
  const socket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie: 'access_token=good-token' },
  })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connection:established', () => resolve())
      socket.on('connect_error', reject)
    })
  } finally {
    socket.close()
  }
}

/** Connect to `url` without a cookie; resolves with the `err.data.code` of the refusal. */
async function connectRefused(url: string): Promise<string | undefined> {
  const socket = io(url, { transports: ['websocket'], reconnection: false })
  try {
    const refusal = await new Promise<{ data?: { code?: string } }>((resolve) => {
      socket.on('connect_error', resolve)
    })
    return refusal.data?.code
  } finally {
    socket.close()
  }
}

describe('README Quick Start — WebSocket', () => {
  let created: INestApplication | undefined

  afterEach(async () => {
    await created?.close()
    created = undefined
    jest.restoreAllMocks()
  })

  it('boots main.ts with the adapter and accepts or refuses a handshake by cookie', async () => {
    /**
     * Guards the README section "Quick Start", step 7, and changes when it does: the
     * `app.module.ts` and `main.ts` blocks are run as printed. With `RealtimeIoAdapter`
     * installed the module does not log the missing-adapter error, a handshake carrying the good
     * cookie is established, one without a cookie is refused with `REALTIME_AUTH_FAILED`, and the
     * CORS origin the block configures is the one answered.
     */
    const errorLog = jest.spyOn(Logger.prototype, 'error')
    const port = await startMainTs((app) => {
      created = app
    })
    const url = `http://127.0.0.1:${port}`

    await connectAccepted(url)
    expect(await connectRefused(url)).toBe('REALTIME_AUTH_FAILED')

    const preflight = await request(url)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', 'https://app.example.com')
    expect(preflight.headers['access-control-allow-origin']).toBe('https://app.example.com')
    expect(
      errorLog.mock.calls.some((call) => String(call[0]).includes('is not the active WebSocket')),
    ).toBe(false)
  })
})
