/**
 * @fileoverview How often a host's thenable is asked for its `then`, and a stubborn native promise for its `constructor`.
 * @layer utils
 */
import { absorbed, firstOf, started, unboxed, withinDeadline } from './within-deadline'

/** A thenable that is not a native promise and counts each read of `then`. */
function countingThenable(value: unknown): { thenable: PromiseLike<unknown>; reads: () => number } {
  let reads = 0
  const thenable = {
    get then() {
      reads += 1
      return (resolve: (v: unknown) => void) => resolve(value)
    },
  }
  return { thenable: thenable as unknown as PromiseLike<unknown>, reads: () => reads }
}

/** A native promise whose own `constructor` is a counting getter that cannot be replaced. */
function stubborn(): { promise: Promise<unknown>; reads: () => number } {
  let reads = 0
  const promise = Promise.resolve('v')
  Object.defineProperty(promise, 'constructor', {
    configurable: false,
    get() {
      reads += 1
      return Promise
    },
  })
  return { promise, reads: () => reads }
}

const options = { timeoutError: () => new Error('late') }

describe('what a call is asked for, and how often', () => {
  // Scenario: a thenable that is not a native promise goes through each entry point. Expected: its `then` is read once.
  it.each([
    ['started', (t: PromiseLike<unknown>) => Promise.resolve(started(() => t))],
    ['absorbed', (t: PromiseLike<unknown>) => absorbed(t)],
    [
      'withinDeadline',
      async (t: PromiseLike<unknown>) => unboxed(await withinDeadline(t, 1000, options)),
    ],
    [
      'firstOf',
      async (t: PromiseLike<unknown>) => unboxed(await firstOf(t, new Promise(() => undefined))),
    ],
  ])('%s reads then of a thenable once', async (_name, run) => {
    const { thenable, reads } = countingThenable('ok')

    await run(thenable)

    expect(reads()).toBe(1)
  })

  // Scenario: a native promise with an unreplaceable counting constructor goes through each entry point that awaits it.
  // Expected: it is refused or read once, never read by two awaits.
  it.each([
    ['started', (p: Promise<unknown>) => Promise.resolve(started(() => p))],
    [
      'withinDeadline',
      async (p: Promise<unknown>) => unboxed(await withinDeadline(p, 1000, options)),
    ],
  ])(
    '%s reads the constructor of a stubborn promise at most once per await',
    async (_name, run) => {
      const { promise, reads } = stubborn()

      await run(promise).catch(() => undefined)

      expect(reads()).toBeLessThanOrEqual(1)
    },
  )
})
