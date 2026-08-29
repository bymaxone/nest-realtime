/**
 * @fileoverview Canonical form of a configured SSE endpoint path.
 * @layer utils
 */

/**
 * Strip a single leading slash from an endpoint path.
 *
 * `@Sse()` takes a path relative to the controller prefix, so `'/events'` and
 * `'events'` name the same route. Comparing configured endpoints therefore has
 * to happen on the normalized form, or a registration would be rejected for a
 * difference the router never sees.
 *
 * @example
 * ```ts
 * normalizeEndpointPath('/events') // → 'events'
 * normalizeEndpointPath('events') // → 'events'
 * normalizeEndpointPath('/realtime/sse') // → 'realtime/sse'
 * ```
 */
export function normalizeEndpointPath(endpoint: string): string {
  return endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
}
