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
      'refuses to boot when %s is set and the adapter is not RealtimeIoAdapter',
      async (_name, websocket) => {
        // Neither option would apply, which leaves polling on and no origin check, so the boot is refused, not logged.
        gateway = (await buildModule({ websocket })).get(RealtimeGateway)

        expect(() => gateway.afterInit({ use: jest.fn() } as never)).toThrow(
          /REALTIME_TRANSPORT_UNAVAILABLE.*app\.useWebSocketAdapter\(new RealtimeIoAdapter\(app\)\)/,
        )
        expect(errorSpy).not.toHaveBeenCalled()
      },
    )

    it('only logs when websocketOnly is false', async () => {
      gateway = (await buildModule({ websocket: { websocketOnly: false } })).get(RealtimeGateway)

      expect(() => gateway.afterInit({ use: jest.fn() } as never)).not.toThrow()
      expect(errorSpy).toHaveBeenCalledTimes(1)
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
