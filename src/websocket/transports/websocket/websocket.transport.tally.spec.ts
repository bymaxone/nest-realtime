/**
 * @fileoverview The WebSocket transport counts a delivery only when a server is attached to deliver it.
 * @layer transport
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  AuthenticationGate,
  ConnectionRegistry,
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  RealtimeMetricsTally,
  RoomRegistry,
} from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from './websocket.transport'

/** A server whose rooms accept an emit, as far as the transport reads it. */
function fakeServer(): Record<string, unknown> {
  const emit = jest.fn()
  return { to: jest.fn(() => ({ emit })), in: jest.fn(), emit, sockets: { sockets: new Map() } }
}

describe('WebSocketTransport counts its deliveries', () => {
  let transport: WebSocketTransport
  let tally: RealtimeMetricsTally

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    tally = new RealtimeMetricsTally()
    const module = await Test.createTestingModule({
      providers: [
        WebSocketTransport,
        ConnectionRegistry,
        RoomRegistry,
        AuthenticationGate,
        { provide: RealtimeMetricsTally, useValue: tally },
        { provide: REALTIME_AUTHENTICATOR_TOKEN, useValue: { authenticate: jest.fn() } },
        { provide: REALTIME_HOOKS_TOKEN, useValue: {} },
        { provide: REALTIME_OPTIONS_TOKEN, useValue: {} },
      ],
    }).compile()
    transport = module.get(WebSocketTransport)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const emitAll = async (): Promise<void> => {
    await transport.emitToUser('u1', 'e', 1)
    await transport.emitToTenant('t1', 'e', 1)
    await transport.emitToRoom('room-a', 'e', 1)
    await transport.broadcast('e', 1)
  }

  // Scenario: no server is attached yet, so an emit is dropped. Expected: nothing is counted as delivered.
  it('counts nothing while no server is attached', async () => {
    await emitAll()
    expect(tally.snapshot().emitted).toEqual({ sse: 0, websocket: 0 })
  })

  // Scenario: a server is attached. Expected: one delivery for each of the four ways in.
  it('counts one delivery for each emit once a server is attached', async () => {
    transport.setServer(fakeServer() as never)
    await emitAll()
    expect(tally.snapshot().emitted).toEqual({ sse: 0, websocket: 4 })
  })
})
