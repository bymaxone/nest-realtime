/**
 * @fileoverview The namespace the library's gateway is bound to.
 * @layer infrastructure
 *
 * Constraint under test: `websocket.namespace` becomes the namespace of the gateway Nest instantiates and of no other
 * gateway, whenever the options resolve; a class holds one namespace for the instances Nest has not connected yet.
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { WebSocketGateway } from '@nestjs/websockets'
import { gatewayBoundToNamespace } from './gateway-binding'
import { RealtimeGateway } from './realtime.gateway'

/** What Nest injects into the gateway: the transport and the options, the rest being optional. */
function construct(Gateway: typeof RealtimeGateway, websocket?: { namespace?: string }) {
  return new Gateway({} as never, { websocket } as never)
}

const GATEWAY_OPTIONS = 'websockets:gateway_options'

const declared = (target: object): unknown => Reflect.getMetadata(GATEWAY_OPTIONS, target)

type Instance = ReturnType<typeof construct>

/** What Nest does when it has connected the gateway. */
function connect(gateway: Instance): void {
  const quiet = (['error', 'log'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  )
  const instance = gateway as unknown as { transport: object }
  Object.assign(instance.transport, { setServer: () => undefined })
  gateway.afterInit({ use: () => undefined } as never)
  for (const spy of quiet) spy.mockRestore()
}

/** What Nest does when it closes the application. */
function destroy(gateway: Instance): void {
  ;(gateway as unknown as { onModuleDestroy: () => void }).onModuleDestroy()
}

describe('gatewayBoundToNamespace', () => {
  // Scenario: a namespace in the options. Expected: the instance's class declares it, with the options already declared.
  it('declares websocket.namespace on the class it makes, keeping the declared options', () => {
    const Bound = gatewayBoundToNamespace()

    construct(Bound, { namespace: '/rt' })

    expect(declared(Bound)).toStrictEqual({
      ...(declared(RealtimeGateway) as object),
      namespace: '/rt',
    })
  })

  // Scenario: one class per call and two namespaces. Expected: each class carries its own and the base class none.
  it('keeps one namespace per class and never writes the base class', () => {
    const [first, second] = [gatewayBoundToNamespace(), gatewayBoundToNamespace()]

    construct(first, { namespace: '/a' })
    construct(second, { namespace: '/b' })

    expect([declared(first), declared(second)]).toStrictEqual([
      expect.objectContaining({ namespace: '/a' }),
      expect.objectContaining({ namespace: '/b' }),
    ])
    expect(declared(RealtimeGateway)).not.toHaveProperty('namespace')
  })

  // Scenario: no namespace, or the root. Expected: nothing is declared beyond what the base class has.
  it.each([[undefined], ['/']])('declares no namespace for %p', (namespace) => {
    const Bound = gatewayBoundToNamespace()

    construct(Bound, namespace === undefined ? undefined : { namespace })

    expect(declared(Bound)).toStrictEqual(declared(RealtimeGateway))
  })

  // Scenario: the root after a namespace, on one class. Expected: the namespace written before is gone.
  it('drops an earlier namespace when the next instance has the root', () => {
    const Bound = gatewayBoundToNamespace()
    connect(construct(Bound, { namespace: '/rt' }))

    construct(Bound)

    expect(declared(Bound)).toStrictEqual(declared(RealtimeGateway))
  })

  // Scenario: a subclass of a bound class. Expected: it is bound itself, and the class it extends keeps its own.
  it('binds a subclass of a bound class', () => {
    const Bound = gatewayBoundToNamespace()
    class Sub extends Bound {}

    construct(Sub, { namespace: '/sub' })

    expect(declared(Sub)).toStrictEqual(expect.objectContaining({ namespace: '/sub' }))
    expect(declared(Bound)).toStrictEqual(declared(RealtimeGateway))
  })

  // Scenario: a bound instance with a tally and tracing, refusing a handshake while it shuts down. Expected: both are used.
  it('hands the tally and the tracing to the gateway', async () => {
    const tally = { refused: jest.fn() }
    const tracing = { span: jest.fn((_n: string, _a: object, run: () => Promise<void>) => run()) }
    const transport = { shuttingDown: true, setServer: jest.fn() }
    const gateway = new (gatewayBoundToNamespace())(
      transport as never,
      {} as never,
      tally as never,
      tracing as never,
    )
    let middleware: (socket: object, next: () => void) => Promise<void> = async () => undefined
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never)
    await middleware({}, () => undefined)

    expect(tally.refused).toHaveBeenCalledWith('unavailable')
    expect(tracing.span).toHaveBeenCalledWith(
      'realtime.handshake',
      expect.anything(),
      expect.any(Function),
    )
    jest.restoreAllMocks()
  })

  // Scenario: the bound class. Expected: it is a RealtimeGateway.
  it('is a RealtimeGateway', () => {
    expect(construct(gatewayBoundToNamespace())).toBeInstanceOf(RealtimeGateway)
  })

  // Scenario: a second instance while the first is not connected, wanting another namespace. Expected: refused, naming the
  // gateway and both namespaces.
  it.each([
    ['/rt', '/other', '/rt', '/other'],
    ['/rt', undefined, '/rt', '/'],
    [undefined, '/rt', '/', '/rt'],
  ])('refuses %p then %p before the first is connected', (first, second, held, asked) => {
    const Bound = gatewayBoundToNamespace()
    construct(Bound, first === undefined ? undefined : { namespace: first })

    let thrown: Error | undefined
    try {
      construct(Bound, second === undefined ? undefined : { namespace: second })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toContain('REALTIME_INVALID_OPTIONS')
    expect(thrown?.message).toContain(`'${held}' and cannot also take '${asked}'`)
    expect(thrown?.message).toContain('RealtimeGateway')
    expect(declared(Bound)).toStrictEqual(
      held === '/' ? declared(RealtimeGateway) : expect.objectContaining({ namespace: held }),
    )
  })

  // Scenario: the same namespace written two ways, both waiting. Expected: accepted.
  it.each([
    ['/rt', '/rt'],
    ['/rt', 'rt'],
    [undefined, ''],
    ['', '/'],
  ])('accepts %p then %p', (first, second) => {
    const Bound = gatewayBoundToNamespace()
    construct(Bound, first === undefined ? undefined : { namespace: first })

    expect(() =>
      construct(Bound, second === undefined ? undefined : { namespace: second }),
    ).not.toThrow()
  })

  // Scenario: the first instance is connected, or destroyed. Expected: another namespace is accepted.
  it.each([
    ['connected', connect],
    ['destroyed', destroy],
  ])('takes another namespace once the first instance is %s', (_case, release) => {
    const Bound = gatewayBoundToNamespace()
    release(construct(Bound, { namespace: '/a' }))

    construct(Bound, { namespace: '/b' })

    expect(declared(Bound)).toStrictEqual(expect.objectContaining({ namespace: '/b' }))
  })

  // Scenario: two instances wait on one namespace and one is connected and then destroyed. Expected: the other still holds it.
  it('releases an instance once, leaving the one that still waits', () => {
    const Bound = gatewayBoundToNamespace()
    const first = construct(Bound, { namespace: '/a' })
    construct(Bound, { namespace: '/a' })

    connect(first)
    destroy(first)

    expect(() => construct(Bound, { namespace: '/b' })).toThrow('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: two instances wait on one namespace and the second one is connected. Expected: the first still holds it.
  it('holds the namespace for the first instance when the second is connected', () => {
    const Bound = gatewayBoundToNamespace()
    construct(Bound, { namespace: '/a' })
    const second = construct(Bound, { namespace: '/a' })

    connect(second)

    expect(() => construct(Bound, { namespace: '/b' })).toThrow('REALTIME_INVALID_OPTIONS')
  })

  // Scenario: the key Nest reads a gateway's options under. Expected: it is the one this module writes. Nest's own decorator
  // is the witness, so a key Nest renames fails here, in a spec, and not in an application that boots on the wrong namespace.
  it("writes the key Nest's own decorator writes", () => {
    class Host {}
    WebSocketGateway({ namespace: '/probe' })(Host)

    expect(Reflect.getMetadata(GATEWAY_OPTIONS, Host)).toStrictEqual(
      expect.objectContaining({ namespace: '/probe' }),
    )
  })
})
