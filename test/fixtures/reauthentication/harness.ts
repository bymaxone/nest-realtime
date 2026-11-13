/**
 * @fileoverview Shared doubles for the ReauthenticationService specs: a connection record, the
 * registry, the realtime service, the authenticator and the module options it reads, the service
 * built from them, and a helper that drains the microtask queue.
 * @layer test
 */
import { ReauthenticationService } from '../../../src/server/services/reauthentication.service'
import type { ConnectionRecord } from '../../../src/server/services/connection-registry.service'

/** Drain the microtask queue through several turns. */
export async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

/** A connection record for user `userId` with id `id`, as the registry stores it. */
export function mkRecord(id = 'c1', userId = 'u1'): ConnectionRecord {
  return {
    connectionId: id,
    userId,
    tenantId: 't1',
    transport: 'sse',
    ip: '127.0.0.1',
    userAgent: undefined,
    connectedAt: new Date(),
    subject: null,
    close$: null,
    originalAuth: { userId, tenantId: 't1', roles: undefined, metadata: undefined },
  }
}

/**
 * Stand in for ConnectionRegistry, filtering by transport as the real one does.
 *
 * Returning every record for any argument would be a laxer mock than the registry:
 * the service reads both indexes, and a mock that ignores the argument reports each
 * connection twice — a failure of the harness that reads as a defect in the service.
 */
export function mkConnections(records: ConnectionRecord[]) {
  return {
    allByTransport: jest.fn((transport: string) =>
      records.filter((r) => r.transport === transport),
    ),
  }
}

/** A realtime service double whose `emitToUser` and `disconnect` resolve at once. */
export function mkRealtime() {
  return {
    emitToUser: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  }
}

/** An authenticator double; it carries `revalidate` only when one is given. */
export function mkAuth(revalidate?: jest.Mock) {
  const auth: Record<string, unknown> = { authenticate: jest.fn() }
  if (revalidate) auth['revalidate'] = revalidate
  return auth
}

/** Module options with the SSE transport and the given re-authentication policy. */
export function mkOptions(policy?: {
  intervalSeconds?: number
  onFailure?: 'disconnect' | 'event'
  cacheTtlMs?: number
  revalidateTimeoutMs?: number
  concurrency?: number
}) {
  return { transport: 'sse', authenticator: {}, reauthenticationPolicy: policy }
}

/** The service under test wired to the given doubles. */
export function build(
  connections: ReturnType<typeof mkConnections>,
  realtime: ReturnType<typeof mkRealtime>,
  auth: ReturnType<typeof mkAuth>,
  options: ReturnType<typeof mkOptions>,
  hooks?: object,
) {
  return new ReauthenticationService(
    connections as never,
    realtime as never,
    auth as never,
    options as never,
    hooks as never,
  )
}
