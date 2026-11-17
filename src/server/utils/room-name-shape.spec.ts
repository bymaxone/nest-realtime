/**
 * @fileoverview The room name a call carries is a non-empty string, on every entry point that
 * hands it to a room API.
 * @layer application
 *
 * socket.io's `join`, `leave` and `to` accept arrays and sets of names, so a value that is not a
 * string skips a check written for strings and still reaches the rooms. Every entry that takes a
 * room name refuses the shape first, with the same typed error.
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { build as buildSse } from '../../../test/fixtures/sse/transport-harness'
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeService } from '../services/realtime.service'

/** Values a host could forward from a request body or a query string. */
const NOT_A_ROOM_NAME: ReadonlyArray<readonly [string, unknown]> = [
  ['an array', ['user:victim']],
  ['a nested array', [['user:victim']]],
  ['an array mixing a free and a reserved name', ['ok', 'user:victim']],
  ['a Set', new Set(['tenant:other'])],
  ['an object with a toString', { toString: () => 'user:victim' }],
  ['a number', 7],
  ['null', null],
  ['undefined', undefined],
  ['a String object', new String('user:victim')],
  ['the empty string', ''],
]

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

async function failureOf(
  call: () => Promise<unknown>,
): Promise<(Error & { code?: string }) | undefined> {
  return call().then(
    () => undefined,
    (error: unknown) => error as Error & { code?: string },
  )
}

describe('room name shape', () => {
  describe.each(['joinRoom', 'leaveRoom', 'emitToRoom'] as const)('RealtimeService.%s', (op) => {
    // Scenario: a host forwards a value that is not a string. Expected: a typed refusal before
    // any transport is asked, and the message never carries the value.
    it.each(NOT_A_ROOM_NAME)('refuses %s', async (_label, value) => {
      const transport = mockTransport()
      const service = new RealtimeService(transport, undefined as never)
      const call = (): Promise<void> =>
        op === 'emitToRoom'
          ? service.emitToRoom(value as never, 'e', {})
          : service[op]('c-1', value as never)

      const failure = await failureOf(call)

      expect(failure?.code).toBe(REALTIME_ERROR_CODES.AUTH_FAILED)
      expect(failure?.message).toContain(`${op}: \`roomId\` must be a non-empty string`)
      expect(failure?.message).not.toContain('victim')
      expect(transport[op]).not.toHaveBeenCalled()
    })
  })

  describe.each(['joinRoom', 'leaveRoom', 'emitToRoom'] as const)('SseTransport.%s', (op) => {
    // Scenario: the transport is reached without the service. Expected: the same refusal.
    it.each(NOT_A_ROOM_NAME)('refuses %s', async (_label, value) => {
      const { transport } = buildSse()
      const call = (): Promise<void> =>
        op === 'emitToRoom'
          ? transport.emitToRoom(value as never, 'e', {})
          : transport[op]('c-1', value as never)

      const failure = await failureOf(call)

      expect(failure?.code).toBe(REALTIME_ERROR_CODES.AUTH_FAILED)
    })
  })
})
