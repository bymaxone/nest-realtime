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
    expect(JSON.parse(response.end.mock.calls[0][0] as string)).toStrictEqual({
      code: 'REALTIME_TRANSPORT_UNAVAILABLE',
      message: expect.stringContaining('1 key outside the standard set') as unknown,
    })
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
})
