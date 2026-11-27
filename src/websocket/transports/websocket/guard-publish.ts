/**
 * @fileoverview The view of the caller's Redis client the Socket.IO Redis adapter publishes through.
 * @layer infrastructure
 */

/**
 * `client` as the Redis adapter is given it: `publish` has a handler beside the promise it returns, and every
 * other member is the client's own. The adapter never awaits a publish, so a rejected one would otherwise be an
 * unhandled rejection that ends the process. The client itself is not changed.
 *
 * Methods are bound to `client`, so they run as they would when called on it; `constructor` is handed over as it
 * is, because the adapter reads its name to recognize a cluster.
 *
 * @param client - The caller's `pubClient`.
 * @param onFailure - Told what each rejected publish rejected with.
 */
export function guardPublish<T extends object>(client: T, onFailure: (error: unknown) => void): T {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function' || property === 'constructor') return value
      if (property !== 'publish') return value.bind(target) as unknown
      return (...args: unknown[]) => {
        const pending = Reflect.apply(value, target, args) as unknown
        Promise.resolve(pending).catch(onFailure)
        return pending
      }
    },
  })
}
