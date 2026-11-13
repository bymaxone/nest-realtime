/**
 * @fileoverview Unit tests for the semaphore that caps revalidations in flight.
 * @layer utils
 */
import { Semaphore } from './semaphore'

/** A task that holds its slot until `release` is called. */
function held(): { task: () => Promise<string>; release: () => void; started: () => boolean } {
  let release!: () => void
  let started = false
  const gate = new Promise<void>((resolve) => (release = resolve))
  return {
    task: async () => {
      started = true
      await gate
      return 'done'
    },
    release,
    started: () => started,
  }
}

describe('Semaphore', () => {
  it('runs a task and returns what it returns', async () => {
    await expect(new Semaphore(1).run(async () => 7)).resolves.toBe(7)
  })

  it('starts at most `size` tasks at once and starts the next as a slot frees', async () => {
    const semaphore = new Semaphore(2)
    const tasks = [held(), held(), held(), held()]
    const running = tasks.map((t) => semaphore.run(t.task))
    await Promise.resolve()

    expect(tasks.map((t) => t.started())).toStrictEqual([true, true, false, false])

    tasks[0]?.release()
    await running[0]
    await Promise.resolve()
    expect(tasks.map((t) => t.started())).toStrictEqual([true, true, true, false])

    tasks[1]?.release()
    await running[1]
    await Promise.resolve()
    expect(tasks.map((t) => t.started())).toStrictEqual([true, true, true, true])
    tasks[2]?.release()
    tasks[3]?.release()
    await Promise.all(running)
  })

  it('hands the slot on when a task rejects, and rejects with the same error', async () => {
    const semaphore = new Semaphore(1)
    const failure = new Error('down')

    const failed = semaphore.run(() => Promise.reject(failure))
    const after = semaphore.run(async () => 'next')

    await expect(failed).rejects.toBe(failure)
    await expect(after).resolves.toBe('next')
  })

  it('serves waiting tasks in the order they asked', async () => {
    const semaphore = new Semaphore(1)
    const order: number[] = []
    const first = held()
    const running = [
      semaphore.run(first.task),
      semaphore.run(async () => void order.push(2)),
      semaphore.run(async () => void order.push(3)),
    ]

    first.release()
    await Promise.all(running)

    expect(order).toStrictEqual([2, 3])
  })

  it('lets a later task start immediately once all earlier ones are done', async () => {
    const semaphore = new Semaphore(1)
    await semaphore.run(async () => undefined)
    const next = held()

    const running = semaphore.run(next.task)
    await Promise.resolve()

    expect(next.started()).toBe(true)
    next.release()
    await running
  })
})
