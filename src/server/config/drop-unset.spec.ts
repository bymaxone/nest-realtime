/**
 * @fileoverview `dropUnset` removes the own keys that hold nothing, in the options and in each group.
 * @layer composition
 */
import { dropUnset } from './drop-unset'

describe('dropUnset', () => {
  // Scenario: undefined and null at the top level and in the three groups. Expected: those keys are
  // absent from the copy, and every other key keeps its value.
  it('removes undefined and null keys at the top level and in every group', () => {
    const result = dropUnset({
      maxConnections: undefined,
      hookTimeoutMs: null,
      authenticateTimeoutMs: 5,
      sse: { heartbeatMs: undefined, replayBufferSize: null, maxQueuedEvents: 0 },
      websocket: { maxConnectionsPerUser: undefined, namespace: '/x' },
      reauthenticationPolicy: { concurrency: null, intervalSeconds: 60 },
    })

    expect(result).toStrictEqual({
      authenticateTimeoutMs: 5,
      sse: { maxQueuedEvents: 0 },
      websocket: { namespace: '/x' },
      reauthenticationPolicy: { intervalSeconds: 60 },
    })
  })

  // Scenario: values that carry behaviour. Expected: they are kept by reference, not copied.
  it('keeps the authenticator and the hooks by reference', () => {
    const authenticator = { authenticate: async () => null }
    const hooks = { onConnect: () => undefined }
    const result = dropUnset({ authenticator, hooks })

    expect(result.authenticator).toBe(authenticator)
    expect(result.hooks).toBe(hooks)
  })

  // Scenario: a group that is not a plain object. Expected: it is left as it is, for the validator.
  it.each([['text'], [5], [[1]]])('leaves the group %p untouched', (group) => {
    expect(dropUnset({ sse: group }).sse).toBe(group)
  })

  it('does not change what it was given', () => {
    const given = { sse: { heartbeatMs: undefined } }

    dropUnset(given)

    expect(given).toStrictEqual({ sse: { heartbeatMs: undefined } })
  })
})
