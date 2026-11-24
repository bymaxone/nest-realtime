/**
 * @fileoverview End-to-end: a refused SSE handshake stays refused when Promise built-ins are replaced after load.
 * @layer e2e
 *
 * Constraint under test: the handshake gate reads what the authenticator answered under a deadline. If that read goes
 * through `Promise.race`, `Promise.resolve` or `then`, a host-side replacement of one of them admits the connection as
 * whoever it names. Over real HTTP, an authenticator that refuses must still get a 401 with each of them replaced.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { get } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { BymaxRealtimeModule } from '../../src/server/realtime.module'
import { FORGED_BUILTINS, withPromiseForged } from '../support/forged-promise'
import { listeningServer } from '../support/listening-server'

const ENDPOINT = '/realtime/sse'

describe('SSE handshake with a Promise built-in replaced after load', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  async function serve(): Promise<Server> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxRealtimeModule.forRoot({
          transport: 'sse',
          authenticator: { authenticate: async () => null },
        }),
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    return await listeningServer(app)
  }

  it('refuses with 401 when no replacement is active', async () => {
    const server = await serve()

    const res = await request(server).get(ENDPOINT).set('Accept', 'text/event-stream')

    expect(res.status).toBe(401)
  })

  // A replaced `then` is covered by the unit rows: with it replaced Nest does not turn the refusal into a response (the
  // UnauthorizedException escapes uncaught), so there is no HTTP status to read.
  it.each(FORGED_BUILTINS.filter((kind) => kind !== 'then'))(
    'still refuses with 401 when Promise.%s is replaced to name an identity',
    async (kind) => {
      const server = await serve()

      // Plain `http` and a promise made with `new`: supertest settles through `then` and `resolve`, which are replaced here.
      const { port } = server.address() as AddressInfo
      const status = await withPromiseForged(
        kind,
        { userId: 'attacker' },
        () =>
          new Promise<number>((resolve) => {
            const req = get(
              { port, path: ENDPOINT, headers: { Accept: 'text/event-stream' } },
              (res) => {
                resolve(res.statusCode ?? -1)
                req.destroy()
              },
            )
            req.on('error', () => resolve(-1))
          }),
      )

      expect(status).toBe(401)
    },
  )
})
