/**
 * @fileoverview Indexed registry of active connections (by id / user / tenant).
 * @layer infrastructure
 */
import { Injectable } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Subject } from 'rxjs'

/** Transport kind a connection belongs to. */
export type ConnectionTransport = 'sse' | 'websocket'

/**
 * Internal record kept per active connection.
 *
 * `subject` and `close$` are populated only for SSE connections (the per-connection
 * RxJS stream and its server-initiated teardown signal). WebSocket connections set
 * both to `null` and rely on the Socket.IO server's own emit/disconnect mechanism.
 */
export interface ConnectionRecord {
  connectionId: string
  userId: string
  tenantId: string | undefined
  transport: ConnectionTransport
  ip: string
  userAgent: string | undefined
  connectedAt: Date
  /** Per-connection event stream (SSE only); `null` for WebSocket. */
  subject: Subject<MessageEvent> | null
  /** Server-initiated teardown signal (SSE only); `null` for WebSocket. */
  close$: Subject<void> | null
  /** Snapshot of the original authentication result — used by the re-auth policy. */
  originalAuth: {
    userId: string
    tenantId: string | undefined
    roles: readonly string[] | undefined
  }
}

/**
 * Indexed registry of active connections.
 *
 * Maintains three maps — `byId` (connectionId → record), `byUserId` (userId →
 * Set<connectionId>) and `byTenantId` (tenantId → Set<connectionId>) — kept
 * consistent on every `register`/`unregister`. Operations are amortized O(1);
 * mutation is single-threaded (the Node.js event loop), so no locking is needed.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly byId = new Map<string, ConnectionRecord>()
  private readonly byUserId = new Map<string, Set<string>>()
  private readonly byTenantId = new Map<string, Set<string>>()

  /** Register a connection and index it by user and tenant. */
  register(record: ConnectionRecord): void {
    this.byId.set(record.connectionId, record)
    this.addToSetMap(this.byUserId, record.userId, record.connectionId)
    if (record.tenantId !== undefined) {
      this.addToSetMap(this.byTenantId, record.tenantId, record.connectionId)
    }
  }

  /** Remove a connection from every index. Returns the removed record, if any. */
  unregister(connectionId: string): ConnectionRecord | undefined {
    const record = this.byId.get(connectionId)
    if (!record) return undefined
    this.byId.delete(connectionId)
    this.removeFromSetMap(this.byUserId, record.userId, connectionId)
    if (record.tenantId !== undefined) {
      this.removeFromSetMap(this.byTenantId, record.tenantId, connectionId)
    }
    return record
  }

  /** Look up a single connection by id. */
  get(connectionId: string): ConnectionRecord | undefined {
    return this.byId.get(connectionId)
  }

  /** All connections of a user, optionally filtered by transport. */
  byUser(userId: string, transport?: ConnectionTransport): ConnectionRecord[] {
    return this.resolve(this.byUserId.get(userId), transport)
  }

  /** All connections of a tenant, optionally filtered by transport. */
  byTenant(tenantId: string, transport?: ConnectionTransport): ConnectionRecord[] {
    return this.resolve(this.byTenantId.get(tenantId), transport)
  }

  /** All connections of a given transport. */
  allByTransport(transport: ConnectionTransport): ConnectionRecord[] {
    return Array.from(this.byId.values()).filter((record) => record.transport === transport)
  }

  /** Total number of active connections. */
  count(): number {
    return this.byId.size
  }

  /** Number of distinct users currently connected. */
  countUsers(): number {
    return this.byUserId.size
  }

  private resolve(
    ids: Set<string> | undefined,
    transport: ConnectionTransport | undefined,
  ): ConnectionRecord[] {
    if (!ids) return []
    const out: ConnectionRecord[] = []
    for (const id of ids) {
      const record = this.byId.get(id)
      if (record && (transport === undefined || record.transport === transport)) {
        out.push(record)
      }
    }
    return out
  }

  private addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key)
    if (existing) existing.add(value)
    else map.set(key, new Set([value]))
  }

  private removeFromSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key)
    if (!existing) return
    existing.delete(value)
    if (existing.size === 0) map.delete(key)
  }
}
