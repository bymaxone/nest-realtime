/**
 * @fileoverview Unit tests for the check RealtimeGateway makes at start-up that RealtimeIoAdapter created its server.
 * @layer transport
 */
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { Test } from '@nestjs/testing'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { lineOf } from '../../../../test/support/log-lines'
import { WebSocketTransport } from './websocket.transport'
import { RealtimeGateway } from './realtime.gateway'
import { RealtimeIoAdapter } from './realtime-io-adapter'

/** A gateway over a transport that only takes the server, with the given options. */
function buildModule(optionsOverrides: Partial<BymaxRealtimeModuleOptions> = {}) {
  return Test.createTestingModule({
    providers: [
      RealtimeGateway,
      { provide: WebSocketTransport, useValue: { setServer: jest.fn() } },
      {
        provide: REALTIME_OPTIONS_TOKEN,
        useValue: { sse: {}, ...optionsOverrides } as BymaxRealtimeModuleOptions,
      },
    ],
  }).compile()
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway

  beforeEach(async () => {
    gateway = (await buildModule()).get(RealtimeGateway)
  })

  describe('afterInit — the adapter check', () => {
    let errorSpy: jest.SpyInstance

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it('reports a server that RealtimeIoAdapter did not create, naming the fix and the options it drops', async () => {
      // Under any other adapter the websocket.* options are dropped and the gateway's own
      // CORS (origin: false) stays in force, so the message has to say what to add.
      gateway = (
        await buildModule({
          websocket: { cors: { origin: 'https://app.example' }, redisAdapter: { pubClient: {} } },
        })
      ).get(RealtimeGateway)

      gateway.afterInit({ use: jest.fn() } as never)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const message = lineOf(errorSpy.mock.calls[0]?.[0])
      expect(message).toContain('RealtimeIoAdapter is not the active WebSocket adapter')
      expect(message).toContain('(cors, redisAdapter)')
      expect(message).toContain('origin: false')
      expect(message).toContain('app.useWebSocketAdapter(new RealtimeIoAdapter(app))')
      expect(message).toContain("'@bymax-one/nest-realtime/websocket'")
    })

    it('still reports it when no websocket option is set, without naming any', () => {
      // The gateway CORS is closed whether or not the consumer configured anything.
      gateway.afterInit({ use: jest.fn() } as never)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const message = lineOf(errorSpy.mock.calls[0]?.[0])
      expect(message).toContain('so the websocket options are ignored and the gateway CORS')
      expect(message).not.toMatch(/websocket options \(/)
    })

    /** The whole message, up to what is added for a configured namespace. */
    const missing = (dropped: string): string =>
      'RealtimeIoAdapter is not the active WebSocket adapter, so the websocket options' +
      dropped +
      ' are ignored and the gateway CORS stays closed (origin: false): browsers on another origin cannot connect. ' +
      'Add app.useWebSocketAdapter(new RealtimeIoAdapter(app)) in main.ts, importing it from ' +
      "'@bymax-one/nest-realtime/websocket'."

    /** What the gateway reports for `websocket`, under an adapter that is not the library's. */
    async function reported(websocket: BymaxRealtimeModuleOptions['websocket']): Promise<string> {
      const options = websocket === undefined ? {} : { websocket }
      gateway = (await buildModule(options)).get(RealtimeGateway)
      gateway.afterInit({ use: jest.fn() } as never)
      return lineOf(errorSpy.mock.calls[0]?.[0])
    }

    it('adds what a configured namespace still does, and does not list it as ignored', async () => {
      // The namespace is applied without the adapter, so it is not listed as ignored; it leaves other namespaces open.
      const message = await reported({ namespace: '/rt', cors: { origin: 'https://app.example' } })

      expect(message).toBe(
        missing(' (cors)') +
          " websocket.namespace is applied without it: the library is served there, and the library's authenticator " +
          "does not run for the clients of '/' or of any other gateway's namespace. Isolation from your gateways' " +
          'namespaces is not guaranteed without RealtimeIoAdapter.',
      )
    })

    it.each([
      ['no namespace and no option', undefined, ''],
      ['no namespace beside an option', { cors: { origin: 'https://app.example' } }, ' (cors)'],
      ["the namespace '/'", { namespace: '/' }, ''],
    ])('says nothing about the namespace with %s', async (_case, websocket, dropped) => {
      // The library is on '/' then, with every other gateway that declares none.
      expect(await reported(websocket)).toBe(missing(dropped))
    })

    it('says in the README exactly what it logs', () => {
      // A consumer who meets the message looks it up in the README, so the text must match.
      gateway.afterInit({ use: jest.fn() } as never)
      const message = lineOf(errorSpy.mock.calls[0]?.[0])
      const readme = readFileSync(join(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8')

      expect(readme).toContain(message)
    })

    it('stays silent when the server came from RealtimeIoAdapter', () => {
      // The adapter is the supported setup, so the gateway has nothing to report.
      const stub: Record<string, unknown> = {
        adapter: jest.fn(),
        use: jest.fn(),
        on: jest.fn(),
        of: () => stub,
      }
      const superSpy = jest
        .spyOn(IoAdapter.prototype, 'createIOServer')
        .mockReturnValue(stub as never)
      try {
        const app = { get: jest.fn().mockReturnValue({ sse: {} }) }
        const server = new RealtimeIoAdapter(app as never).createIOServer(3000)

        gateway.afterInit(server as never)

        expect(errorSpy).not.toHaveBeenCalled()
      } finally {
        superSpy.mockRestore()
      }
    })
  })
})
