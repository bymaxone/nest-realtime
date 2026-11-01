/**
 * @fileoverview RealtimeIoAdapter with the real Redis adapter and a Redis that never answers.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import type { Server } from 'socket.io'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import type { BymaxRealtimeModuleOptions } from '@bymax-one/nest-realtime/internal'
import { RealtimeIoAdapter } from './realtime-io-adapter'

/** A client whose every command stays pending, the way one does while Redis is unreachable. */
function unreachableClient() {
  const pending = () => new Promise<never>(() => undefined)
  const subscriber = { on: jest.fn(), subscribe: pending, psubscribe: pending }
  return { on: jest.fn(), publish: pending, duplicate: () => subscriber }
}

describe('RealtimeIoAdapter — Redis unreachable at boot', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  // Connecting is the client's and the adapter's business: an unreachable Redis must not turn a
  // working configuration into a boot failure, which is reserved for what cannot be installed.
  it('boots and registers the adapter when Redis never answers', () => {
    const options = {
      websocket: { redisAdapter: { pubClient: unreachableClient() } },
    } as unknown as BymaxRealtimeModuleOptions
    const app = { get: (token: symbol) => (token === REALTIME_OPTIONS_TOKEN ? options : undefined) }

    const server = new RealtimeIoAdapter(app as never).createIOServer(0) as Server

    expect(server.of('/').adapter.constructor.name).not.toBe('Adapter')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Redis adapter registered'))
  })
})
