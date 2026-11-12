/**
 * @fileoverview Pins every `as const` value table of the `./shared` subpath by exact value.
 * @layer shared
 */
import { REALTIME_ERROR_CODES } from './error-codes.constants'
import { PRESENCE_EVENT_NAMES, RESERVED_EVENT_NAMES } from './reserved-events.constants'
import { ADMISSION_ROOM_LIMITS } from './admission-rooms.constants'
import { ROOM_PREFIXES } from './room-prefixes.constants'

// Stryker does not mutate an object literal under `as const`, so no mutant guards these tables:
// a dropped entry, a renamed key or a changed value is caught only by an exact comparison here.
// Each value is part of the wire contract (a stored room id, an event name a client subscribes to,
// a code a caller matches on), so a change is a breaking one and has to be deliberate.
describe('the shared value tables', () => {
  // Scenario: any entry added, dropped, renamed or revalued. Expected: this comparison fails.
  // Why: the table is the contract, and no mutant covers it.
  it('REALTIME_ERROR_CODES holds exactly the catalogued codes', () => {
    expect(REALTIME_ERROR_CODES).toStrictEqual({
      INVALID_OPTIONS: 'REALTIME_INVALID_OPTIONS',
      NO_AUTHENTICATOR: 'REALTIME_NO_AUTHENTICATOR',
      AUTH_FAILED: 'REALTIME_AUTH_FAILED',
      REAUTHENTICATION_FAILED: 'REALTIME_REAUTHENTICATION_FAILED',
      TOO_MANY_CONNECTIONS: 'REALTIME_TOO_MANY_CONNECTIONS',
      INVALID_TICKET: 'REALTIME_INVALID_TICKET',
      PUBSUB_UNAVAILABLE: 'REALTIME_PUBSUB_UNAVAILABLE',
      TRANSPORT_UNAVAILABLE: 'REALTIME_TRANSPORT_UNAVAILABLE',
      REDIS_ADAPTER_FAILED: 'REALTIME_REDIS_ADAPTER_FAILED',
      PAYLOAD_TOO_LARGE: 'REALTIME_PAYLOAD_TOO_LARGE',
      REPLAY_BUFFER_MISS: 'REALTIME_REPLAY_BUFFER_MISS',
    })
  })

  it('ROOM_PREFIXES holds exactly the canonical room prefixes', () => {
    expect(ROOM_PREFIXES).toStrictEqual({
      USER: 'user',
      TENANT: 'tenant',
      RESOURCE: 'resource',
    })
  })

  it('ADMISSION_ROOM_LIMITS holds exactly the two admission bounds', () => {
    expect(ADMISSION_ROOM_LIMITS).toStrictEqual({ MAX_ROOMS: 32, MAX_ROOM_NAME_LENGTH: 256 })
  })

  it('RESERVED_EVENT_NAMES holds exactly the reserved event names', () => {
    expect(RESERVED_EVENT_NAMES).toStrictEqual({
      CONNECTION_ESTABLISHED: 'connection:established',
      CONNECTION_REAUTH_FAILED: 'connection:reauthentication-failed',
      CONNECTION_CREDENTIAL_EXPIRING: 'connection:credential-expiring',
      ROOM_JOINED: 'room:joined',
      ROOM_LEFT: 'room:left',
      ERROR: 'error',
    })
  })

  it('PRESENCE_EVENT_NAMES holds exactly the presence event names', () => {
    expect(PRESENCE_EVENT_NAMES).toStrictEqual({
      ONLINE: 'presence:online',
      OFFLINE: 'presence:offline',
    })
  })
})
