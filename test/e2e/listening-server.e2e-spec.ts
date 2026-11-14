/**
 * End-to-end proof that a server handed to supertest already listening is bound once for any
 * number of sequential requests.
 *
 * Layer: e2e.
 * Goal: pin the rule behind `test/support/listening-server.ts`. supertest 7.3.x closes a server it
 *   started itself once its pending requests settle and starts it again for the next request, so
 *   N sequential requests to a server that is not listening bind N listeners, each on a new port.
 *   Through `listeningServer` they bind one. The control documents the behaviour measured on the
 *   installed supertest; if a release stops doing it, the control fails and the helper can go.
 * Mocks: none. A one-route Nest application on ephemeral ports.
 */
import { Controller, Get } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Server as NetServer } from 'node:net'
import request from 'supertest'
import { listeningServer } from '../support/listening-server'

/** Enough sequential requests that one listener for each of them is unmistakable. */
const SEQUENTIAL_REQUESTS = 50

@Controller()
class PingController {
  @Get('ping')
  ping(): string {
    return 'pong'
  }
}

describe('Listeners started for sequential requests (e2e)', () => {
  let app: INestApplication | undefined

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    return app
  }

  /** Sends the requests one after the other and returns how many listeners were started. */
  async function startsFor(server: Parameters<typeof request>[0]): Promise<number> {
    const listen = jest.spyOn(NetServer.prototype, 'listen')
    try {
      for (let sent = 0; sent < SEQUENTIAL_REQUESTS; sent++) {
        expect((await request(server).get('/ping')).text).toBe('pong')
      }
      return listen.mock.calls.length
    } finally {
      listen.mockRestore()
    }
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  // Scenario: a server handed over listening. Expected: no listener is started by the requests.
  // Why: this is the rule the helper exists for.
  it('starts no listener for sequential requests to a server handed over listening', async () => {
    const server = await listeningServer(await boot())

    expect(await startsFor(server)).toBe(0)
    expect(server.listening).toBe(true)
  })

  // Scenario: the same requests to a server that is not listening. Expected: one listener each.
  // Why: the measured behaviour of supertest 7.3.x, which is what the helper avoids.
  it('control: supertest starts one listener for each sequential request without the helper', async () => {
    const server = (await boot()).getHttpServer()

    expect(await startsFor(server)).toBe(SEQUENTIAL_REQUESTS)
  })
})
