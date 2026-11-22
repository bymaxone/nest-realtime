/**
 * @fileoverview A key planted on `Object.prototype` does not open the WebSocket transport to another origin, nor stand in for the authenticator, over a real Socket.IO server.
 * @layer transport
 */
import type { AddressInfo } from 'node:net'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { BymaxRealtimeWebSocketModule } from './realtime-websocket.module'
import { RealtimeIoAdapter } from './transports/websocket/realtime-io-adapter'

jest.setTimeout(20_000)

const GOOD = 'https://good.example'
const EVIL = 'https://evil.example'
const authenticator = { authenticate: async () => null }
/** What a planted cors block would do if it were read: every origin, with credentials. */
const OPEN = { origin: true, credentials: true }

type Make = (options: object) => ReturnType<typeof BymaxRealtimeWebSocketModule.forRoot>

const viaForRoot: Make = (options) => BymaxRealtimeWebSocketModule.forRoot(options as never)
const viaForRootAsync: Make = (options) =>
  BymaxRealtimeWebSocketModule.forRootAsync({
    transport: 'websocket',
    useFactory: () => options as never,
  })

/** `key` planted on the root prototype while `run` runs; what it held under that name is put back when `run` settles. */
async function planted<T>(key: string, value: unknown, run: () => Promise<T>): Promise<T> {
  const root = Object.prototype as unknown as Record<string, unknown>
  const before = Object.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
  try {
    return await run()
  } finally {
    if (before === undefined) delete root[key]
    else Object.defineProperty(Object.prototype, key, before)
  }
}

describe('a key planted on the root prototype, over a real handshake', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    jest.restoreAllMocks()
  })

  /**
   * Boots the module with the planted key present while it is built (and `constructor` of the root prototype
   * overwritten too, when `constructorValue` is given), and asks it from `origin` with the key planted again.
   */
  async function headersFor(
    make: Make,
    options: object,
    key: string,
    value: unknown,
    origin: string,
    constructorValue?: unknown,
  ): Promise<Record<string, unknown>> {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const build = (): Promise<TestingModule> =>
      Test.createTestingModule({ imports: [make(options)] }).compile()
    const module = await planted(key, value, () =>
      constructorValue === undefined ? build() : planted('constructor', constructorValue, build),
    )
    app = module.createNestApplication()
    app.useWebSocketAdapter(new RealtimeIoAdapter(app))
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    // The key is planted again while the request is served: the packages the server hands its options to read them
    // at request time as well as at boot.
    return planted(
      key,
      value,
      async () =>
        (
          await request(`http://127.0.0.1:${port}`)
            .get('/socket.io/?EIO=4&transport=polling')
            .set('Origin', origin)
        ).headers,
    )
  }

  const registrations: ReadonlyArray<readonly [string, Make]> = [
    ['forRoot', viaForRoot],
    ['forRootAsync', viaForRootAsync],
  ]

  describe.each(registrations)('through %s', (_name, make) => {
    // Scenario: the host set no cors block and a cors block that allows every origin with credentials is planted.
    // Expected: a foreign origin gets neither an allow-origin nor an allow-credentials header.
    it('does not open a server that has no cors block', async () => {
      const headers = await headersFor(
        make,
        { transport: 'websocket', authenticator, websocket: {} },
        'cors',
        OPEN,
        EVIL,
      )

      expect(headers['access-control-allow-origin']).toBeUndefined()
      expect(headers['access-control-allow-credentials']).toBeUndefined()
    })

    // Scenario: the host set no websocket group, and a whole group with an open cors block is planted. Expected: the
    // same.
    it('does not open a server that has no websocket group', async () => {
      const headers = await headersFor(
        make,
        { transport: 'websocket', authenticator },
        'websocket',
        { cors: OPEN },
        EVIL,
      )

      expect(headers['access-control-allow-origin']).toBeUndefined()
      expect(headers['access-control-allow-credentials']).toBeUndefined()
    })

    // Scenario: the host set an allowlist and no credentials, and credentials: true is planted. Expected: the request is
    // refused, so the allowed origin is not answered with credentials.
    it('does not add credentials to an allowlist', async () => {
      const headers = await headersFor(
        make,
        { transport: 'websocket', authenticator, websocket: { cors: { origin: [GOOD] } } },
        'credentials',
        true,
        GOOD,
      )

      expect(headers['access-control-allow-credentials']).toBeUndefined()
    })

    // Scenario: the host gave no authenticator and one is planted. Expected: the module is not built.
    it('does not take the authenticator from a planted key', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
      const outcome = await planted('authenticator', authenticator, async () => {
        try {
          await Test.createTestingModule({ imports: [make({ transport: 'websocket' })] }).compile()
          return 'built'
        } catch (error) {
          return (error as { code?: string }).code
        }
      })

      expect(outcome).toBe('REALTIME_NO_AUTHENTICATOR')
    })
  })
})
