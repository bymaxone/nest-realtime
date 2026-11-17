/**
 * @fileoverview `joinRoom` and `leaveRoom` refuse the room names the library composes itself.
 * @layer application
 *
 * `user:`, `tenant:` and `connection:` are composed from the identity the library resolved, or
 * reserved for revocation. Admission refuses them in `AuthenticationResult.rooms`; a call that
 * puts a connection in one by hand is the same hole, so it is refused by the same rule.
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeService } from './realtime.service'

function mockTransport(): jest.Mocked<ITransport> {
  return {
    kind: 'sse',
    emitToUser: jest.fn().mockResolvedValue(undefined),
    emitToTenant: jest.fn().mockResolvedValue(undefined),
    emitToRoom: jest.fn().mockResolvedValue(undefined),
    broadcast: jest.fn().mockResolvedValue(undefined),
    joinRoom: jest.fn().mockResolvedValue(undefined),
    leaveRoom: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ITransport>
}

const RESERVED = [
  'user:victim',
  'tenant:other',
  'connection:c-1',
  'user:',
  'tenant:',
  'connection:',
]
const FREE = [
  'resource:invoice:1',
  'workspace:w1',
  'user',
  'users:1',
  'User:1',
  'x-user:1',
  ' user:1',
]

describe('RealtimeService — reserved room names', () => {
  describe.each(['joinRoom', 'leaveRoom'] as const)('%s', (operation) => {
    // Scenario: a host passes a reserved name. Expected: the call rejects with the stable code, the
    // transport is never asked, and the message names the field and the prefix but not the id.
    it.each(RESERVED)('rejects %s without calling the transport or echoing it', async (room) => {
      const transport = mockTransport()
      const service = new RealtimeService(transport, undefined as never)

      const failure = await service[operation]('c-1', room).then(
        () => undefined,
        (error: unknown) => error as Error & { code?: string },
      )

      expect(failure?.code).toBe(REALTIME_ERROR_CODES.AUTH_FAILED)
      expect(failure?.message).toContain(`${operation}`)
      expect(failure?.message).toContain('`roomId`')
      expect(failure?.message).toMatch(/reserved prefix "(user|tenant|connection):"/)
      expect(failure?.message.split('reserved prefix')[0]).not.toContain(room)
      expect(transport[operation]).not.toHaveBeenCalled()
    })

    // Scenario: any other name. Expected: it is passed through unchanged. Why: only the three
    // prefixes are the library's; an application's rooms stay free-form.
    it.each(FREE)('passes %s through to the transport', async (room) => {
      const transport = mockTransport()
      const service = new RealtimeService(transport, undefined as never)

      await service[operation]('c-1', room)

      expect(transport[operation]).toHaveBeenCalledWith('c-1', room)
    })

    // Scenario: the value is not a string at runtime. Expected: it is not mistaken for a reserved
    // name and reaches the transport as before; the declared type is a promise, not a fact.
    it.each([undefined, 7, null])('does not treat %s as a reserved name', async (room) => {
      const transport = mockTransport()
      const service = new RealtimeService(transport, undefined as never)

      await service[operation]('c-1', room as never)

      expect(transport[operation]).toHaveBeenCalledTimes(1)
    })
  })
})
