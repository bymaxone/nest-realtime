/**
 * @fileoverview What the adapter installs on a server it creates, and what it refuses while Object.prototype holds a planted key.
 * @layer infrastructure
 */
import 'reflect-metadata'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { REALTIME_OPTIONS_TOKEN } from '@bymax-one/nest-realtime/internal'
import { RealtimeIoAdapter } from './realtime-io-adapter'
import { shadowSocket } from './server-option-names'

type Guard = (request: unknown, response: unknown, next: () => void) => void
type PacketListener = (packet: { type: string }) => void

/** A server with the parts the adapter reaches, recording what it was given. */
function makeServer() {
  const root = { on: jest.fn() }
  return {
    adapter: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    of: jest.fn().mockReturnValue(root),
    on: jest.fn(),
    engine: { middlewares: [jest.fn()] as unknown[], on: jest.fn() },
    root,
  }
}

/** Plants a key on the root prototype for the length of `run`; it is enumerable, as an assignment or a merge makes it. */
function planted<T>(run: () => T): T {
  Object.defineProperty(Object.prototype, 'zzGuardRow', {
    value: 1,
    configurable: true,
    enumerable: true,
    writable: true,
  })
  try {
    return run()
  } finally {
    Reflect.deleteProperty(Object.prototype, 'zzGuardRow')
  }
}

type Slot = [object, PropertyKey]

/** The built-ins the adapter and its helpers could call, each of which a host could replace after the library is loaded. */
const REPLACED: Slot[] = [
  [Array.prototype, 'unshift'],
  [Array.prototype, 'push'],
  [Array.prototype, Symbol.iterator],
  [Object, 'assign'],
  [Object, 'keys'],
  [Object, 'entries'],
  [Object, 'defineProperty'],
  [Object, 'create'],
  [Reflect, 'ownKeys'],
  [Reflect, 'defineProperty'],
]

/**
 * Runs `run` with every built-in of {@link REPLACED} replaced by one that does nothing, and puts them back. Plain loops and
 * locals only: the iterator protocol and `Object.defineProperty`, which restores them, are among what is replaced.
 */
function withBuiltinsReplaced(run: () => unknown): { value?: unknown; error?: unknown } {
  const define = Object.defineProperty
  const saved: (PropertyDescriptor | undefined)[] = []
  for (let n = 0; n < REPLACED.length; n += 1) {
    const slot = REPLACED[n] as Slot
    saved[n] = Object.getOwnPropertyDescriptor(slot[0], slot[1])
  }
  const outcome: { value?: unknown; error?: unknown } = {}
  try {
    for (let n = 0; n < REPLACED.length; n += 1) {
      const slot = REPLACED[n] as Slot
      define(slot[0], slot[1], { value: () => undefined, configurable: true, writable: true })
    }
    try {
      outcome.value = run()
    } catch (caught) {
      outcome.error = caught
    }
  } finally {
    for (let n = 0; n < REPLACED.length; n += 1) {
      const slot = REPLACED[n] as Slot
      define(slot[0], slot[1], saved[n] as PropertyDescriptor)
    }
  }
  return outcome
}

