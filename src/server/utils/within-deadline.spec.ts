/**
 * @fileoverview The wait under a deadline settles like the call, or on the deadline, and tells the caller when the call is done.
 * @layer utils
 */
import { firstOf, withinDeadline } from './within-deadline'

const never = (): Promise<never> => new Promise<never>(() => undefined)

describe('withinDeadline', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('settles with what the call settled with, and with a plain value', async () => {
    const options = { timeoutError: () => new Error('late') }

    expect(await withinDeadline(Promise.resolve(7), 50, options)).toBe(7)
    expect(await withinDeadline('plain', 50, options)).toBe('plain')
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
    expect(await firstOf(first, second)).toBe(expected)
  })

  it('rejects with the rejection that came first', async () => {
    const failure = new Error('no')

    await expect(firstOf(never(), Promise.reject(failure))).rejects.toBe(failure)
  })

  it('does not leave an unhandled rejection from the one that lost', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const winner = await firstOf(Promise.resolve('a'), Promise.reject(new Error('lost')))
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)

    expect(winner).toBe('a')
    expect(unhandled).not.toHaveBeenCalled()
  })
})
