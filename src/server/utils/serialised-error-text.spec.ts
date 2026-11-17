/**
 * @fileoverview No error the library raises carries text a third party wrote once it is serialised.
 * @layer utils
 *
 * A driver's, a broker's or another publisher's message can name a host, a port, a credential or
 * a payload. The errors here keep that text for whoever logs them, on `message` and `cause`, and
 * a host's filter, logger or ack that stringifies the instance must not send it on. Every error
 * code is in the table, or exempt with the reason it cannot carry such text, so a new code has to
 * be decided here.
 */
import { HttpException } from '@nestjs/common'
import {
  REALTIME_ERROR_CODES,
  type RealtimeErrorCode,
} from '../../shared/constants/error-codes.constants'
import { realtimeError } from './realtime-error'
import { unavailableError } from './unavailable-error'

/** A message of the kind a driver or a broker writes: a private address, a credential, a payload. */
const POISON = 'connect ECONNREFUSED 10.0.0.5:6379 password=s3cr3t-token {"email":"a@b.c"}'
const FRAGMENTS = ['10.0.0.5', 's3cr3t-token', 'a@b.c', 'ECONNREFUSED']

/** An object that is not an Error, as a rejection can be: its own fields are enumerable. */
const POISONED_OBJECT = { reason: POISON, host: '10.0.0.5' }

const CAUSES: readonly [string, unknown][] = [
  ['an Error', new Error(POISON)],
  ['a plain object', POISONED_OBJECT],
  ['a string', POISON],
]

const MAKERS: Partial<Record<RealtimeErrorCode, (cause: unknown) => Error>> = {
  [REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE]: (cause) =>
    unavailableError(
      REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE,
      'SseTransport',
      'a revocation',
      cause,
    ),
  [REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE]: (cause) =>
    unavailableError(
      REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE,
      'SseTransport',
      'an emit with no delivery path',
      cause,
    ),
  [REALTIME_ERROR_CODES.REDIS_ADAPTER_FAILED]: (cause) =>
    realtimeError(REALTIME_ERROR_CODES.REDIS_ADAPTER_FAILED, `could not be installed (${POISON})`, {
      who: 'RealtimeIoAdapter',
      cause,
    }),
}

/** Why a code is not in the table: it is raised with fixed text only, or never raised. */
const EXEMPT: Partial<Record<RealtimeErrorCode, string>> = {
  [REALTIME_ERROR_CODES.INVALID_OPTIONS]:
    "the host's own configuration, echoed back at start-up; it is never a response",
  [REALTIME_ERROR_CODES.NO_AUTHENTICATOR]: 'a fixed message raised at start-up',
  [REALTIME_ERROR_CODES.AUTH_FAILED]:
    "a fixed message about the authenticator's result, or the bare code as a 401 or `data.code`",
  [REALTIME_ERROR_CODES.REAUTHENTICATION_FAILED]: 'only the bare code, as a close reason',
  [REALTIME_ERROR_CODES.TOO_MANY_CONNECTIONS]: 'only the bare code, as a close reason',
  [REALTIME_ERROR_CODES.SLOW_CONSUMER]: 'only the bare code, as a close reason',
  [REALTIME_ERROR_CODES.INVALID_TICKET]: 'no call site raises it',
  [REALTIME_ERROR_CODES.PAYLOAD_TOO_LARGE]: 'no call site raises it',
  [REALTIME_ERROR_CODES.REPLAY_BUFFER_MISS]: 'no call site raises it',
}

describe('the text of a third party in a serialised error', () => {
  // Scenario: a code is added. Expected: it is in the table or exempt, and never both. Why: a code
  // that nobody decided on is the one that carries a driver's text to a client.
  it('decides every error code, exactly once', () => {
    for (const code of Object.values(REALTIME_ERROR_CODES)) {
      expect([code in MAKERS, code in EXEMPT].filter(Boolean)).toHaveLength(1)
    }
  })

  // Scenario: an error built from a poisoned cause is stringified, as a filter, a logger or a
  // socket ack does. Expected: no fragment of the cause is in the output, while `message` and
  // `cause` still hold it for whoever logs the instance. Why: the 503 body is generic, but the
  // instance is not, and `JSON.stringify` reads its own enumerable fields.
  describe.each(Object.entries(MAKERS))('%s', (_code, make) => {
    it.each(CAUSES)(
      'keeps %s off the stringified instance and what it answers with',
      (_l, cause) => {
        const error = (make as (cause: unknown) => Error)(cause)
        const serialised = [
          JSON.stringify(error),
          ...(error instanceof HttpException ? [JSON.stringify(error.getResponse())] : []),
        ].join('\n')

        for (const fragment of FRAGMENTS) expect(serialised).not.toContain(fragment)
        expect(error.cause).toBe(cause)
        expect(error.message).toContain(_code)
      },
    )
  })

  // Scenario: a host's code reassigns or redefines `message` and `cause` on the instance.
  // Expected: both are writable and configurable and not enumerable. Why: hiding them from
  // `JSON.stringify` must not change what a logger or a wrapper can do with them.
  it.each(['message', 'cause'] as const)(
    'keeps %s writable and configurable, not enumerable',
    (field) => {
      const error = MAKERS[REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE]?.(POISON) as Error
      expect(Object.getOwnPropertyDescriptor(error, field)).toMatchObject({
        enumerable: false,
        writable: true,
        configurable: true,
      })
      expect(() => {
        error[field] = 'replaced'
        Object.defineProperty(error, field, { value: 'redefined' })
      }).not.toThrow()
      expect(error[field]).toBe('redefined')
    },
  )

  // Scenario: the code is still what a caller branches on. Expected: it survives serialisation.
  it('keeps the stable code on the stringified instance', () => {
    const error = MAKERS[REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE]?.(POISON)
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: 'REALTIME_PUBSUB_UNAVAILABLE' })
  })

  it.each(Object.entries(EXEMPT))('exempts %s with a reason: %s', (_code, reason) => {
    expect(reason.length).toBeGreaterThan(10)
  })
})
