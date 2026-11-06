/**
 * @fileoverview RedisRealtimePubSub — how a refusal of the SUBSCRIBE is logged, with the events of
 * the subscriber connection fired by hand so that no network order is involved.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { RedisRealtimePubSub } from './redis-realtime-pubsub'

// A server that refuses the SUBSCRIBE can be asked twice around one boot: the SUBSCRIBE queued while
// Redis was unreachable and the one the ready handler sends. The refusal is one fact, so it is
// logged once until the instance next becomes subscribed, and again if the reason changes. The
// events are fired by hand, so no network order is involved.
describe('a refusal of the SUBSCRIBE', () => {
  const refusal = (message: string) => Object.assign(new Error(message), { name: 'ReplyError' })
  const refusedLines = (warn: jest.SpyInstance): string[] =>
    warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('refused'))
  const flush = () => new Promise((resolve) => setImmediate(resolve))

  function boot(answers: Array<Error | 'accept'>) {
    const handlers: Record<string, (value?: unknown) => void> = {}
    const sub = {
      subscribe: jest.fn(),
      on: jest.fn((event: string, handler: (value?: unknown) => void) => {
        handlers[event] = handler
      }),
    }
    // The first answer belongs to the SUBSCRIBE queued at boot, which stays pending until it is
    // answered; the others are answered at once.
    let release!: () => void
    const queued = new Promise<void>((resolve) => (release = resolve))
    const first = answers[0]
    sub.subscribe.mockReturnValueOnce(
      queued.then(() => (first === 'accept' ? undefined : Promise.reject(first))),
    )
    for (const answer of answers.slice(1)) {
      sub.subscribe.mockImplementationOnce(() =>
        answer === 'accept' ? Promise.resolve() : Promise.reject(answer),
      )
    }
    sub.subscribe.mockResolvedValue(undefined)
    const pub = { duplicate: jest.fn().mockReturnValue(sub), status: 'ready' }
    const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
    const booted = pubsub.subscribe(jest.fn())
    handlers['error']!(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    return { handlers, sub, pubsub, booted, answerQueued: release }
  }

  it('is logged once when the queued SUBSCRIBE and the ready handler are both refused', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { handlers, pubsub, booted, answerQueued } = boot([
        refusal('NOPERM revoked'),
        refusal('NOPERM revoked'),
      ])
      await booted
      handlers['ready']!()
      answerQueued()
      await flush()

      expect(refusedLines(warn)).toHaveLength(1)
      expect(pubsub.isSubscribed()).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('is logged again when the reason changes', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { handlers, booted, answerQueued } = boot([
        refusal('NOPERM revoked'),
        refusal('WRONGPASS rotated'),
      ])
      await booted
      handlers['ready']!()
      answerQueued()
      await flush()

      // Either answer can arrive first; each reason is logged once.
      const lines = refusedLines(warn)
      expect(lines).toHaveLength(2)
      expect(lines.filter((line) => line.includes('NOPERM revoked'))).toHaveLength(1)
      expect(lines.filter((line) => line.includes('WRONGPASS rotated'))).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('is logged again after the instance subscribed in between', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      const { handlers, pubsub, booted, answerQueued } = boot([
        refusal('NOPERM revoked'),
        'accept',
        refusal('NOPERM revoked'),
      ])
      await booted
      answerQueued()
      await flush()
      expect(refusedLines(warn)).toHaveLength(1)

      handlers['ready']!()
      await flush()
      expect(pubsub.isSubscribed()).toBe(true)

      handlers['ready']!()
      await flush()

      expect(refusedLines(warn)).toHaveLength(2)
      expect(pubsub.isSubscribed()).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('is logged again by a new subscriber after the last handler unsubscribed', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const handlers: Array<Record<string, (value?: unknown) => void>> = []
      const mkSub = () => {
        const own: Record<string, (value?: unknown) => void> = {}
        handlers.push(own)
        return {
          subscribe: jest.fn().mockResolvedValue(undefined),
          on: jest.fn((event: string, handler: (value?: unknown) => void) => {
            own[event] = handler
          }),
          disconnect: jest.fn(),
        }
      }
      const first = mkSub()
      const second = mkSub()
      const pub = {
        duplicate: jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
        status: 'ready',
      }
      const pubsub = new RedisRealtimePubSub({ client: pub as unknown as Redis })
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

      const unsubscribe = await pubsub.subscribe(jest.fn())
      first.subscribe.mockRejectedValue(refusal('NOPERM revoked'))
      handlers[0]!['ready']!()
      await flush()
      expect(refusedLines(warn)).toHaveLength(1)
      await unsubscribe()

      // The new subscriber finds Redis unreachable, so nothing has marked it up since the refusal.
      second.subscribe.mockReturnValueOnce(new Promise(() => undefined))
      const resubscribing = pubsub.subscribe(jest.fn())
      handlers[1]!['error']!(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      )
      await resubscribing
      second.subscribe.mockRejectedValue(refusal('NOPERM revoked'))
      handlers[1]!['ready']!()
      await flush()

      expect(refusedLines(warn)).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })

  // The sequence a connection can take around the boot: it becomes ready and sends the queued
  // SUBSCRIBE, closes before the reply, the boot then completes as unreachable, and the next
  // connection becomes ready. That ready has to subscribe.
  it('does not leave the instance unsubscribed when the first connection closed before answering', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { handlers, sub, pubsub, booted } = boot(['accept'])

    handlers['ready']!()
    handlers['close']!()
    await booted
    handlers['ready']!()
    await flush()

    expect(sub.subscribe).toHaveBeenCalledTimes(2)
    expect(pubsub.isSubscribed()).toBe(true)
  })
})
