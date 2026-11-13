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
})