describe('RealtimeIoAdapter guards', () => {
  let server: ReturnType<typeof makeServer>
  let adapter: RealtimeIoAdapter
  let superSpy: jest.SpyInstance

  beforeEach(() => {
    server = makeServer()
    superSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockImplementation(() => server)
    const options = new Map<symbol, unknown>([[REALTIME_OPTIONS_TOKEN, {}]])
    adapter = new RealtimeIoAdapter({ get: (token: symbol) => options.get(token) } as never)
  })

  afterEach(() => superSpy.mockRestore())

  // Scenario: the server is created while a key is planted. Expected: the refusal is the library's, names the adapter and
  // the code, and counts the keys without naming them.
  it('refuses to create a server while a key is planted', () => {
    const attempt = (): unknown => planted(() => adapter.createIOServer(3000))

    expect(attempt).toThrow(
      '[RealtimeIoAdapter] REALTIME_TRANSPORT_UNAVAILABLE: 1 key outside the standard set found on Object.prototype',
    )
    expect(superSpy).not.toHaveBeenCalled()
  })

  // Scenario: a request reaches the first engine middleware. Expected: it passes on a clean realm, and while a key is
  // planted it is answered with a 500, a JSON body that has the code and the count, and is not passed on.
  it('answers a request with a 500 while a key is planted, and passes it on otherwise', () => {
    adapter.createIOServer(3000)
    const guard = server.engine.middlewares[0] as Guard
    const response = { statusCode: 200, setHeader: jest.fn(), end: jest.fn() }
    const next = jest.fn()

    guard({}, response, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(response.end).not.toHaveBeenCalled()

    planted(() => guard({}, response, next))
    expect(next).toHaveBeenCalledTimes(1)
    expect(response.statusCode).toBe(500)
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(response.end.mock.calls[0][0]).toBe(
      '{"code":"REALTIME_TRANSPORT_UNAVAILABLE","count":1}',
    )
  })

  // Scenario: a `toJSON` is among the planted keys. Expected: it is neither called nor consulted, so the body is the one
  // the guard writes, and the planted function never runs.
  it('writes the same body when the planted key is a toJSON, and never runs it', () => {
    adapter.createIOServer(3000)
    const guard = server.engine.middlewares[0] as Guard
    const response = { statusCode: 200, setHeader: jest.fn(), end: jest.fn() }
    const toJSON = jest.fn().mockReturnValue('replaced')
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: toJSON,
      configurable: true,
      enumerable: true,
      writable: true,
    })
    try {
      guard({}, response, jest.fn())
    } finally {
      Reflect.deleteProperty(Object.prototype, 'toJSON')
    }

    expect(response.end.mock.calls[0][0]).toBe(
      '{"code":"REALTIME_TRANSPORT_UNAVAILABLE","count":1}',
    )
    expect(toJSON).not.toHaveBeenCalled()
  })

  // Scenario: a packet arrives on an open connection. Expected: it is left alone on a clean realm; while a key is planted
  // it becomes a `noop` and the connection is closed, discarding what is queued.
  it('turns a packet into a noop and closes the connection while a key is planted', () => {
    adapter.createIOServer(3000)
    const onConnection = server.engine.on.mock.calls[0] as [string, (connection: object) => void]
    const connection = { prependListener: jest.fn(), close: jest.fn() }
    expect(onConnection[0]).toBe('connection')

    onConnection[1](connection)
    const [event, listener] = connection.prependListener.mock.calls[0] as [string, PacketListener]
    expect(event).toBe('packet')

    const clean = { type: 'message' }
    listener(clean)
    expect(clean.type).toBe('message')
    expect(connection.close).not.toHaveBeenCalled()

    const dirty = { type: 'message' }
    planted(() => listener(dirty))
    expect(dirty.type).toBe('noop')
    expect(connection.close).toHaveBeenCalledWith(true)
  })

  // Scenario: the server is created. Expected: the main namespace, and each namespace made later, gives its sockets their
  // own lazy state on connection.
  it('gives the sockets of every namespace their own state', () => {
    adapter.createIOServer(3000)
    expect(server.of).toHaveBeenCalledWith('/')
    expect(server.root.on).toHaveBeenCalledWith('connection', shadowSocket)

    const created = server.on.mock.calls.find((call) => call[0] === 'new_namespace') as [
      string,
      (namespace: { on: jest.Mock }) => void,
    ]
    const namespace = { on: jest.fn() }
    created[1](namespace)

    expect(namespace.on).toHaveBeenCalledWith('connection', shadowSocket)
  })

  // Scenario: each built-in the adapter and its helpers could call is replaced, after the import, by one that does nothing,
  // and a server is created. Expected: the guard is still the first middleware and still refuses, the options still carry
  // their own keys, and a socket is still given its own state: nothing the helpers use is read live.
  it('installs the guard and the own keys with the built-ins of the process replaced', () => {
    const outcome = withBuiltinsReplaced(() =>
      adapter.createIOServer(3000, { cors: { origin: 'https://a.example' } } as never),
    )

    expect(outcome.error).toBeUndefined()
    expect(outcome.value).toBe(server)
    const guard = server.engine.middlewares[0] as Guard
    const response = { statusCode: 200, setHeader: jest.fn(), end: jest.fn() }
    planted(() => guard({}, response, jest.fn()))
    expect(response.statusCode).toBe(500)
    const options = superSpy.mock.calls[0][1] as Record<string, unknown>
    expect(Object.hasOwn(options, 'allowRequest')).toBe(true)
    expect(Object.hasOwn(options.cors as object, 'credentials')).toBe(true)
    const socket = {}
    ;(server.root.on.mock.calls[0] as [string, (socket: object) => void])[1](socket)
    expect(Object.hasOwn(socket, '_anyListeners')).toBe(true)
  })

  // Scenario: the engine's middleware list takes no new entry first (a list that ignores what is written to it). Expected:
  // the server is not handed out, since it would answer requests unguarded: it is closed, and the refusal says why, with
  // the code and who raised it.
  it('closes and refuses a server whose guard did not end up first', () => {
    server.engine.middlewares = new Proxy([], { set: () => true }) as unknown[]

    const attempt = (): unknown => adapter.createIOServer(3000)

    expect(attempt).toThrow(
      '[RealtimeIoAdapter] REALTIME_TRANSPORT_UNAVAILABLE: the request guard could not be installed first',
    )
    expect(server.close).toHaveBeenCalledTimes(1)
  })
})
