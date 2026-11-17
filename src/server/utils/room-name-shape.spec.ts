/**
 * @fileoverview The room name a call carries is a non-empty string, on every entry point that
 * hands it to a room API.
 * @layer application
 *
 * socket.io's `join`, `leave` and `to` accept an array of names, so a value that is not a
 * string skips a check written for strings and still reaches the rooms. Every entry that takes a
 * room name refuses the shape first, with the same typed error.
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { build as buildSse } from '../../../test/fixtures/sse/transport-harness'
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { SseTransport } from '@bymax-one/nest-realtime/internal'
import { WebSocketTransport } from '../../websocket/transports/websocket/websocket.transport'
import { CompositeTransport } from '../../websocket/transports/composite/composite.transport'
import type { ITransport } from '../interfaces/transport.interface'
import { RealtimeService } from '../services/realtime.service'

/** The refusal a call with a value that is not a room name raises: the call, the field and the kind of value. */
const refusal = (op: string, shape: string): string =>
  `[RealtimeService] REALTIME_AUTH_FAILED: ${op}: \`roomId\` must be a non-empty string, got ${shape}`

/** Values a host could forward from a request body or a query string. */
/** Each value, what it is called in the refusal. */
const NOT_A_ROOM_NAME: ReadonlyArray<readonly [string, unknown, string]> = [
  ['an array', ['user:victim'], 'an array'],
  ['a nested array', [['user:victim']], 'an array'],
  ['an array mixing a free and a reserved name', ['ok', 'user:victim'], 'an array'],
  ['a Set', new Set(['tenant:other']), 'object'],
  ['an object with a toString', { toString: () => 'user:victim' }, 'object'],
  ['a number', 7, 'number'],
  ['null', null, 'null'],
  ['undefined', undefined, 'undefined'],
  ['a String object', new String('user:victim'), 'object'],
  ['the empty string', '', 'string'],
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
    it.each(NOT_A_ROOM_NAME)('refuses %s', async (_label, value, shape) => {
      const transport = mockTransport()
      const service = new RealtimeService(transport, undefined as never)
      const call = (): Promise<void> =>
        op === 'emitToRoom'
          ? service.emitToRoom(value as never, 'e', {})
          : service[op]('c-1', value as never)

      const failure = await failureOf(call)

      expect(failure?.code).toBe(REALTIME_ERROR_CODES.AUTH_FAILED)
      expect(failure?.message).toBe(refusal(op, shape))
      expect(transport[op]).not.toHaveBeenCalled()
    })
  })

  describe.each(['joinRoom', 'leaveRoom', 'emitToRoom'] as const)('SseTransport.%s', (op) => {
    // Scenario: the transport is reached without the service. Expected: the same refusal.
    it.each(NOT_A_ROOM_NAME)('refuses %s', async (_label, value, shape) => {
      const { transport } = buildSse()
      const call = (): Promise<void> =>
        op === 'emitToRoom'
          ? transport.emitToRoom(value as never, 'e', {})
          : transport[op]('c-1', value as never)

      const failure = await failureOf(call)

      expect(failure?.code).toBe(REALTIME_ERROR_CODES.AUTH_FAILED)
      expect(failure?.message).toBe(refusal(op, shape))
    })
  })

  describe.each(['joinRoom', 'leaveRoom', 'emitToRoom'] as const)('CompositeTransport.%s', (op) => {
    // Scenario: the composite is reached without the service. Expected: the refusal comes before either
    // transport is asked, so neither is left half-applied.
    it.each(NOT_A_ROOM_NAME)(
      'refuses %s before asking either transport',
      async (_label, value, shape) => {
        const sse = mockTransport()
        const ws = mockTransport()
        const module = await Test.createTestingModule({
          providers: [
            CompositeTransport,
            { provide: SseTransport, useValue: sse },
            { provide: WebSocketTransport, useValue: ws },
          ],
        }).compile()
        const composite = module.get(CompositeTransport)
        const call = (): Promise<void> =>
          op === 'emitToRoom'
            ? composite.emitToRoom(value as never, 'e', {})
            : composite[op]('c-1', value as never)

        const failure = await failureOf(call)

        expect(failure?.message).toBe(refusal(op, shape))
        expect(sse[op]).not.toHaveBeenCalled()
        expect(ws[op]).not.toHaveBeenCalled()
      },
    )
  })
})
