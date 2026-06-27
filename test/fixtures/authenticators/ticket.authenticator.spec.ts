/**
 * @fileoverview Unit tests for the ticket-based (one-time ID) authenticator fixture.
 * @layer test-fixture
 */
import { randomUUID } from 'node:crypto'
import { TicketAuthenticator } from './ticket.authenticator'
import type { AuthenticationResult } from '../../../src/server/interfaces/connection-authenticator.interface'
import type { ConnectionAuthContext } from '../../../src/server/interfaces/connection-authenticator.interface'

const AUTH: AuthenticationResult = { userId: 'u1', tenantId: 't1', roles: ['user'] }

/** Context with a ticket in the query string. */
function mkCtx(ticket?: string): ConnectionAuthContext {
  return {
    cookies: {},
    headers: {},
    query: ticket !== undefined ? { ticket } : {},
    ip: '127.0.0.1',
    userAgent: 'jest',
    transport: 'sse',
  }
}

describe('TicketAuthenticator', () => {
  let auth: TicketAuthenticator

  beforeEach(() => {
    jest.useFakeTimers()
    auth = new TicketAuthenticator()
  })

  afterEach(() => {
    auth.clear()
    jest.useRealTimers()
  })

  // A valid ticket in the query string returns the issued auth result.
  it('returns the auth result for a valid ticket', async () => {
    const id = randomUUID()
    auth.issue(id, AUTH)
    const result = await auth.authenticate(mkCtx(id))
    expect(result).toEqual(AUTH)
  })

  // A ticket is consumed on first use — the second call returns null.
  it('consumes the ticket atomically (second call returns null)', async () => {
    const id = randomUUID()
    auth.issue(id, AUTH)
    await auth.authenticate(mkCtx(id))
    const second = await auth.authenticate(mkCtx(id))
    expect(second).toBeNull()
  })

  // Missing query parameter → null.
  it('returns null when the ticket query parameter is absent', async () => {
    const result = await auth.authenticate(mkCtx())
    expect(result).toBeNull()
  })

  // An unissued (unknown) ticket → null.
  it('returns null for an unknown ticket id', async () => {
    const result = await auth.authenticate(mkCtx(randomUUID()))
    expect(result).toBeNull()
  })

  // An expired ticket → null (TTL elapsed).
  it('returns null for an expired ticket', async () => {
    const id = randomUUID()
    auth.issue(id, AUTH, 1_000)
    jest.advanceTimersByTime(1_001)
    const result = await auth.authenticate(mkCtx(id))
    expect(result).toBeNull()
  })

  // Concurrent calls for the same ticket — only the first wins.
  it('ensures only one of two concurrent calls wins the ticket', async () => {
    const id = randomUUID()
    auth.issue(id, AUTH)
    const [r1, r2] = await Promise.all([auth.authenticate(mkCtx(id)), auth.authenticate(mkCtx(id))])
    const wins = [r1, r2].filter(Boolean)
    expect(wins).toHaveLength(1)
    expect(wins[0]).toEqual(AUTH)
  })

  // Empty query object (no key at all) → null.
  it('returns null when the query object is empty', async () => {
    const result = await auth.authenticate({ cookies: {}, headers: {}, query: {}, ip: '', userAgent: undefined, transport: 'sse' })
    expect(result).toBeNull()
  })
})
