/**
 * @fileoverview Unit tests for the bearer-header authenticator fixture (WebSocket only).
 * @layer test-fixture
 */
import { BearerAuthenticator } from './bearer.authenticator'
import type { AuthenticationResult } from '../../../src/server/interfaces/connection-authenticator.interface'
import type { ConnectionAuthContext } from '../../../src/server/interfaces/connection-authenticator.interface'

const AUTH: AuthenticationResult = { userId: 'u1', tenantId: 't1', roles: ['user'] }

/** Build an auth context with optional Authorization header. */
function mkCtx(authorization?: string): ConnectionAuthContext {
  return {
    cookies: {},
    headers: authorization !== undefined ? { authorization } : {},
    query: {},
    ip: '127.0.0.1',
    userAgent: 'jest',
    transport: 'sse',
  }
}

describe('BearerAuthenticator', () => {
  let auth: BearerAuthenticator

  beforeEach(() => {
    auth = new BearerAuthenticator()
    auth.register('valid-token', AUTH)
  })

  // A properly formatted Bearer header with a known token returns the auth result.
  it('returns the auth result for a valid Bearer token', async () => {
    const result = await auth.authenticate(mkCtx('Bearer valid-token'))
    expect(result).toEqual(AUTH)
  })

  // Absent Authorization header → null.
  it('returns null when the Authorization header is absent', async () => {
    const result = await auth.authenticate(mkCtx())
    expect(result).toBeNull()
  })

  // Header without the "Bearer " prefix → null.
  it('returns null when the header lacks the "Bearer " prefix', async () => {
    const result = await auth.authenticate(mkCtx('Basic dXNlcjpwYXNz'))
    expect(result).toBeNull()
  })

  // "Bearer " with an empty token portion → null.
  it('returns null for "Bearer " with an empty token', async () => {
    const result = await auth.authenticate(mkCtx('Bearer '))
    expect(result).toBeNull()
  })

  // An unknown (unregistered) token → null.
  it('returns null for an unknown token', async () => {
    const result = await auth.authenticate(mkCtx('Bearer unknown-token'))
    expect(result).toBeNull()
  })

  // SSE context with authorization present: the SSE transport strips the header
  // before calling authenticate, so this tests the authenticator directly
  // (in real SSE flows the header is absent; this validates the parsing logic alone).
  it('returns the auth result when the header is present (non-SSE-stripped context)', async () => {
    // Direct invocation without the transport stripping the header.
    const result = await auth.authenticate(mkCtx('Bearer valid-token'))
    expect(result).toEqual(AUTH)
  })
})
