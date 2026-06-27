/**
 * @fileoverview Unit tests asserting DI tokens are unique Symbols.
 * @layer composition
 */
import {
  REALTIME_AUTHENTICATOR_TOKEN,
  REALTIME_HOOKS_TOKEN,
  REALTIME_INSTANCE_ID_TOKEN,
  REALTIME_OFFLINE_QUEUE_TOKEN,
  REALTIME_OPTIONS_TOKEN,
  REALTIME_PRESENCE_TOKEN,
  REALTIME_PUBSUB_TOKEN,
  REALTIME_TRANSPORT_TOKEN,
} from './injection-tokens.constants'

describe('injection tokens', () => {
  const tokens = [
    REALTIME_OPTIONS_TOKEN,
    REALTIME_TRANSPORT_TOKEN,
    REALTIME_AUTHENTICATOR_TOKEN,
    REALTIME_PUBSUB_TOKEN,
    REALTIME_OFFLINE_QUEUE_TOKEN,
    REALTIME_PRESENCE_TOKEN,
    REALTIME_HOOKS_TOKEN,
    REALTIME_INSTANCE_ID_TOKEN,
  ]

  // Every token is a Symbol (avoids string-token collisions).
  it('declares every token as a Symbol', () => {
    for (const token of tokens) expect(typeof token).toBe('symbol')
  })

  // All eight tokens are mutually unique.
  it('declares eight unique tokens', () => {
    expect(new Set(tokens).size).toBe(8)
  })
})
