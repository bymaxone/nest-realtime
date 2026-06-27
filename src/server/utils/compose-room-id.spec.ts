/**
 * @fileoverview Unit tests for the canonical room-id builder.
 * @layer utils
 */
import { composeRoomId } from './compose-room-id'

describe('composeRoomId', () => {
  // The USER prefix produces a single-part user room id.
  it('builds a user room id', () => {
    expect(composeRoomId('USER', 'u_abc')).toBe('user:u_abc')
  })

  // The TENANT prefix produces a single-part tenant room id.
  it('builds a tenant room id', () => {
    expect(composeRoomId('TENANT', 't_acme')).toBe('tenant:t_acme')
  })

  // The RESOURCE prefix supports multiple parts joined with a colon.
  it('builds a multi-part resource room id', () => {
    expect(composeRoomId('RESOURCE', 'invoice', 'inv_123')).toBe('resource:invoice:inv_123')
  })

  // Validation of parts is the caller's responsibility — an empty part is kept.
  it('does not validate empty parts', () => {
    expect(composeRoomId('USER', '')).toBe('user:')
  })
})
