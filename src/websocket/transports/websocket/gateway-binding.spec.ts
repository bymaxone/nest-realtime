/**
 * @fileoverview The namespace the library's gateway is bound to.
 * @layer infrastructure
 *
 * Constraint under test: `websocket.namespace` becomes the namespace of the gateway Nest instantiates and of no other
 * gateway, whenever the options resolve, and an unset or root namespace writes nothing.
 */
import 'reflect-metadata'
import { WebSocketGateway } from '@nestjs/websockets'
import { gatewayBoundToNamespace } from './gateway-binding'
import { RealtimeGateway } from './realtime.gateway'

/** What Nest injects into the gateway: the transport and the options, the rest being optional. */
function construct(Gateway: typeof RealtimeGateway, websocket?: { namespace?: string }) {
  return new Gateway({} as never, { websocket } as never)
}

const GATEWAY_OPTIONS = 'websockets:gateway_options'

const declared = (target: object): unknown => Reflect.getMetadata(GATEWAY_OPTIONS, target)

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

  // Scenario: the bound class. Expected: it is a RealtimeGateway.
  it('is a RealtimeGateway', () => {
    expect(construct(gatewayBoundToNamespace())).toBeInstanceOf(RealtimeGateway)
  })

  // Scenario: one class instantiated twice, as when one dynamic module object serves two applications. Expected: the same
  // namespace is accepted, a different one (the root included) is refused at boot.
  it.each([
    ['/rt', '/other'],
    ['/rt', undefined],
    [undefined, '/rt'],
  ])('refuses a second instance given another namespace (%p then %p)', (first, second) => {
    const Bound = gatewayBoundToNamespace()
    construct(Bound, first === undefined ? undefined : { namespace: first })

    expect(() =>
      construct(Bound, second === undefined ? undefined : { namespace: second }),
    ).toThrow('REALTIME_INVALID_OPTIONS')
  })

  it('accepts a second instance given the same namespace', () => {
    const Bound = gatewayBoundToNamespace()
    construct(Bound, { namespace: '/rt' })

    expect(() => construct(Bound, { namespace: '/rt' })).not.toThrow()
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
