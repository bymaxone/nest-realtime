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
import { Catch, Controller, Inject, Post, ServiceUnavailableException } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { RealtimeService } from '../../src/server/services/realtime.service'
import { GENERIC_503_BODY } from '../fixtures/service-unavailable'
import { listeningServer } from '../support/listening-server'

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

/** What an application writes to record these rejections, which Nest's default filter does not log. */
@Catch(ServiceUnavailableException)
class RecordingFilter implements ExceptionFilter {
  readonly caught: ServiceUnavailableException[] = []

  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    this.caught.push(exception)
    const response = host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>()
    response.status(exception.getStatus()).json(exception.getResponse())
  }
}

describe('A transport rejection that reaches HTTP (e2e)', () => {
  let app: INestApplication | undefined

  async function boot(filter?: RecordingFilter): Promise<INestApplication> {
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
    if (filter) app.useGlobalFilters(filter)
    await app.init()
    return app
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // Scenario: the user is offline here, the offline queue fails and so does the bus. Expected: 503
  // with the generic body. Why: a plain Error answers 500, which reads as a defect in the
  // application for what is an outage of its store.
  it('answers 503 with the generic body when an emit has no delivery path', async () => {
    const res = await request(await listeningServer(await boot())).post('/ops/emit')

    expect(res.status).toBe(503)
    expect(res.body).toEqual(GENERIC_503_BODY)
  })

  // Scenario: a revocation that cannot be published. Expected: the same 503 and body.
  it('answers 503 with the generic body when a revocation cannot be published', async () => {
    const res = await request(await listeningServer(await boot())).post('/ops/revoke')

    expect(res.status).toBe(503)
    expect(res.body).toEqual(GENERIC_503_BODY)
  })

  // Scenario: either response, read as raw text. Expected: none of the driver's text, the raiser
  // or the code is in what the client is sent.
  it.each(['/ops/emit', '/ops/revoke'])('puts no driver text in the %s response', async (path) => {
    const res = await request(await listeningServer(await boot())).post(path)

    expect(res.text).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5|redis|SseTransport|REALTIME_/)
    expect(Object.keys(res.headers).join(' ')).not.toMatch(/redis|secret/i)
  })

  // Scenario: the application records these rejections from its own exception filter, since
  // Nest's default filter does not log an HttpException. Expected: the filter receives the instance
  // with the stable code, the message that names the failed call and the cause, while the client
  // still gets the generic body. Why: the README tells an operator to log them there.
  it('hands the instance, with its code, message and cause, to an exception filter', async () => {
    const filter = new RecordingFilter()

    const res = await request(await listeningServer(await boot(filter))).post('/ops/revoke')

    expect(res.status).toBe(503)
    expect(res.body).toEqual(GENERIC_503_BODY)
    expect(filter.caught).toHaveLength(1)
    const [caught] = filter.caught as [ServiceUnavailableException & { code?: string }]
    expect(caught.code).toBe('REALTIME_PUBSUB_UNAVAILABLE')
    expect(caught.message).toBe(
      `[SseTransport] REALTIME_PUBSUB_UNAVAILABLE: the revocation of held-elsewhere could not be published (${DRIVER_TEXT})`,
    )
    expect((caught.cause as Error).message).toBe(DRIVER_TEXT)
  })
})
