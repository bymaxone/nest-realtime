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
import type { Server } from 'socket.io'
import { REALTIME_ERROR_CODES, realtimeError } from '@bymax-one/nest-realtime/internal'
import { RealtimeGateway } from './realtime.gateway'
import { socketNamespace } from './socket-namespace'

/**
 * The key Nest reads a gateway's options under. `@nestjs/websockets/constants` has no `exports` entry, so an ES module cannot import
 * it by that name; the spec writes the same options with Nest's own decorator and fails if the key is ever not this one.
 */
const GATEWAY_OPTIONS = 'websockets:gateway_options'

/** For each class made here: the namespace of the instances Nest has not connected yet, and how many those are. */
const unconnected = new WeakMap<object, { namespace: string; count: number }>()

/**
 * Claims `namespace` for one instance of `target` until the returned function is called. The metadata Nest reads belongs to
 * the class, so two instances that wait to be connected cannot want different namespaces: the one connected first would be
 * given the other's.
 */
function claimNamespace(target: object, namespace: string): () => void {
  const held = unconnected.get(target)
  const waiting = held !== undefined && held.count > 0
  if (waiting && held.namespace !== namespace) {
    throw realtimeError(
      REALTIME_ERROR_CODES.INVALID_OPTIONS,
      `this module object is starting with websocket.namespace '${held.namespace}' and cannot also take '${namespace}' before Nest has connected that gateway: call forRoot or forRootAsync once for each application`,
      { who: 'RealtimeGateway' },
    )
  }
  const claim = waiting ? held : { namespace, count: 0 }
  claim.count += 1
  unconnected.set(target, claim)
  let released = false
  return () => {
    if (released) return
    released = true
    claim.count -= 1
  }
}

/**
 * A subclass of {@link RealtimeGateway} whose namespace is `websocket.namespace` of the options injected into it.
 *
 * An instance holds its namespace until Nest has connected it (`afterInit`) or destroyed it; another namespace is taken
 * after that.
 *
 * @returns The class to register for {@link RealtimeGateway}.
 * @throws Error carrying `REALTIME_INVALID_OPTIONS` when an instance is made while another, not connected yet, holds another namespace.
 */
export function gatewayBoundToNamespace(): typeof RealtimeGateway {
  class BoundRealtimeGateway extends RealtimeGateway {
    private readonly releaseNamespace: () => void

    constructor(...args: ConstructorParameters<typeof RealtimeGateway>) {
      super(...args)
      const namespace = socketNamespace(args[1].websocket?.namespace)
      this.releaseNamespace = claimNamespace(new.target, namespace)
      const own = Reflect.getMetadata(GATEWAY_OPTIONS, RealtimeGateway) as object
      // Written for the root as well: this class may still carry the namespace of an earlier instance.
      Reflect.defineMetadata(
        GATEWAY_OPTIONS,
        namespace === '/' ? own : { ...own, namespace },
        new.target,
      )
    }

    /** Nest has read the metadata by the time it calls this. Nothing here may throw: Nest reports it asynchronously. */
    override afterInit(server: Server): void {
      this.releaseNamespace()
      super.afterInit(server)
    }

    /** An instance destroyed without being connected, as in an application closed before `init`, will not be. */
    onModuleDestroy(): void {
      this.releaseNamespace()
    }
  }
  return BoundRealtimeGateway
}
