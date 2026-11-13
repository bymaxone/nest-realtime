/**
 * @fileoverview A counting semaphore: a cap on how many tasks run at once, shared by every caller.
 * @layer utils
 */

/**
 * Runs tasks with at most `size` of them in flight, whoever started them. A task that waits for a
 * slot holds nothing but its place in the queue.
 */
export class Semaphore {
  private free: number
  private readonly waiting: Array<() => void> = []

  constructor(size: number) {
    this.free = size
  }

  /** Run `task` once a slot is free, and hand the slot on when it settles. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1
    else await new Promise<void>((resolve) => this.waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.free += 1
    }
  }
}
