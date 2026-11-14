/**
 * @fileoverview The room an instance has for connections: counted over both transports and the
 * places held for handshakes in flight, and given back however a handshake ends.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import type { BymaxRealtimeModuleOptions } from '../interfaces/realtime-module-options.interface'
import {
  ConnectionAdmission,
  ConnectionLimitError,
  DEFAULT_MAX_CONNECTIONS,
} from './connection-admission.service'
import { ConnectionRegistry } from './connection-registry.service'
import type { ConnectionRecord } from './connection-registry.service'

function record(id: string, transport: 'sse' | 'websocket'): ConnectionRecord {
  return {
    connectionId: id,
    userId: `u-${id}`,
    transport,
    connectedAt: new Date(),
    subject: null,
    close$: null,
    originalAuth: { userId: `u-${id}` },
  } as ConnectionRecord
}

function build(maxConnections?: number, authenticateTimeoutMs?: number) {
  const registry = new ConnectionRegistry()
  const options: BymaxRealtimeModuleOptions = {
    transport: 'both',
    authenticator: { authenticate: async () => null },
    ...(maxConnections === undefined ? {} : { maxConnections }),
    ...(authenticateTimeoutMs === undefined ? {} : { authenticateTimeoutMs }),
  }
  return { registry, admission: new ConnectionAdmission(options, registry) }
}

describe('ConnectionAdmission', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it('admits up to maxConnections and refuses the next with a ConnectionLimitError', () => {
    const { admission } = build(3)
    for (let i = 0; i < 3; i += 1) admission.admit()

    expect(() => admission.admit()).toThrow(ConnectionLimitError)
  })

  it('says how many connections the instance holds in the error', () => {
    const { admission } = build(3)
    for (let i = 0; i < 3; i += 1) admission.admit()

    expect(() => admission.admit()).toThrow('the instance already holds 3 connections')
  })

  it('admits ten thousand when the option is not set, and refuses the ten-thousand-and-first', () => {
    const { admission } = build()
    for (let i = 0; i < DEFAULT_MAX_CONNECTIONS; i += 1) admission.admit()

    expect(DEFAULT_MAX_CONNECTIONS).toBe(10_000)
    expect(() => admission.admit()).toThrow(ConnectionLimitError)
  })

  it('counts the connections registered on either transport together with the places held', () => {
    const { registry, admission } = build(4)
    registry.register(record('a', 'sse'))
    registry.register(record('b', 'websocket'))
    admission.admit()
    admission.admit()

    expect(() => admission.admit()).toThrow(ConnectionLimitError)
  })

  it('gives a place back once, however many times release is called', () => {
    const { admission } = build(1)
    const ticket = admission.admit()
    ticket.release()
    ticket.release()
    const next = admission.admit()

    expect(() => admission.admit()).toThrow(ConnectionLimitError)
    next.release()
  })

  it('has every place back after many admissions have been released', () => {
    const { admission } = build(2)
    for (let i = 0; i < 1_000; i += 1) admission.admit().release()

    expect(() => {
      admission.admit()
      admission.admit()
    }).not.toThrow()
  })

  it('admits again when a registered connection is removed', () => {
    const { registry, admission } = build(1)
    registry.register(record('a', 'sse'))
    expect(() => admission.admit()).toThrow(ConnectionLimitError)

    registry.unregister('a')

    expect(() => admission.admit()).not.toThrow()
  })

  it('logs one line for a window of refusals, with their count and without the connection', () => {
    const { admission } = build(1)
    admission.admit()
    for (let i = 0; i < 50; i += 1) expect(() => admission.admit()).toThrow(ConnectionLimitError)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 (maxConnections)'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connections refused'))
  })

  describe('the log of refusals', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    // One line for each ten seconds: the refusals between two lines are counted in the second.
    it('reports the refusals of a window in the first line after it, counting each one', () => {
      const { admission } = build(1)
      admission.admit()
      for (let i = 0; i < 5; i += 1) expect(() => admission.admit()).toThrow(ConnectionLimitError)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('refused since the last report: 1,'),
      )

      jest.advanceTimersByTime(9_999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      expect(warn).toHaveBeenCalledTimes(1)
      jest.advanceTimersByTime(1)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)

      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenLastCalledWith(
        expect.stringContaining('refused since the last report: 6,'),
      )
    })
  })

  // A request on a framework that reports no close never gives its place back by itself, and enough
  // of them would fill the instance: the place is bounded in time whatever happens to the request.
  describe('a place that nothing gives back', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('is given back at the next admission once authenticateTimeoutMs and a margin have passed', () => {
      const { admission } = build(1, 2_000)
      admission.admit()

      jest.advanceTimersByTime(6_999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      jest.advanceTimersByTime(1)

      expect(() => admission.admit()).not.toThrow()
    })

    it('is given back after fifteen seconds when authenticateTimeoutMs is not set', () => {
      const { admission } = build(1)
      admission.admit()

      jest.advanceTimersByTime(14_999)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      jest.advanceTimersByTime(1)

      expect(() => admission.admit()).not.toThrow()
    })

    it('returns the count to its baseline after many such places, and leaves a timer behind for none', () => {
      const { admission } = build(3, 1_000)
      for (let i = 0; i < 3; i += 1) admission.admit()
      expect(() => admission.admit()).toThrow(ConnectionLimitError)

      jest.advanceTimersByTime(6_000)

      for (let i = 0; i < 3; i += 1) admission.admit()
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
      expect(jest.getTimerCount()).toBe(0)
    })

    it('keeps a place taken later after one taken earlier has been given back', () => {
      const { admission } = build(2, 1_000)
      admission.admit()
      jest.advanceTimersByTime(3_000)
      admission.admit()

      jest.advanceTimersByTime(3_001)

      // The first place is back and the second is still held: room for exactly one.
      expect(() => admission.admit()).not.toThrow()
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
    })
  })

  // The waits before a connection registers add up, so a handshake can outlive its place; it must
  // hold one again, or not register, rather than go past the limit.
  describe('a place taken again for a handshake that outlived it', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('is held again when there is room', () => {
      const { admission } = build(1, 1_000)
      const ticket = admission.admit()
      jest.advanceTimersByTime(6_000)

      ticket.renew()

      expect(() => admission.admit()).toThrow(ConnectionLimitError)
    })

    it('is refused when the instance has filled since, and the one that filled it keeps its place', () => {
      const { admission } = build(1, 1_000)
      const late = admission.admit()
      jest.advanceTimersByTime(6_000)
      admission.admit()

      expect(() => late.renew()).toThrow(ConnectionLimitError)
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
    })

    it('does nothing for a place that is still held', () => {
      const { admission } = build(2, 1_000)
      const ticket = admission.admit()
      admission.admit()

      expect(() => ticket.renew()).not.toThrow()
      expect(() => admission.admit()).toThrow(ConnectionLimitError)
    })

    it('does not bring back a place that was released', () => {
      const { admission } = build(1, 1_000)
      const ticket = admission.admit()
      ticket.release()

      ticket.renew()

      expect(() => admission.admit()).not.toThrow()
    })
  })
})
