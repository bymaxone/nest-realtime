/**
 * @fileoverview End-to-end: an SSE refusal that needs I/O is an HTTP status, not a 200 stream.
 * @layer e2e
 *
 * In an application with an interceptor registered, Nest commits `200 text/event-stream` from a
 * timer once an `@Sse()` route returns, without waiting for the promise the route returned.
 * Authentication used to run inside that route, so an authenticator that awaited real I/O before
 * refusing lost the race: the client had already received a 200 and then got the refusal as an
 * `event: error` frame, which a browser `EventSource` treats as a reconnectable stream. Without
 * an interceptor Nest answered a late rejection with its status, so every case here runs both
 * ways: the interceptor variant is the one that fails without the guard. The tests drive a real
 * Nest application over real HTTP with authenticators that do what a session or revocation
 * lookup does: await a timer and a file read, then decide.
 */
import { Injectable } from '@nestjs/common'
import type {
  CallHandler,
  ExecutionContext,
  INestApplication,
  NestInterceptor,
} from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { readFile } from 'node:fs/promises'
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import request from 'supertest'
import type { IConnectionAuthenticator } from '../../src/server/interfaces/connection-authenticator.interface'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'

const ENDPOINT = '/realtime/sse'

/** Await what a real authenticator awaits before it decides: a timer tick and a file read. */
async function doIo(): Promise<void> {
  await sleep(0)
  await readFile(__filename)
  await sleep(25)
}

/** The kind of interceptor most applications register (logging, tracing): it passes through. */
@Injectable()
class PassThroughInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    return next.handle()
  }
}

async function boot(
  authenticator: IConnectionAuthenticator,
  withInterceptor: boolean,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxRealtimeModule.forRoot({ transport: 'sse', authenticator })],
    providers: withInterceptor
      ? [{ provide: APP_INTERCEPTOR, useClass: PassThroughInterceptor }]
      : [],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe.each([
  ['with a global interceptor', true],
  ['without an interceptor', false],
])('SSE handshake refusal after I/O, %s (e2e)', (_label, withInterceptor) => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // The contract: credentials that are refused get a 401, whatever the authenticator awaited.
  it('answers 401, not 200, when the authenticator refuses after I/O', async () => {
    app = await boot(
      {
        authenticate: async () => {
          await doIo()
          return null
        },
      },
      withInterceptor,
    )

    const res = await request(app.getHttpServer()).get(ENDPOINT).set('Accept', 'text/event-stream')

    expect(res.status).toBe(401)
    expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
    expect(res.body).toMatchObject({ statusCode: 401, message: 'REALTIME_AUTH_FAILED' })
  })

  // Same for the authenticator that cannot decide: an infrastructure failure is a 5xx.
  it('answers 500, not 200, when the authenticator throws after I/O', async () => {
    app = await boot(
      {
        authenticate: async () => {
          await doIo()
          throw new Error('session store unreachable')
        },
      },
      withInterceptor,
    )

    const res = await request(app.getHttpServer()).get(ENDPOINT).set('Accept', 'text/event-stream')

    expect(res.status).toBe(500)
    expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
  })

  // A blank identity from an authenticator that did I/O stays a generic 500 before the stream.
  it('answers 500 for a blank identity returned after I/O', async () => {
    app = await boot(
      {
        authenticate: async () => {
          await doIo()
          return { userId: '' }
        },
      },
      withInterceptor,
    )

    const res = await request(app.getHttpServer()).get(ENDPOINT).set('Accept', 'text/event-stream')

    expect(res.status).toBe(500)
  })

  // Accepted credentials still open the stream, and the authenticator ran once for the request.
  it('opens the stream with connection:established when the authenticator accepts after I/O', async () => {
    const authenticate = jest.fn(async () => {
      await doIo()
      return { userId: 'u-1', tenantId: 't-1' }
    })
    app = await boot({ authenticate }, withInterceptor)
    await app.listen(0)
    const { port } = app.getHttpServer().address() as AddressInfo

    // The stream opens with a bare newline, so read until the event itself has arrived.
    const opened = await new Promise<{ status: number | undefined; type: string; text: string }>(
      (resolve, reject) => {
        const req = get(
          { host: '127.0.0.1', port, path: ENDPOINT, headers: { Accept: 'text/event-stream' } },
          (res) => {
            let text = ''
            res.on('data', (chunk: Buffer) => {
              text += chunk.toString('utf8')
              if (!text.includes('connection:established')) return
              resolve({ status: res.statusCode, type: String(res.headers['content-type']), text })
              req.destroy()
            })
          },
        )
        req.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err)
        })
      },
    )

    expect(opened.status).toBe(200)
    expect(opened.type).toMatch(/text\/event-stream/)
    expect(opened.text).toContain('connection:established')
    expect(authenticate).toHaveBeenCalledTimes(1)
  })
})
