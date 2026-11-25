/**
 * @fileoverview The namespace `websocket.namespace` stands for.
 * @layer infrastructure
 */

/** The name Socket.IO gives it: unset and empty are the root, and a name without a leading slash gets one. */
export function socketNamespace(configured: string | undefined): string {
  if (!configured) return '/'
  return configured.startsWith('/') ? configured : `/${configured}`
}
