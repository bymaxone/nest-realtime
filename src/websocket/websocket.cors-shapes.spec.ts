/**
 * @fileoverview The origin allowlist of `websocket.cors` holds, whatever way the host defines `origin`, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const GOOD = 'https://good.example'
const EVIL = 'https://evil.example'
const ALLOWED = [GOOD]

/** Each way `origin` can be defined; a spread of the block loses every one except the first. */
const shapes: ReadonlyArray<readonly [string, () => object]> = [
  ['an own data property', () => ({ origin: ALLOWED, credentials: true })],
  [
    'a class getter',
    () =>
      new (class {
        credentials = true
        get origin(): string[] {
          return ALLOWED
        }
      })(),
  ],
  [
    'a non-enumerable property',
    () => Object.defineProperties({ credentials: true }, { origin: { value: ALLOWED } }),
  ],
  [
    'a prototype property',
    () => Object.assign(Object.create({ origin: ALLOWED }), { credentials: true }),
  ],
]

describe('websocket.cors over a real server', () => {
  let app: INestApplication

  afterEach(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  async function answerTo(cors: object, origin: string): Promise<unknown> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const module = await Test.createTestingModule({
      imports: [
        BymaxRealtimeWebSocketModule.forRoot({
          transport: 'websocket',
          authenticator: { authenticate: async () => null },
          websocket: { cors },
        } as never),
      ],
    }).compile()
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    const response = await request(`http://127.0.0.1:${port}`)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', origin)
    return response.headers['access-control-allow-origin']
  }

  // Scenario: an allowlist of one origin, and a request from another. Expected: no allow-all header, and the
  // allowed origin is answered with itself.
  it.each(shapes)('answers the allowed origin only, when origin is %s', async (_name, build) => {
    expect(await answerTo(build(), EVIL)).toBeUndefined()
    await app.close()
    expect(await answerTo(build(), GOOD)).toBe(GOOD)
  })
})
