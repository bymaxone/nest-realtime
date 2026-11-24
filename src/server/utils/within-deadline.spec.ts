/**
 * @fileoverview The wait under a deadline settles like the call, or on the deadline, and tells the caller when the call is done.
 * @layer utils
 */
import { absorbed, firstOf, started, unboxed, withinDeadline } from './within-deadline'

const never = (): Promise<never> => new Promise<never>(() => undefined)

/**
 * Runs `run` with a `then` that answers for every object planted on `target`, the way a polluting host would, and takes it
 * away before returning: the test runner reads `then` too, so nothing is awaited while it is there.
 */
function whilePlanted<T>(target: object, run: () => T): T {
  Object.defineProperty(target, 'then', {
    value: () => undefined,
    configurable: true,
    writable: true,
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(target, 'then')
  }
}

const ROOTS: readonly [string, object][] = [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype],
  ['Function.prototype', Function.prototype],
]
const REFUSED = { code: 'REALTIME_TRANSPORT_UNAVAILABLE' }

describe('withinDeadline', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('settles with what the call settled with, and with a plain value', async () => {
    const options = { timeoutError: () => new Error('late') }

    expect((await withinDeadline(Promise.resolve(7), 50, options)).v).toBe(7)
    expect((await withinDeadline('plain', 50, options)).v).toBe('plain')
  })

  it('rejects with what the call rejected with, and reports that it settled', async () => {
    const failure = new Error('no')
    const onSettled = jest.fn()
    const waiting = withinDeadline(Promise.reject(failure), 50, {
      timeoutError: () => new Error('late'),
      onSettled,
    })

    await expect(waiting).rejects.toBe(failure)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('rejects with the deadline error, then expires, before the call settles', async () => {
    const order: string[] = []
    const lateError = new Error('late')
    const waiting = withinDeadline(never(), 50, {
      timeoutError: () => {
        order.push('error')
        return lateError
      },
      onExpire: () => order.push('expire'),
    })
    const outcome = (async () => {
      try {
        return await waiting
      } catch (error) {
        order.push('rejected')
        return error
      }
    })()

    jest.advanceTimersByTime(49)
    expect(order).toEqual([])
    jest.advanceTimersByTime(1)

    expect(await outcome).toBe(lateError)
    expect(order).toEqual(['error', 'expire', 'rejected'])
  })

  it('reports the settling of a call that outlived its deadline, and ignores its answer', async () => {
    let settle: (value: string) => void = () => undefined
    const call = new Promise<string>((resolve) => {
      settle = resolve
    })
    const onSettled = jest.fn()
    const waiting = withinDeadline(call, 50, { timeoutError: () => new Error('late'), onSettled })
    const outcome = (async () => {
      try {
        return await waiting
      } catch (error) {
        return error
      }
    })()
    jest.advanceTimersByTime(50)
    await outcome
    expect(onSettled).not.toHaveBeenCalled()

    settle('too late')
    await Promise.resolve()
    await Promise.resolve()

    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not leave an unhandled rejection when a call rejects after its deadline', async () => {
    let fail: (error: Error) => void = () => undefined
    const call = new Promise<string>((_resolve, reject) => {
      fail = reject
    })
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const outcome = (async () => {
      try {
        return await withinDeadline(call, 50, { timeoutError: () => new Error('late') })
      } catch (error) {
        return error
      }
    })()
    jest.advanceTimersByTime(50)
    await outcome

    fail(new Error('after'))
    jest.useRealTimers()
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })

  // Scenario: the wait settles. Expected: the value sits in a box that inherits nothing, so a `then` planted on the root
  // prototypes after the wait cannot answer for it.
  it('settles with a box that has no prototype', async () => {
    const box = await withinDeadline({ userId: 'alice' }, 50, {
      timeoutError: () => new Error('late'),
    })

    expect(Object.getPrototypeOf(box)).toBeNull()
    expect(unboxed(box)).toStrictEqual({ userId: 'alice' })
  })

  // Scenario: a `then` is on a root prototype before the call. Expected: refused at entry, and the call's place is released.
  it.each(ROOTS)('refuses a then planted on %s before the call', async (_name, root) => {
    const onSettled = jest.fn()
    const waiting = whilePlanted(root, () =>
      withinDeadline(Promise.resolve(1), 50, { timeoutError: () => new Error('late'), onSettled }),
    )

    await expect(waiting).rejects.toMatchObject(REFUSED)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  // Scenario: unboxing after a `then` was planted. Expected: refused.
  it('refuses to unbox while a then is planted', async () => {
    const box = await withinDeadline(1, 50, { timeoutError: () => new Error('late') })

    const outcome = whilePlanted(Object.prototype, () => {
      try {
        return unboxed(box)
      } catch (error) {
        return error
      }
    })

    expect(outcome).toMatchObject(REFUSED)
  })

  // Scenario: arming the timer, which a host can replace, plants a `then` after the wait started, and the call settles
  // later with an answer or with a rejection. Expected: the call is refused before the caller awaits, the place is still
  // released when the call settles, and the wait nobody holds leaves nothing unhandled.
  it.each([
    ['answers', false],
    ['rejects', true],
  ])(
    'refuses when the timer plants a then, and still releases the call when it later %s',
    async (_name, rejects) => {
      let finish: () => void = () => undefined
      const call = new Promise<string>((resolve, reject) => {
        finish = () => (rejects ? reject(new Error('later')) : resolve('later'))
      })
      const onSettled = jest.fn()
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      const timers = jest.spyOn(global, 'setTimeout').mockImplementation(((...args: unknown[]) => {
        Object.defineProperty(Object.prototype, 'then', {
          value: () => undefined,
          configurable: true,
        })
        return { unref: () => undefined, args }
      }) as unknown as typeof setTimeout)
      let thrown: unknown
      try {
        withinDeadline(call, 50, { timeoutError: () => new Error('late'), onSettled })
      } catch (error) {
        thrown = error
      } finally {
        timers.mockRestore()
        Reflect.deleteProperty(Object.prototype, 'then')
      }
      expect(thrown).toMatchObject(REFUSED)
      expect(onSettled).not.toHaveBeenCalled()

      finish()
      jest.useRealTimers()
      await new Promise((resolve) => setImmediate(resolve))
      process.off('unhandledRejection', unhandled)

      expect(onSettled).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    },
  )

  // Scenario: a then is planted before the wait starts, so it refuses before the timer is armed. Expected: no timer is
  // armed, and nothing is told that a deadline passed.
  it('arms no timer for a wait that refused before it started', async () => {
    const onExpire = jest.fn()
    const waiting = whilePlanted(Object.prototype, () =>
      withinDeadline(1, 50, { timeoutError: () => new Error('late'), onExpire }),
    )
    await expect(waiting).rejects.toMatchObject(REFUSED)

    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(100)
    expect(onExpire).not.toHaveBeenCalled()
  })

  // Scenario: arming the timer throws. Expected: the wait rejects with that error, and the call's place is still released.
  it('rejects when the timer cannot be armed, and still releases the call', async () => {
    const onSettled = jest.fn()
    const timers = jest.spyOn(global, 'setTimeout').mockImplementation(() => {
      throw new Error('no timer')
    })
    try {
      await expect(
        withinDeadline(Promise.resolve(1), 50, {
          timeoutError: () => new Error('late'),
          onSettled,
        }),
      ).rejects.toThrow('no timer')
    } finally {
      timers.mockRestore()
    }
    await Promise.resolve()

    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  // Scenario: nobody reads the outcome (a revocation). Expected: a planted then does not stop the wait.
  it('does not refuse a wait whose outcome is unread', async () => {
    const waiting = whilePlanted(Object.prototype, () =>
      withinDeadline(1, 50, { timeoutError: () => new Error('late'), outcomeUnread: true }),
    )

    expect((await waiting).v).toBe(1)
  })

  // Scenario: a rejection that nobody awaits. Expected: absorbed, nothing unhandled.
  it('absorbs a rejection and an absent call', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    await absorbed(Promise.reject(new Error('no')))
    await absorbed(undefined)
    jest.useRealTimers()
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('does not keep the process alive for the deadline', async () => {
    const unref = jest.spyOn(global, 'setTimeout')

    await withinDeadline(Promise.resolve(1), 50, { timeoutError: () => new Error('late') })

    const timer = unref.mock.results[0]?.value as { hasRef(): boolean }
    expect(timer.hasRef()).toBe(false)
    unref.mockRestore()
  })
})

describe('firstOf', () => {
  it.each([
    ['the first', Promise.resolve('a'), never(), 'a'],
    ['the second', never(), Promise.resolve('b'), 'b'],
  ])('settles with %s to settle', async (_label, first, second, expected) => {
    expect((await firstOf(first, second)).v).toBe(expected)
  })

  it('rejects with the rejection that came first', async () => {
    const failure = new Error('no')

    await expect(firstOf(never(), Promise.reject(failure))).rejects.toBe(failure)
  })

  it('does not leave an unhandled rejection from the one that lost', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const winner = (await firstOf(Promise.resolve('a'), Promise.reject(new Error('lost')))).v
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)

    expect(winner).toBe('a')
    expect(unhandled).not.toHaveBeenCalled()
  })
  it.each(ROOTS)(
    'refuses a then planted on %s, and leaves no rejection unhandled',
    async (_name, root) => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      const waiting = whilePlanted(root, () =>
        firstOf(Promise.resolve('a'), Promise.reject(new Error('lost'))),
      )
      await expect(waiting).rejects.toMatchObject(REFUSED)
      await new Promise((resolve) => setImmediate(resolve))
      process.off('unhandledRejection', unhandled)

      expect(unhandled).not.toHaveBeenCalled()
    },
  )
})

describe('started', () => {
  // Scenario: the task throws before it returns a promise. Expected: the caller gets a rejected promise carrying the error,
  // with its own constructor, and nothing is left unhandled.
  it('hands back a rejected promise for a task that throws', async () => {
    const boom = new Error('boom')
    const call = started<void>(() => {
      throw boom
    }) as Promise<void>

    expect(Object.hasOwn(call, 'constructor')).toBe(true)
    await expect(call).rejects.toBe(boom)
  })

  // Scenario: the task returns a value that is not a promise. Expected: it comes back as it is.
  it('hands back what is not a promise as it is', () => {
    expect(started(() => 7)).toBe(7)
  })

  // Scenario: the task returns a promise that rejects, and the caller waits on another one first. Expected: the rejection
  // is read at once, so it is not unhandled, and the caller still sees it later.
  it('reads a rejection at once and keeps it for the caller', async () => {
    const boom = new Error('late')
    const call = started<void>(() => Promise.reject(boom)) as Promise<void>
    await new Promise((resolve) => setImmediate(resolve))

    await expect(call).rejects.toBe(boom)
  })
})
