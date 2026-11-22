/**
 * @fileoverview End-to-end: the library matches no origin on the SSE endpoint, whatever `websocket.cors` holds.
 * @layer e2e
 *
 * Constraint under test: `websocket.cors` is the WebSocket transport's alone. The SSE endpoint is a plain HTTP
 * GET, so which origins may read its answer is the host application's `app.enableCors`, and nothing the library
 * is given decides it: a request from any origin gets no `Access-Control-Allow-Origin` from the module, with
 * the origin allowlist set or not. The source reads the same: nothing under `src/server/transports/sse` reads the
 * `Origin` of a request or sets a CORS header.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { listeningServer } from '../support/listening-server'

const ENDPOINT = '/realtime/sse'
const GOOD = 'https://good.example'
const EVIL = 'https://evil.example'

async function boot(websocket: object | undefined): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxRealtimeModule.forRoot({
        transport: 'sse',
        authenticator: { authenticate: async () => null },
        ...(websocket === undefined ? {} : { websocket }),
      }),
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('Origins on the SSE endpoint (e2e)', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // Scenario: an origin allowlist in websocket.cors, and a request to the SSE endpoint from an origin on it and from
  // one that is not. Expected: neither answer carries an allow-origin header from the module.
  it.each([
    ['an origin on the websocket allowlist', GOOD],
    ['an origin that is not on it', EVIL],
  ])('adds no allow-origin header for %s', async (_name, origin) => {
    app = await boot({ cors: { origin: GOOD, credentials: true } })

    const res = await request(await listeningServer(app))
      .get(ENDPOINT)
      .set('Accept', 'text/event-stream')
      .set('Origin', origin)

    expect(res.status).toBe(401)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  // Scenario: no websocket options at all. Expected: the same, so the answer does not depend on the block.
  it('adds no allow-origin header when there is no websocket block', async () => {
    app = await boot(undefined)

    const res = await request(await listeningServer(app))
      .get(ENDPOINT)
      .set('Accept', 'text/event-stream')
      .set('Origin', GOOD)

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
