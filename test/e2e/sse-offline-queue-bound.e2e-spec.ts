/**
 * @fileoverview End-to-end: a reconnect whose offline queue does not answer is an HTTP 503, not a
 * 200 stream.
 * @layer e2e
 *
 * Constraint under test: the read of the offline queue is bounded, and its refusal reaches the
 * client as a status in every configuration. With an interceptor registered Nest commits
 * `200 text/event-stream` from a timer once an `@Sse()` route returns, so a refusal that needs I/O
 * has to be decided in the guard, as authentication is. Every case runs both ways; the interceptor
 * variant is the one that fails when the read is made inside the route.
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
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { ConnectionRegistry } from '../../src/server/services/connection-registry.service'

const ENDPOINT = '/realtime/sse'

/** The kind of interceptor most applications register (logging, tracing): it passes through. */
@Injectable()
class PassThroughInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    return next.handle()
  }
}

describe.each([
  ['with a global interceptor', true],
  ['without an interceptor', false],
])('SSE reconnect with a hung offline queue, %s (e2e)', (_label, withInterceptor) => {
  let app: INestApplication | undefined
  let registry: ConnectionRegistry

  async function boot(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          authenticateTimeoutMs: 300,
          offlineQueue: {
            retrieveSince: () => new Promise(() => undefined),
            acknowledge: async () => undefined,
            append: async () => undefined,
          },
        }),
      ],
      providers: withInterceptor
        ? [{ provide: APP_INTERCEPTOR, useClass: PassThroughInterceptor }]
        : [],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    registry = app.get(ConnectionRegistry)
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('answers 503 with the generic body once the bound has passed, and registers nothing', async () => {
    await boot()
    const started = Date.now()

    const res = await request(app!.getHttpServer())
      .get(ENDPOINT)
      .set('Accept', 'text/event-stream')
      .set('Last-Event-ID', 'e-1')

    expect(res.status).toBe(503)
    expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
    expect(`${res.text}${JSON.stringify(res.body)}`).not.toMatch(/queue|offline/i)
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect(registry.count()).toBe(0)
  })

  it('opens the stream at once for a request that carries no Last-Event-ID', async () => {
    await boot()
    await app!.listen(0)
    const { port } = app!.getHttpServer().address() as AddressInfo

    const reply = await new Promise<{ status: number; first: string }>((resolve, reject) => {
      const req = get(
        { host: '127.0.0.1', port, path: ENDPOINT, headers: { accept: 'text/event-stream' } },
        (res) => {
          res.setEncoding('utf8')
          let seen = ''
          res.on('data', (chunk: string) => {
            seen += chunk
            if (!seen.includes('connection:established')) return
            resolve({ status: res.statusCode ?? 0, first: seen })
            req.destroy()
          })
        },
      )
      req.on('error', (error) => {
        if (req.destroyed) return
        reject(error)
      })
    })

    expect(reply.status).toBe(200)
    expect(reply.first).toContain('connection:established')
  })
})
