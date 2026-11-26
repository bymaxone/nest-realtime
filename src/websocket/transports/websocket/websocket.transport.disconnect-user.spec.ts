/**
 * @fileoverview Per-user disconnect on the WebSocket and composite transports.
 * @layer transport
 */
import 'reflect-metadata'
import { ConnectionRegistry } from '../../../server/services/connection-registry.service'
import { CompositeTransport } from '../composite/composite.transport'
import { WebSocketTransport } from './websocket.transport'

/** A transport over a real registry, with one registered socket for `u1` and one for `u2`. */
function build(attached = true) {
  const connections = new ConnectionRegistry()
  const mine = { disconnect: jest.fn() }
  const theirs = { disconnect: jest.fn() }
  for (const [connectionId, userId] of [
    ['s1', 'u1'],
    ['s2', 'u2'],
  ] as const) {
    connections.register({
      connectionId,
      userId,
      tenantId: undefined,
      transport: 'websocket',
      ip: '127.0.0.1',
      userAgent: undefined,
      connectedAt: new Date(),
      originalAuth: { userId, tenantId: undefined, roles: undefined, metadata: undefined },
    })
  }
  const chain = { disconnectSockets: jest.fn() }
  const server = {
    in: jest.fn().mockReturnValue(chain),
    sockets: {
      sockets: new Map([
        ['s1', mine],
        ['s2', theirs],
      ]),
    },
  }
  const transport = Object.create(WebSocketTransport.prototype) as WebSocketTransport
  Object.assign(transport, { connections, server: attached ? server : undefined })
  return { transport, server, chain, mine, theirs }
}

describe('WebSocketTransport.disconnectUser', () => {
  // Scenario: two users connected here. Expected: the socket of the one named is closed, and the
  // adapter is told to close the user's room, which reaches the sockets other nodes hold.
  it('closes the local sockets of the user and fans out to the user room', async () => {
    const { transport, server, chain, mine, theirs } = build()

    await transport.disconnectUser('u1')

    expect(mine.disconnect.mock.calls).toEqual([[true]])
    expect(theirs.disconnect).not.toHaveBeenCalled()
    expect(server.in.mock.calls).toEqual([['user:u1']])
    expect(chain.disconnectSockets.mock.calls).toEqual([[true]])
  })

  // Scenario: no socket of the user on this node. Expected: the fan-out still goes out.
  it('fans out for a user with no socket on this node', async () => {
    const { transport, server } = build()

    await transport.disconnectUser('u9')

    expect(server.in.mock.calls).toEqual([['user:u9']])
  })

  // Scenario: no server attached, or the fan-out throws. Expected: the call rejects with
  // REALTIME_TRANSPORT_UNAVAILABLE, without the user id in the message.
  it.each(['no server', 'a fan-out that throws'])('rejects with %s', async (kind) => {
    const { transport, chain } = build(kind !== 'no server')
    chain.disconnectSockets.mockImplementation(() => {
      throw new Error('down')
    })

    const failure = await transport.disconnectUser('u1').catch((error: unknown) => error)

    expect(failure).toHaveProperty('code', 'REALTIME_TRANSPORT_UNAVAILABLE')
    expect(String((failure as Error).message)).not.toContain('u1')
  })
})

describe('CompositeTransport.disconnectUser', () => {
  const composite = (sse: jest.Mock, ws: jest.Mock): CompositeTransport =>
    new CompositeTransport({ disconnectUser: sse } as never, { disconnectUser: ws } as never)

  // Scenario: both transports in play. Expected: both are asked, with the user and the reason.
  it('asks both transports', async () => {
    const sse = jest.fn().mockResolvedValue(undefined)
    const ws = jest.fn().mockResolvedValue(undefined)

    await composite(sse, ws).disconnectUser('u1', 'logout')

    expect(sse.mock.calls).toEqual([['u1', 'logout']])
    expect(ws.mock.calls).toEqual([['u1', 'logout']])
  })

  // Scenario: one transport fails. Expected: the other is still asked and the call rejects.
  it('rejects when either transport could not', async () => {
    const sse = jest.fn().mockRejectedValue(new Error('bus down'))
    const ws = jest.fn().mockResolvedValue(undefined)

    await expect(composite(sse, ws).disconnectUser('u1')).rejects.toThrow('bus down')
    expect(ws).toHaveBeenCalledTimes(1)
  })

  // Scenario: both fail. Expected: one refusal that names the operation and not the user.
  it('reports both failures without the user id', async () => {
    const fail = (): jest.Mock => jest.fn().mockRejectedValue(new Error('down'))

    const failure = await composite(fail(), fail())
      .disconnectUser('secret-user')
      .catch((error: unknown) => error)

    expect(failure).toHaveProperty('message', expect.stringContaining('disconnectUser'))
    expect(String((failure as Error).message)).not.toContain('secret-user')
  })
})
