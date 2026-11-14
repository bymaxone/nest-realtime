/**
 * @fileoverview Finding where a response reports that its connection ended, on each adapter.
 * @layer transport
 */
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import type { SseResponse } from '../../interfaces/sse-http.interface'
import { onResponseClose } from './response-close'

describe('onResponseClose', () => {
  it('listens on the response itself, as Express hands it over', () => {
    const res = Object.assign(new EventEmitter(), { setHeader: jest.fn(), write: jest.fn() })
    const listener = jest.fn()

    onResponseClose(res, listener)
    res.emit('close')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  // Fastify hands the handler a reply: it has no `once`, and the Node response is `reply.raw`.
  it('listens on the response behind a wrapper that has no once of its own, as Fastify hands it over', () => {
    const raw = new EventEmitter()
    const reply = { setHeader: jest.fn(), write: jest.fn(), raw }
    const listener = jest.fn()

    onResponseClose(reply, listener)
    raw.emit('close')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('listens on the socket when neither the response nor a wrapped one can', () => {
    const socket = new EventEmitter()
    const listener = jest.fn()

    onResponseClose({ setHeader: jest.fn(), write: jest.fn(), socket }, listener)
    socket.emit('close')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does nothing, and does not throw, when the response offers no close signal at all', () => {
    const listener = jest.fn()

    expect(() =>
      onResponseClose({ setHeader: jest.fn(), write: jest.fn() }, listener),
    ).not.toThrow()
    expect(() => onResponseClose(undefined, listener)).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it('prefers the response over the wrapped one, and listens once', () => {
    const res = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      write: jest.fn(),
      raw: new EventEmitter(),
    })
    const listener = jest.fn()

    onResponseClose(res, listener)
    res.emit('close')
    res.emit('close')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(res.raw.listenerCount('close')).toBe(0)
  })

  // The signal a real Node server gives: the client leaves, the response emits `close`.
  it('is called when a real client leaves a real Node server', async () => {
    const closed = new Promise<void>((resolve) => {
      const server = createServer((_req, res) => {
        onResponseClose(res, () => {
          server.close()
          resolve()
        })
        res.write('x')
      })
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number }
        import('node:http').then(({ get }) => {
          const req = get({ host: '127.0.0.1', port, agent: false }, (res) => {
            res.once('data', () => req.destroy())
          })
          req.on('error', () => undefined)
        })
      })
    })

    await expect(closed).resolves.toBeUndefined()
  })

  describe('the function it returns', () => {
    const base = { setHeader: jest.fn(), write: jest.fn() }
    it.each<[string, (emitter: EventEmitter) => SseResponse]>([
      ['the response', (emitter) => Object.assign(emitter, base)],
      ['the response behind a wrapper', (emitter) => ({ ...base, raw: emitter })],
      ['the socket', (emitter) => ({ ...base, socket: emitter })],
    ])('removes the listener it added on %s', (_label, shape) => {
      const emitter = new EventEmitter()
      const listener = jest.fn()

      const detach = onResponseClose(shape(emitter), listener)
      expect(emitter.listenerCount('close')).toBe(1)
      detach()
      emitter.emit('close')

      expect(emitter.listenerCount('close')).toBe(0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('does nothing when there was nothing to listen on', () => {
      const detach = onResponseClose({ setHeader: jest.fn(), write: jest.fn() }, jest.fn())

      expect(detach).not.toThrow()
    })
  })
})
