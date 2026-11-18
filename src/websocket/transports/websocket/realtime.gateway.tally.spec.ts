/**
 * @fileoverview The gateway counts the handshakes it refuses on the path with no middleware result, as the SSE handler does.
 * @layer transport
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  AuthenticationUnavailableError,
  ConnectionLimitError,
  REALTIME_OPTIONS_TOKEN,
  RealtimeMetricsTally,
} from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'
import { WebSocketTransport } from './websocket.transport'

/** A socket with the few members `handleConnection` reads. */
function socket(): Record<string, unknown> {
  return {
    id: 's1',
    handshake: { query: {}, headers: {}, auth: {} },
    conn: { once: jest.fn(), off: jest.fn() },
    disconnect: jest.fn(),
  }
}

describe('RealtimeGateway.handleConnection counts what it refuses', () => {
  let gateway: RealtimeGateway
  let tally: RealtimeMetricsTally
  let transport: Record<string, jest.Mock | boolean>

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    tally = new RealtimeMetricsTally()
    transport = {
      admit: jest.fn(() => ({ release: jest.fn(), renew: jest.fn() })),
      authenticate: jest.fn(),
      registerSocket: jest.fn().mockResolvedValue(undefined),
      shuttingDown: false,
    }
    const module = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        RealtimeMetricsTally,
        { provide: WebSocketTransport, useValue: transport },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: { sse: {} } },
      ],
    })
      .overrideProvider(RealtimeMetricsTally)
      .useValue(tally)
      .compile()
    gateway = module.get(RealtimeGateway)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const refused = (): unknown => tally.snapshot().refused

  // Scenario: a socket reaches handleConnection without a handshake result and the authenticator rejects it.
  it('counts a rejected re-authentication as unauthorized', async () => {
    ;(transport['authenticate'] as jest.Mock).mockResolvedValue(null)
    await gateway.handleConnection(socket() as never)
    expect(refused()).toEqual({ limit: 0, unauthorized: 1, unavailable: 0 })
  })

  // Scenario: the instance is full when such a socket asks for its place.
  it('counts a full instance as limit', async () => {
    ;(transport['admit'] as jest.Mock).mockImplementation(() => {
      throw new ConnectionLimitError(1)
    })
    await gateway.handleConnection(socket() as never)
    expect(refused()).toEqual({ limit: 1, unauthorized: 0, unavailable: 0 })
  })

  // Scenario: the authenticator cannot be asked, or shutdown has begun.
  it.each([
    [
      'an unavailable authenticator',
      () =>
        (transport['authenticate'] as jest.Mock).mockRejectedValue(
          new AuthenticationUnavailableError('timeout'),
        ),
    ],
    ['shutdown', () => (transport['shuttingDown'] = true)],
  ])('counts %s as unavailable', async (_name, arrange) => {
    arrange()
    await gateway.handleConnection(socket() as never)
    expect(refused()).toEqual({ limit: 0, unauthorized: 0, unavailable: 1 })
  })
})
