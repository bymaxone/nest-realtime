/**
 * @fileoverview End-to-end: a consumer's controller that lets a transport rejection escape answers
 * 503 with the generic body, and nothing of the driver's text reaches the client.
 * @layer e2e
 *
 * Constraint under test: `emitToUser` and `disconnect` reject with the library's own error when no
 * delivery path exists, and that error is a 503 to whoever it reaches over HTTP. The text an
 * operator reads (host, credentials, the failed call) is on the instance, never in the response.
 * The queue and the bus fail with a driver-style message so a leak into the body is visible.
 */
import { Controller, Inject, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { RealtimeService } from '../../src/server/services/realtime.service'
import { GENERIC_503_BODY } from '../fixtures/service-unavailable'

const DRIVER_TEXT = 'connect ECONNREFUSED redis://user:secret@10.0.0.5:6379'

/** What a consumer's own controller does: it calls the service and lets a rejection escape. */
@Controller('ops')
class OperationsController {
  constructor(@Inject(RealtimeService) private readonly realtime: RealtimeService) {}

  @Post('emit')
  async emit(): Promise<void> {
    await this.realtime.emitToUser('nobody-here', 'evt', { n: 1 })
  }

  @Post('revoke')
  async revoke(): Promise<void> {
    await this.realtime.disconnect('held-elsewhere', 'revoked')
  }
}

describe('A transport rejection that reaches HTTP (e2e)', () => {
  let app: INestApplication | undefined

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => ({ userId: 'u1' }) },
          offlineQueue: {
            retrieveSince: async () => [],
            acknowledge: async () => undefined,
            append: () => Promise.reject(new Error(DRIVER_TEXT)),
          },
          pubsub: {
            publish: () => Promise.reject(new Error(DRIVER_TEXT)),
            subscribe: async () => async () => undefined,
          },
        }),
      ],
      controllers: [OperationsController],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    return app
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // Scenario: the user is offline here, the offline queue fails and so does the bus. Expected: 503
  // with the generic body. Why: a plain Error answers 500, which reads as a defect in the
  // application for what is an outage of its store, and its text would carry the driver's message.
  it('answers 503 with the generic body when an emit has no delivery path', async () => {
    const res = await request((await boot()).getHttpServer()).post('/ops/emit')

    expect(res.status).toBe(503)
    expect(res.body).toEqual(GENERIC_503_BODY)
  })

  // Scenario: a revocation that cannot be published. Expected: the same 503 and body.
  it('answers 503 with the generic body when a revocation cannot be published', async () => {
    const res = await request((await boot()).getHttpServer()).post('/ops/revoke')

    expect(res.status).toBe(503)
    expect(res.body).toEqual(GENERIC_503_BODY)
  })

  // Scenario: either response, read as raw text. Expected: none of the driver's text, the raiser
  // or the code is in what the client is sent.
  it.each(['/ops/emit', '/ops/revoke'])('puts no driver text in the %s response', async (path) => {
    const res = await request((await boot()).getHttpServer()).post(path)

    expect(res.text).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5|redis|SseTransport|REALTIME_/)
    expect(Object.keys(res.headers).join(' ')).not.toMatch(/redis|secret/i)
  })
})
