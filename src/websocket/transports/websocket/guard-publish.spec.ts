/**
 * @fileoverview The view of the caller's client the Redis adapter publishes through, and how the
 * adapter reports the publishes it rejects.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN, RealtimeMetricsTally } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { guardPublish } from './guard-publish'
import { RealtimeIoAdapter } from './realtime-io-adapter'

// The Redis adapter's constructor is replaced, so what it is given can be called directly.
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn().mockReturnValue({}) }), {
  virtual: true,
})

/** A client whose methods need their own instance, as ioredis's do. */
class Client {
  readonly sent: unknown[][] = []
  readonly status = 'ready'
  result: Promise<number> = Promise.resolve(1)
  publish(...args: unknown[]): Promise<number> {
    this.sent.push(args)
    return this.result
  }
  self(): this {
    return this
  }
}

/** Lets the handlers of the promises settled so far run. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('guardPublish', () => {
  // Scenario: a publish that succeeds. Expected: the client's own promise and arguments, no report.
  it('publishes on the client and returns its promise', async () => {
    const client = new Client()
    const onFailure = jest.fn()
    const view = guardPublish(client, onFailure)

    expect(view.publish('channel', 'message')).toBe(client.result)
    await turn()

    expect(client.sent).toEqual([['channel', 'message']])
    expect(onFailure).not.toHaveBeenCalled()
  })

  // Scenario: a publish that is rejected. Expected: reported, and still rejected for who awaits it.
  it('reports a rejected publish and keeps the rejection on the returned promise', async () => {
    const client = new Client()
    const failure = new Error('down')
    client.result = Promise.reject(failure)
    const onFailure = jest.fn()

    await expect(guardPublish(client, onFailure).publish('channel', 'message')).rejects.toBe(
      failure,
    )

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(failure)
  })

  // Scenario: the adapter reads other members. Expected: the client's own, with methods run on it.
  it('hands over every other member as the client holds it', () => {
    const client = new Client()
    const view = guardPublish(client, jest.fn())

    expect(view.status).toBe('ready')
    expect(view.self()).toBe(client)
    expect(view.constructor).toBe(Client)
    expect(view.constructor.name).toBe('Client')
    expect(client.publish).toBe(Client.prototype.publish)
  })
})

describe('RealtimeIoAdapter rejected publishes', () => {
  /** The publisher the adapter hands `createAdapter` for `client`, built with or without a tally. */
  function publisherFor(client: object, tally?: RealtimeMetricsTally): Client {
    const options = {
      websocket: { redisAdapter: { pubClient: client } },
    } as unknown as BymaxRealtimeModuleOptions
    const provided = new Map<unknown, unknown>([
      [REALTIME_OPTIONS_TOKEN, options],
      [RealtimeMetricsTally, tally],
    ])
    const app = { get: (token: unknown) => provided.get(token) }
    new RealtimeIoAdapter(app as never).createIOServer(0)
    const { createAdapter } = jest.requireMock('@socket.io/redis-adapter') as {
      createAdapter: jest.Mock
    }
    return createAdapter.mock.calls.at(-1)?.[0] as Client
  }

  /** A caller's client whose publishes reject with `failure`. */
  function failing(failure: unknown): object {
    const client = new Client()
    return Object.assign(client, {
      publish: () => Promise.reject(failure),
      duplicate: () => ({ quit: jest.fn(), disconnect: jest.fn() }),
    })
  }

  let warn: jest.SpyInstance
  let now: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockImplementation(() => ({
      adapter: jest.fn(),
      of: jest.fn().mockReturnValue({ on: jest.fn() }),
      on: jest.fn(),
    }))
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    now = jest.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Scenario: a burst of rejections, then one after the window. Expected: all counted; one line at
  // once and one for the rest, naming the class of the error and never its message.
  it('counts every rejection and writes one line for each window', async () => {
    const tally = new RealtimeMetricsTally()
    const publisher = publisherFor(failing(new TypeError('secret-host')), tally)
    const publish = async (): Promise<void> => {
      await publisher.publish().catch(() => undefined)
      await turn()
    }

    await publish()
    await publish()
    await publish()
    expect(warn).toHaveBeenCalledTimes(1)
    now.mockReturnValue(10_000)
    await publish()

    expect(tally.snapshot().adapterPublishFailures).toBe(4)
    expect(warn.mock.calls.map(([line]) => line)).toEqual(
      [1, 3].map((count) => ({
        event: 'REALTIME_ADAPTER_PUBLISH_FAILED',
        message:
          `Redis adapter publishes failed since the last report: ${count} (TypeError); other ` +
          'instances may not have received those messages',
        count,
      })),
    )
  })

  // Scenario: no tally to count in, and a rejection with no class. Expected: reported as `Error`.
  it('reports a rejection with nothing in it, without a tally', async () => {
    const publisher = publisherFor(failing(Object.create(null)))

    await publisher.publish().catch(() => undefined)
    await turn()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining('1 (Error)'),
    })
  })
})
