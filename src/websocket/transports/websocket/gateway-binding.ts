/**
 * @fileoverview Binds the library's gateway to `websocket.namespace`, which is known only when the module's options resolve.
 * @layer infrastructure
 *
 * `@WebSocketGateway({ namespace })` is read when the class is decorated, before a `forRootAsync` factory has run. Nest reads
 * the gateway options again for the class it instantiates, so the namespace is written to the metadata of a subclass made
 * here, once the options are in hand: a gateway whose namespace is declared makes Nest open that namespace on the root server
 * itself, and every gateway that declares none stays on `/`.
 */
import 'reflect-metadata'
import { REALTIME_ERROR_CODES, realtimeError } from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'

/**
 * The key Nest reads a gateway's options under. `@nestjs/websockets/constants` has no `exports` entry, so an ES module cannot import
 * it by that name; the spec writes the same options with Nest's own decorator and fails if the key is ever not this one.
 */
const GATEWAY_OPTIONS = 'websockets:gateway_options'

/** The namespace each class made here was first instantiated with. */
const bound = new WeakMap<object, string>()

/**
 * A subclass of {@link RealtimeGateway} whose namespace is `websocket.namespace` of the options injected into it.
 *
 * @returns The class to register for {@link RealtimeGateway}. Nothing is written when the namespace is unset or `/`.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS` when an instance of the class is given another namespace than the first.
 */
export function gatewayBoundToNamespace(): typeof RealtimeGateway {
  class BoundRealtimeGateway extends RealtimeGateway {
    constructor(...args: ConstructorParameters<typeof RealtimeGateway>) {
      super(...args)
      const namespace = args[1].websocket?.namespace ?? '/'
      const carried = bound.get(new.target)
      if (carried !== undefined && carried !== namespace) {
        throw realtimeError(
          REALTIME_ERROR_CODES.INVALID_OPTIONS,
          `this module object already serves websocket.namespace '${carried}', not '${namespace}': call forRoot once for each application`,
          { who: 'RealtimeGateway' },
        )
      }
      bound.set(new.target, namespace)
      if (namespace === '/') return
      const own: unknown = Reflect.getMetadata(GATEWAY_OPTIONS, RealtimeGateway)
      Reflect.defineMetadata(GATEWAY_OPTIONS, { ...(own as object), namespace }, new.target)
    }
  }
  return BoundRealtimeGateway
}
