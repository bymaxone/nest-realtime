/**
 * @fileoverview Unit tests for running a consumer's hook without letting its failure out.
 * @layer utils
 */
import { runHook } from './run-hook'

describe('runHook', () => {
  it('settles with nothing when the hook completes, and when there is no hook', async () => {
    await expect(runHook(async () => undefined)).resolves.toBeUndefined()
    await expect(runHook(() => undefined)).resolves.toBeUndefined()
  })

  it('settles with the failure of a hook that rejects', async () => {
    const error = new Error('down')

    await expect(runHook(() => Promise.reject(error))).resolves.toStrictEqual({ error })
  })

  it('settles with the failure of a hook that throws before it returns', async () => {
    const error = new Error('down')

    await expect(
      runHook(() => {
        throw error
      }),
    ).resolves.toStrictEqual({ error })
  })

  // Called before the first await, so a hook that takes no time still runs before the caller moves on.
  it('calls the hook synchronously', () => {
    const hook = jest.fn()

    void runHook(hook)

    expect(hook).toHaveBeenCalledTimes(1)
  })

  // Without a timeout nothing gives up on the hook, however long it takes.
  it('waits for a hook that takes very long when no timeout is given', async () => {
    jest.useFakeTimers()
    const result = runHook(() => new Promise<void>((resolve) => setTimeout(resolve, 600_000)))

    await jest.advanceTimersByTimeAsync(600_000)

    await expect(result).resolves.toBeUndefined()
    jest.useRealTimers()
  })

  describe('with a timeout', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('settles with nothing when the hook completes in time, and clears its timer', async () => {
      const result = runHook(() => new Promise<void>((resolve) => setTimeout(resolve, 100)), 500)
      await jest.advanceTimersByTimeAsync(100)

      await expect(result).resolves.toBeUndefined()
      expect(jest.getTimerCount()).toBe(0)
    })

    it('gives up on a hook that has not settled in time, and says so', async () => {
      const result = runHook(() => new Promise<void>(() => undefined), 500)
      await jest.advanceTimersByTimeAsync(499)
      let settled = false
      void result.then(() => (settled = true))
      await jest.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await jest.advanceTimersByTimeAsync(1)

      await expect(result).resolves.toStrictEqual({
        error: new Error('did not settle within 500 ms'),
      })
      expect(jest.getTimerCount()).toBe(0)
    })

    it('ignores what an abandoned hook rejects with later', async () => {
      let fail!: (error: Error) => void
      const result = runHook(() => new Promise<void>((_resolve, reject) => (fail = reject)), 100)
      await jest.advanceTimersByTimeAsync(100)
      await result

      fail(new Error('late'))
      await jest.advanceTimersByTimeAsync(0)

      expect(jest.getTimerCount()).toBe(0)
    })

    it('settles with the failure of a hook that rejects before the timeout', async () => {
      const error = new Error('down')

      await expect(runHook(() => Promise.reject(error), 500)).resolves.toStrictEqual({ error })
      expect(jest.getTimerCount()).toBe(0)
    })

    it('leaves the timer from keeping the process alive', async () => {
      const unref = jest.spyOn(global, 'setTimeout')
      const result = runHook(async () => undefined, 500)
      await result

      expect(unref).toHaveBeenCalled()
      unref.mockRestore()
    })
  })
})
