/**
 * @fileoverview An authenticator that never answers must neither hold requests for ever nor be
 * asked again for every new one, over a real HTTP server.
 * @layer transport
 */
import { get } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BymaxRealtimeModule } from '../../realtime.module'

jest.setTimeout(20_000)

const TIMEOUT_MS = 300

/** Request the SSE route; resolve with its status, its body and how long it took. */
function request(port: number): Promise<{ status: number | undefined; body: string; ms: number }> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: '/realtime/sse',
        headers: { accept: 'text/event-stream' },
        agent: false,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - startedAt }))
      },
    )
    req.on('error', reject)
  })
}

describe('SSE handshakes with an authenticator that never answers', () => {
  let app: INestApplication
  let port: number
  let authenticate: jest.Mock

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    authenticate = jest.fn(() => new Promise(() => undefined))
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate },
          authenticateTimeoutMs: TIMEOUT_MS,
          maxPendingHandshakes: 2,
        }),
      ],
    }).compile()
    app = module.createNestApplication()
    await app.listen(0)
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterEach(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  // Without a bound the request is held for ever: nothing is written and nothing times out.
  it('answers 503 with the generic body after authenticateTimeoutMs', async () => {
    const answer = await request(port)

    expect(answer.status).toBe(503)
    expect(answer.ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 50)
    expect(answer.ms).toBeLessThan(TIMEOUT_MS * 8)
    expect(answer.body).toBe('{"message":"Service Unavailable","statusCode":503}')
  })

  // The two abandoned calls are still open against the authenticator, so they hold their places:
  // a third handshake is refused at once and the authenticator is not asked.
  it('refuses a handshake at once, without asking, once abandoned calls fill the limit', async () => {
    const firstTwo = await Promise.all([request(port), request(port)])
    expect(firstTwo.map((answer) => answer.status)).toStrictEqual([503, 503])
    expect(authenticate).toHaveBeenCalledTimes(2)

    const third = await request(port)

    expect(third.status).toBe(503)
    expect(third.ms).toBeLessThan(TIMEOUT_MS / 2)
    expect(authenticate).toHaveBeenCalledTimes(2)
  })
})
