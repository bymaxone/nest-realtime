/**
 * @fileoverview Bidirectional room-membership registry with O(rooms) cleanup.
 * @layer infrastructure
 */
import { Injectable } from '@nestjs/common'

/**
 * Indexed registry of room membership.
 *
 * Maintains two maps — `rooms` (roomId → Set<connectionId>) and `connectionRooms`
 * (connectionId → Set<roomId>). The reverse index makes `leaveAll()` on disconnect
 * O(rooms-per-connection) instead of O(total rooms).
 */
@Injectable()
export class RoomRegistry {
  private readonly rooms = new Map<string, Set<string>>()
  private readonly connectionRooms = new Map<string, Set<string>>()

  /** Join a connection to a room (idempotent). */
  join(connectionId: string, roomId: string): void {
    const room = this.rooms.get(roomId) ?? new Set<string>()
    room.add(connectionId)
    this.rooms.set(roomId, room)

    const conn = this.connectionRooms.get(connectionId) ?? new Set<string>()
    conn.add(roomId)
    this.connectionRooms.set(connectionId, conn)
  }

  /** Remove a connection from a room (idempotent); prunes empty entries. */
  leave(connectionId: string, roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.delete(connectionId)
      if (room.size === 0) this.rooms.delete(roomId)
    }
    const conn = this.connectionRooms.get(connectionId)
    if (conn) {
      conn.delete(roomId)
      if (conn.size === 0) this.connectionRooms.delete(connectionId)
    }
  }

  /** Snapshot of a room's members — safe to iterate while membership mutates. */
  members(roomId: string): readonly string[] {
    const set = this.rooms.get(roomId)
    return set ? Array.from(set) : []
  }

  /** Snapshot of the rooms a connection currently belongs to. */
  roomsOf(connectionId: string): readonly string[] {
    const set = this.connectionRooms.get(connectionId)
    return set ? Array.from(set) : []
  }

  /** Remove a connection from every room (called on disconnect). */
  leaveAll(connectionId: string): void {
    const rooms = this.connectionRooms.get(connectionId)
    if (!rooms) return
    for (const roomId of rooms) {
      const set = this.rooms.get(roomId)
      if (set) {
        set.delete(connectionId)
        if (set.size === 0) this.rooms.delete(roomId)
      }
    }
    this.connectionRooms.delete(connectionId)
  }

  /** Total number of distinct rooms. */
  countRooms(): number {
    return this.rooms.size
  }
}
