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

    it.each([
      ['allowedOrigins', { allowedOrigins: ['https://app.example'] }],
      ['websocketOnly', { websocketOnly: true }],
    ])(
      'refuses the boot when %s is set and the adapter is not RealtimeIoAdapter',
      async (_name, websocket) => {
        // Neither option would apply, which leaves polling on and no origin check, so the boot is refused, not logged.
        // The refusal is thrown from a hook Nest awaits: a throw from afterInit lands in an rxjs subscriber and
        // surfaces later as an uncaughtException, after the application is already serving.
        gateway = (await buildModule({ websocket })).get(RealtimeGateway)

        expect(() => gateway.afterInit({ use: jest.fn() } as never)).not.toThrow()
        expect(() => gateway.onApplicationBootstrap()).toThrow(
          /REALTIME_TRANSPORT_UNAVAILABLE.*app\.useWebSocketAdapter\(new RealtimeIoAdapter\(app\)\)/,
        )
        expect(errorSpy).not.toHaveBeenCalled()
      },
    )

    it('rejects app.init() of a real application that sets allowedOrigins without the adapter', async () => {
      // The unit row above reads the hook; this one reads what a host sees: init rejecting, nothing listening.
      const moduleRef = await buildModule({
        websocket: { allowedOrigins: ['https://app.example'] },
      })
      const app = moduleRef.createNestApplication({ logger: false })
      try {
        await expect(app.init()).rejects.toThrow(/REALTIME_TRANSPORT_UNAVAILABLE/)
      } finally {
        await app.close()
      }
    })

    it('does not refuse the bootstrap when the options are not asking for the policy', async () => {
      gateway.afterInit({ use: jest.fn() } as never)

      expect(() => gateway.onApplicationBootstrap()).not.toThrow()
    })

    it('only logs when websocketOnly is false', async () => {
      gateway = (await buildModule({ websocket: { websocketOnly: false } })).get(RealtimeGateway)

      expect(() => gateway.afterInit({ use: jest.fn() } as never)).not.toThrow()
      expect(() => gateway.onApplicationBootstrap()).not.toThrow()
      expect(errorSpy).toHaveBeenCalledTimes(1)
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

    it('does not list as ignored what is applied without the adapter', async () => {
      const message = await reported({
        emitConnectionEvent: false,
        maxConnectionsPerUser: 2,
        cors: { origin: 'https://app.example' },
        pingIntervalMs: 1000,
        pingTimeoutMs: 1000,
        maxHttpBufferSize: 10,
      })

      expect(message).toBe(missing(' (cors, pingIntervalMs, pingTimeoutMs, maxHttpBufferSize)'))
    })

    it.each([
      ['no policy', {}],
      ['the policy', { websocketOnly: true }],
    ])(
      'refuses the boot from onApplicationBootstrap when the server has no `use`, with %s',
      async (_case, websocket) => {
        // The handshake authenticator cannot be installed on it, and a throw from afterInit would surface only after
        // the application is serving.
        gateway = (await buildModule({ websocket })).get(RealtimeGateway)

        expect(() => gateway.afterInit({} as never)).not.toThrow()
        expect(() => gateway.onApplicationBootstrap()).toThrow(/REALTIME_TRANSPORT_UNAVAILABLE/)
      },
    )

    // Scenario: a server with no `use`. Expected: the whole refusal, led by the gateway.
    it('says what is missing and how to add it when the server has no `use`', async () => {
      gateway = (await buildModule()).get(RealtimeGateway)
      gateway.afterInit({} as never)

      expect(() => gateway.onApplicationBootstrap()).toThrow(
        /^\[RealtimeGateway\] REALTIME_TRANSPORT_UNAVAILABLE: the WebSocket server has no `use` method, so the handshake authenticator cannot be installed\. Add app\.useWebSocketAdapter\(new RealtimeIoAdapter\(app\)\)/,
      )
    })

    // Scenario: the policy asked for under another adapter. Expected: the message leads with the gateway.
    it('names the gateway when it refuses a policy under another adapter', async () => {
      gateway = (await buildModule({ websocket: { websocketOnly: true } })).get(RealtimeGateway)
      gateway.afterInit({ use: jest.fn() } as never)

      expect(() => gateway.onApplicationBootstrap()).toThrow(
        /^\[RealtimeGateway\] REALTIME_TRANSPORT_UNAVAILABLE: /,
      )
    })

    // Scenario: websocketOnly is false under another adapter. Expected: it is listed with what is dropped.
    it('lists a websocketOnly of false among the dropped options', async () => {
      expect(await reported({ websocketOnly: false })).toBe(missing(' (websocketOnly)'))
    })

    it('never serves HTTP for an application whose WebSocket server has no `use`', async () => {
      const app = (await buildModule()).createNestApplication({ logger: false })
      app.useWebSocketAdapter({
        create: () => ({}),
        bindClientConnect: () => undefined,
        bindMessageHandlers: () => undefined,
        close: () => undefined,
        dispose: async () => undefined,
      } as never)
      try {
        await expect(app.listen(0, '127.0.0.1')).rejects.toThrow(/REALTIME_TRANSPORT_UNAVAILABLE/)
        expect(app.getHttpServer().listening).toBe(false)
      } finally {
        await app.close()
      }
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
