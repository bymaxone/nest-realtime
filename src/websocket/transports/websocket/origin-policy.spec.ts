/**
 * @fileoverview The pure parts of the origin policy, and what the adapter does with a server that cannot take it.
 * @layer infrastructure
 *
 * Constraint under test: the policy is asked for by a list or by `websocketOnly: true` and by nothing else, a request
 * with a `sid` key in its parsed query is refused whatever the value, and a server that cannot take the guard is closed
 * and refused rather than left answering unguarded.
 */
import 'reflect-metadata'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import {
  allowRequestFor,
  corsAnswersOrigins,
  refuseHostAllowRequest,
  refuseSid,
  wantsPolicy,
} from './origin-policy'
import { RealtimeIoAdapter } from './realtime-io-adapter'

describe('wantsPolicy', () => {
  it.each([
    [undefined, false],
    [{}, false],
    [{ websocketOnly: false }, false],
    [{ websocketOnly: true }, true],
    [{ allowedOrigins: ['https://a.example'] }, true],
    [{ allowedOrigins: ['https://a.example'], websocketOnly: false }, true],
  ])('reads %p as %p', (websocket, expected) => {
    expect(wantsPolicy(websocket)).toBe(expected)
  })
})

describe('corsAnswersOrigins', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['x', false],
    [{}, false],
    [{ methods: ['GET'] }, false],
    [{ origin: false }, false],
    [{ origin: '*' }, true],
    [{ origin: true }, true],
    [{ origin: undefined }, true],
    [{ origin: [] }, true],
    [true, true],
    [() => undefined, true],
  ])('reads %p as %p', (cors, expected) => {
    expect(corsAnswersOrigins(cors)).toBe(expected)
  })
})

describe('refuseSid', () => {
  const run = (request: unknown): Error | undefined => {
    let refusal: Error | undefined
    refuseSid(request, {}, (error) => (refusal = error))
    return refusal
  }

  it.each([
    ['a sid', { sid: 'abc' }],
    ['an empty sid', { sid: '' }],
    ['a sid that is undefined', { sid: undefined }],
  ])('refuses a query with %s', (_name, query) => {
    expect(run({ _query: query })).toBeInstanceOf(Error)
  })

  it('refuses a request whose query was not parsed', () => {
    expect(run({})).toBeInstanceOf(Error)
    expect(run({ _query: null })).toBeInstanceOf(Error)
    expect(run({ _query: 'sid=1' })).toBeInstanceOf(Error)
  })

  it('lets a query without a sid through', () => {
    expect(run({ _query: { EIO: '4', transport: 'websocket' } })).toBeUndefined()
  })
})

describe('allowRequestFor', () => {
  const upgrade = (headers: Record<string, string>) => ({
    headers: { upgrade: 'websocket', ...headers },
  })

  it('refuses a request that is not an upgrade, with or without a list', () => {
    for (const list of [undefined, ['https://a.example']]) {
      const answer = jest.fn()
      allowRequestFor(list, undefined)({ headers: {} } as never, answer)
      expect(answer).toHaveBeenCalledWith('forbidden', false)
    }
  })

  it('reads the upgrade header without regard to case', () => {
    const answer = jest.fn()
    allowRequestFor(undefined, undefined)({ headers: { upgrade: 'WebSocket' } } as never, answer)
    expect(answer).toHaveBeenCalledWith(null, true)
  })

  it('refuses an upgrade header that is not websocket', () => {
    const answer = jest.fn()
    allowRequestFor(undefined, undefined)({ headers: { upgrade: 'h2c' } } as never, answer)
    expect(answer).toHaveBeenCalledWith('forbidden', false)
  })

  it('admits any origin when there is no list', () => {
    const answer = jest.fn()
    allowRequestFor(undefined, undefined)(
      upgrade({ origin: 'https://any.example' }) as never,
      answer,
    )
    expect(answer).toHaveBeenCalledWith(null, true)
  })

  it('compares an origin with the list exactly', () => {
    const list = ['https://a.example', 'https://b.example']
    const answers: boolean[] = []
    for (const origin of ['https://b.example', 'https://B.example', 'https://a.example/']) {
      allowRequestFor(list, undefined)(upgrade({ origin }) as never, (_m, ok) => answers.push(ok))
    }
    expect(answers).toStrictEqual([true, false, false])
  })
})

describe('refuseHostAllowRequest', () => {
  it.each([undefined, () => undefined])('accepts %p', (value) => {
    expect(() => refuseHostAllowRequest(value)).not.toThrow()
  })

  it.each([null, 'yes', 1, {}])('refuses %p', (value) => {
    expect(() => refuseHostAllowRequest(value)).toThrow(/REALTIME_INVALID_OPTIONS/)
  })
})

describe('RealtimeIoAdapter on a server that cannot take the sid guard', () => {
  const adapterWith = (engine: unknown) => {
    const close = jest.fn().mockResolvedValue(undefined)
    const root = { on: jest.fn() }
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue({
      adapter: jest.fn(),
      close,
      of: jest.fn().mockReturnValue(root),
      on: jest.fn(),
      engine,
    } as never)
    const app = {
      get: (token: symbol) =>
        token === REALTIME_OPTIONS_TOKEN ? { websocket: { websocketOnly: true } } : undefined,
    }
    return { adapter: new RealtimeIoAdapter(app as never), close }
  }

  it('closes it and refuses when the engine has no middleware hook', () => {
    const { adapter, close } = adapterWith({ middlewares: [jest.fn()], on: jest.fn() })
    expect(() => adapter.createIOServer(3000)).toThrow(
      /REALTIME_TRANSPORT_UNAVAILABLE.*middleware hook/,
    )
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves a server with no engine alone, since it answers no request', () => {
    const { adapter } = adapterWith(undefined)
    expect(() => adapter.createIOServer(undefined as never)).not.toThrow()
  })

  it('registers the guard on an engine that has the hook', () => {
    const use = jest.fn()
    const { adapter } = adapterWith({ middlewares: [jest.fn()], on: jest.fn(), use })
    adapter.createIOServer(3000)
    expect(use).toHaveBeenCalledWith(refuseSid)
  })
})
