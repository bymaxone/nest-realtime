/**
 * @fileoverview Unit tests for the bidirectional room registry.
 * @layer infrastructure
 */
import { RoomRegistry } from './room-registry.service'

describe('RoomRegistry', () => {
  let rooms: RoomRegistry

  beforeEach(() => {
    rooms = new RoomRegistry()
  })

  // Joining creates the room and records the reverse membership.
  it('creates a room on first join', () => {
    rooms.join('c1', 'room:a')
    expect(rooms.members('room:a')).toEqual(['c1'])
    expect(rooms.roomsOf('c1')).toEqual(['room:a'])
    expect(rooms.countRooms()).toBe(1)
  })

  // Joining is idempotent — the same member is not duplicated.
  it('is idempotent on repeated joins', () => {
    rooms.join('c1', 'room:a')
    rooms.join('c1', 'room:a')
    expect(rooms.members('room:a')).toEqual(['c1'])
  })

  // Leaving removes the member and prunes the room once empty.
  it('removes a member and prunes the empty room', () => {
    rooms.join('c1', 'room:a')
    rooms.leave('c1', 'room:a')
    expect(rooms.members('room:a')).toEqual([])
    expect(rooms.roomsOf('c1')).toEqual([])
    expect(rooms.countRooms()).toBe(0)
  })

  // Leaving keeps the room when other members remain.
  it('keeps a room with remaining members', () => {
    rooms.join('c1', 'room:a')
    rooms.join('c2', 'room:a')
    rooms.leave('c1', 'room:a')
    expect(rooms.members('room:a')).toEqual(['c2'])
    expect(rooms.countRooms()).toBe(1)
  })

  // Leaving an unknown connection/room is a safe no-op.
  it('is a no-op when leaving an unknown room', () => {
    expect(() => rooms.leave('ghost', 'room:none')).not.toThrow()
  })

  // members returns a snapshot decoupled from internal state.
  it('returns a defensive snapshot from members', () => {
    rooms.join('c1', 'room:a')
    const snapshot = rooms.members('room:a') as string[]
    snapshot.push('mutation')
    expect(rooms.members('room:a')).toEqual(['c1'])
  })

  // Unknown rooms/connections return empty arrays.
  it('returns empty arrays for unknown lookups', () => {
    expect(rooms.members('nope')).toEqual([])
    expect(rooms.roomsOf('nope')).toEqual([])
  })

  // leaveAll removes a connection from every room it belongs to.
  it('removes a connection from all rooms', () => {
    rooms.join('c1', 'room:a')
    rooms.join('c1', 'room:b')
    rooms.join('c1', 'room:c')
    rooms.join('c2', 'room:a')
    rooms.leaveAll('c1')
    expect(rooms.roomsOf('c1')).toEqual([])
    expect(rooms.members('room:a')).toEqual(['c2'])
    expect(rooms.members('room:b')).toEqual([])
    expect(rooms.countRooms()).toBe(1)
  })

  // leaveAll on an unknown connection is a safe no-op.
  it('is a no-op when leaveAll targets an unknown connection', () => {
    expect(() => rooms.leaveAll('ghost')).not.toThrow()
  })
})
