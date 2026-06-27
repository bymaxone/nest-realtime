/**
 * @fileoverview Unit tests for the cookie-based JWT authenticator fixture.
 * @layer test-fixture
 */
import { sign } from 'jsonwebtoken'
import { CookieJwtAuthenticator } from './cookie-jwt.authenticator'
import type { ConnectionAuthContext } from '../../../src/server/interfaces/connection-authenticator.interface'

const SECRET = 'test-secret'

/** Minimal auth context for cookie-based SSE. */
function mkCtx(overrides: Partial<ConnectionAuthContext> = {}): ConnectionAuthContext {
  return {
    cookies: {},
    headers: {},
    query: {},
    ip: '127.0.0.1',
    userAgent: 'jest',
    transport: 'sse',
    ...overrides,
  }
}

describe('CookieJwtAuthenticator', () => {
  let auth: CookieJwtAuthenticator

  beforeEach(() => {
    auth = new CookieJwtAuthenticator(SECRET)
  })

  // A valid JWT in the default cookie returns userId, tenantId, and roles.
  it('returns auth result for a valid JWT cookie', async () => {
    const token = sign({ sub: 'u1', tid: 't1', roles: ['admin'] }, SECRET, { expiresIn: '1h' })
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result).toEqual({ userId: 'u1', tenantId: 't1', roles: ['admin'] })
  })

  // Absent cookie → null (unauthenticated).
  it('returns null when the cookie is missing', async () => {
    const result = await auth.authenticate(mkCtx({ cookies: {} }))
    expect(result).toBeNull()
  })

  // An expired token → null (jsonwebtoken throws TokenExpiredError).
  it('returns null for an expired JWT', async () => {
    const token = sign({ sub: 'u1' }, SECRET, { expiresIn: -1 })
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result).toBeNull()
  })

  // A JWT signed with a different secret → null.
  it('returns null for a JWT with a wrong secret', async () => {
    const token = sign({ sub: 'u1' }, 'wrong-secret')
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result).toBeNull()
  })

  // A completely malformed token string → null (silent catch).
  it('returns null for a malformed (non-JWT) cookie value', async () => {
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: 'not.a.jwt' } }))
    expect(result).toBeNull()
  })

  // A custom cookie name is respected.
  it('reads from a custom cookie name when specified', async () => {
    const token = sign({ sub: 'u2', roles: ['user'] }, SECRET, { expiresIn: '1h' })
    const custom = new CookieJwtAuthenticator(SECRET, 'session')
    const result = await custom.authenticate(mkCtx({ cookies: { session: token } }))
    expect(result?.userId).toBe('u2')
    expect(result?.roles).toEqual(['user'])
  })

  // Roles extracted from the payload are returned correctly.
  it('extracts roles from the JWT payload', async () => {
    const token = sign({ sub: 'u3', roles: ['editor', 'viewer'] }, SECRET, { expiresIn: '1h' })
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result?.roles).toEqual(['editor', 'viewer'])
  })

  // A token without optional claims returns undefined for those fields.
  it('returns undefined tenantId and roles when absent from the payload', async () => {
    const token = sign({ sub: 'u4' }, SECRET, { expiresIn: '1h' })
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result?.userId).toBe('u4')
    expect(result?.tenantId).toBeUndefined()
    expect(result?.roles).toBeUndefined()
  })

  // A JWT signed with a non-HS256 algorithm is rejected even with the correct secret.
  it('rejects a JWT signed with a non-HS256 algorithm', async () => {
    const token = sign({ sub: 'u5' }, SECRET, { algorithm: 'HS512' })
    const result = await auth.authenticate(mkCtx({ cookies: { access_token: token } }))
    expect(result).toBeNull()
  })
})
