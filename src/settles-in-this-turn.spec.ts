/**
 * @fileoverview Tests for settlesInThisTurn, the test helper that says whether a call settled
 * before the event loop took its next turn.
 * @layer test
 */
import { settlesInThisTurn } from '../test/support/settles-in-this-turn'

describe('settlesInThisTurn', () => {
  // Scenario: a promise that is already settled, either way. Expected: its outcome. Why: a refusal
  // and an answer from memory are the calls the helper exists to recognise.
  it('reports what a promise that settles at once came to', async () => {
    expect(await settlesInThisTurn(async () => 7)).toEqual({ status: 'fulfilled', value: 7 })
    const reason = new Error('refused')
    expect(await settlesInThisTurn(() => Promise.reject(reason))).toEqual({
      status: 'rejected',
      reason,
    })
  })

  // Scenario: a promise that settles after a long chain of microtasks. Expected: still its outcome.
  // Why: microtasks all run before the next macrotask, so the number of hops is not what counts.
  it('counts any number of microtask hops as the same turn', async () => {
    const hops = async (): Promise<string> => {
      for (let hop = 0; hop < 50; hop++) await Promise.resolve()
      return 'done'
    }

    expect(await settlesInThisTurn(hops)).toEqual({ status: 'fulfilled', value: 'done' })
  })

  // Scenario: a promise that waits for a macrotask, which is what a reconnect or a reply is.
  // Expected: pending, and the promise still completes afterwards. Why: a call that queues behind
  // something outside the process must not be mistaken for one that was refused at once.
  it('reports a promise that waits for the next turn as pending, and leaves it to finish', async () => {
    const waiting = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 0))

    expect(await settlesInThisTurn(() => waiting)).toEqual({ status: 'pending' })
    expect(await waiting).toBe('late')
  })

  // Scenario: a call that defers its answer to a setImmediate callback, queued while the call runs.
  // Expected: pending. Why: that is a macrotask, so the call did not answer at once, and the end of
  // the turn was armed before the call started, so the callback cannot run ahead of it.
  it('reports a call that answers from a setImmediate as pending', async () => {
    const outcome = await settlesInThisTurn(
      () => new Promise<string>((resolve) => setImmediate(() => resolve('late'))),
    )

    expect(outcome).toEqual({ status: 'pending' })
  })

  // Scenario: a promise that never settles. Expected: pending, not a hang. Why: a broken call
  // must fail its case at once instead of waiting for the test runner's timeout.
  it('reports a promise that never settles as pending', async () => {
    expect(await settlesInThisTurn(() => new Promise<void>(() => undefined))).toEqual({
      status: 'pending',
    })
  })
})
