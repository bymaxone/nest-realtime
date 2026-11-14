/**
 * @fileoverview End-to-end: an event emitted to a reconnecting user while the application's
 * interceptors run is delivered, and a second read of the offline queue that fails ends the
 * attempt without delivering anything.
 * @layer e2e
 *
 * Constraint under test: the offline queue is read in the guard, so that a hung queue is a status,
 * and once more when the stream is built, for what was appended in between. An interceptor that
 * awaits `emitToUser` before the route runs is the application code that makes the two reads
 * differ: the user has no connection and no replay ring on this instance, so the event goes to the
 * queue only, after the first read and before the connection is registered to receive it live.
 */
import { Inject, Injectable } from '@nestjs/common'
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
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import type {
  IOfflineQueueStorage,
  OfflineQueuedEvent,
} from '../../src/server/interfaces/offline-queue-storage.interface'
import { RealtimeService } from '../../src/server/services/realtime.service'

const ENDPOINT = '/realtime/sse'

/** A queue ordered by arrival, whose reads the test can count and make fail. */
class ArrivalOrderedQueue implements IOfflineQueueStorage {
  readonly events: OfflineQueuedEvent[] = []
  reads = 0
  hangFromRead: number | undefined
  failFromRead: number | undefined
  acknowledged: string[] = []

  async append(_userId: string, event: OfflineQueuedEvent): Promise<void> {
    this.events.push(event)
  }

  retrieveSince(_userId: string, sinceId: string): Promise<OfflineQueuedEvent[]> {
    this.reads += 1
    if (this.failFromRead !== undefined && this.reads >= this.failFromRead) {
      return Promise.reject(new Error('redis 10.1.2.3:6379 unreachable'))
    }
    if (this.hangFromRead !== undefined && this.reads >= this.hangFromRead) {
      return new Promise(() => undefined)
    }
    const at = this.events.findIndex((event) => event.id === sinceId)
    return Promise.resolve(this.events.slice(at + 1))
  }

  async acknowledge(_userId: string, upToId: string): Promise<void> {
    this.acknowledged.push(upToId)
  }
}

/** The kind of application code that emits to the user on the way in: audit, presence, welcome. */
@Injectable()
class EmittingInterceptor implements NestInterceptor {
  constructor(@Inject(RealtimeService) private readonly realtime: RealtimeService) {}

  async intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Promise<ReturnType<CallHandler['handle']>> {
    await this.realtime.emitToUser('u1', 'tick', { n: 2 })
    return next.handle()
  }
}

describe.each([
  ['with an interceptor that emits to the user', true],
  ['without an interceptor', false],
])('SSE reconnect, offline queue read twice, %s (e2e)', (_label, withInterceptor) => {
  let app: INestApplication | undefined
  let queue: ArrivalOrderedQueue

  async function boot(maxPendingHandshakes?: number): Promise<number> {
    queue = new ArrivalOrderedQueue()
    queue.events.push({ id: 'e-1', event: 'tick', data: { n: 1 }, emittedAt: new Date() })
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          authenticateTimeoutMs: 300,
          offlineQueue: queue,
          ...(maxPendingHandshakes === undefined ? {} : { maxPendingHandshakes }),
        }),
      ],
      providers: withInterceptor
        ? [{ provide: APP_INTERCEPTOR, useClass: EmittingInterceptor }]
        : [],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.listen(0)
    return (app.getHttpServer().address() as AddressInfo).port
  }

  /** Reconnect after `e-0`, and collect what the server sends for `waitMs`. */
  function reconnect(
    port: number,
    waitMs: number,
  ): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = get(
        {
          host: '127.0.0.1',
          port,
          path: ENDPOINT,
          headers: { accept: 'text/event-stream', 'last-event-id': 'e-0' },
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            text += chunk
          })
          setTimeout(() => {
            resolve({ status: res.statusCode ?? 0, text, headers: res.headers })
            req.destroy()
          }, waitMs)
        },
      )
      req.on('error', (error) => {
        if (!req.destroyed) reject(error)
      })
    })
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // The loss: the event is in the queue, after the first read, and nothing was registered to get it.
  it('delivers an event emitted between the first read and the registration, once, in order', async () => {
    const port = await boot()
    if (!withInterceptor)
      await queue.append('u1', { id: 'e-2', event: 'tick', data: { n: 2 }, emittedAt: new Date() })

    const { status, text } = await reconnect(port, 600)

    expect(status).toBe(200)
    expect(text.match(/"n":2/g)).toHaveLength(1)
    expect(text.indexOf('"n":1')).toBeGreaterThan(-1)
    expect(text.indexOf('"n":1')).toBeLessThan(text.indexOf('"n":2'))
  })

  // A second read that does not answer must not become a stream that skips the events it was for:
  // the client's cursor has not moved, so its own reconnect reads them all again.
  it('delivers nothing, and acknowledges nothing, when the second read does not answer', async () => {
    const port = await boot()
    queue.hangFromRead = 2

    const { status, text } = await reconnect(port, 900)

    expect(text).not.toContain('"n":1')
    expect(text).not.toContain('connection:established')
    expect(queue.acknowledged).toEqual([])
    expect(withInterceptor ? [200, 503] : [503]).toContain(status)
  })

  // A store that keeps failing must not turn the reconnects it causes into load on the store or on
  // the instance: the reads waiting at once are capped, the rest are refused without a call, and no
  // retry hint is sent, so the client's own reconnect policy is the only pace.
  it('answers a burst of reconnects with a bounded number of store calls, and sends no retry hint', async () => {
    const port = await boot(3)
    queue.hangFromRead = 1

    const replies = await Promise.all(Array.from({ length: 10 }, () => reconnect(port, 900)))

    expect(queue.reads).toBe(3)
    for (const reply of replies) {
      expect(reply.text).not.toContain('"n":')
      if (!withInterceptor) {
        expect(reply.status).toBe(503)
        expect(reply.headers['retry-after']).toBeUndefined()
      }
    }
  })

  // Claude's finding: a store that stays down must not refuse every reconnect. The first read has
  // degraded, so the reconnect is served as it always has been, and the store is not asked again.
  it('serves a reconnect whose store is down, with one read and no error, when the first read fails', async () => {
    const port = await boot()
    queue.failFromRead = 1

    const { status, text } = await reconnect(port, 600)

    expect(status).toBe(200)
    expect(text).toContain('connection:established')
    expect(queue.reads).toBe(1)
  })

  // Codex's finding: the first read succeeded and the second failed, so a stream served with the first
  // read's events alone would move the client's cursor past the ones the second was for. The attempt
  // ends before anything is delivered or acknowledged, and the cause reaches no one.
  it('ends the attempt, delivering and acknowledging nothing, when the second read fails after a first that succeeded', async () => {
    const port = await boot()
    queue.failFromRead = 2

    const { status, text } = await reconnect(port, 600)

    expect(text).not.toContain('"n":1')
    expect(text).not.toContain('connection:established')
    expect(text).not.toContain('10.1.2.3')
    expect(queue.acknowledged).toEqual([])
    expect(queue.reads).toBe(2)
    expect(withInterceptor ? [200, 500] : [500]).toContain(status)
  })
})
