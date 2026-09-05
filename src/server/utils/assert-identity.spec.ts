/**
 * @fileoverview Unit tests for tenant resolution and blank-identity rejection.
 * @layer utils
 */
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import type { AuthenticationResult } from '../interfaces/connection-authenticator.interface'
import { assertIdentityIsNotBlank, resolveAuthTenant } from './assert-identity'

/** Build an auth result the compiler would reject, as a consumer's JavaScript can. */
function untyped(value: unknown): AuthenticationResult {
  return value as AuthenticationResult
}

const BLANK_USER =
  `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned a userId that is not a ` +
  'non-empty string. A blank identity indexes every such connection under one key and joins ' +
  'them to the same room; return a real userId, or reject the connection by returning null.'

const BLANK_TENANT =
  `${REALTIME_ERROR_CODES.AUTH_FAILED}: the authenticator returned a tenantId that is present ` +
  'but not a non-empty string. Omit it, or return undefined or null, for a connection that ' +
  'belongs to no tenant — that is indexed under none and joins no tenant room, which an empty ' +
  'string is not.'

describe('assertIdentityIsNotBlank', () => {
  // The ordinary case, and what covers the `!== undefined` guard: a result with no
  // tenantId reads as undefined at runtime, so the tenant branch short-circuits.
  it('accepts a userId with an absent tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1' })).not.toThrow()
  })

  // Both traits present and real is the other ordinary case.
  it('accepts a userId with a real tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: 't1' })).not.toThrow()
  })

  // The whole message is pinned, not its first clause. The remedy is the half a
  // reader acts on, and a message that loses it still reads plausibly while
  // diagnosing nothing.
  it('rejects an empty userId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '' })).toThrow(BLANK_USER)
  })

  // Whitespace is the same defect in a different character: ' ' composes `user: `.
  it('rejects a whitespace-only userId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '   ' })).toThrow(BLANK_USER)
  })

  // A numeric id off a database row satisfies the call site's types and arrives as a
  // non-string. It must be refused by the contract, not by a TypeError naming `trim`,
  // which would report the wrong fault and refuse every connection.
  it('rejects a non-string userId without raising a TypeError', () => {
    expect(() => assertIdentityIsNotBlank(untyped({ userId: 123 }))).toThrow(BLANK_USER)
  })

  // An empty tenantId is a shared bucket rather than an absent tenant.
  it('rejects an empty tenantId', () => {
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: '' })).toThrow(BLANK_TENANT)
  })

  it('rejects a whitespace-only tenantId', () => {
    // Whitespace is blank: `' '` composes the room `tenant: ` and indexes under `' '`,
    // so it is the empty-string bucket wearing a different character.
    expect(() => assertIdentityIsNotBlank({ userId: 'u1', tenantId: '\t' })).toThrow(BLANK_TENANT)
  })

  // Reached when a caller skips resolveAuthTenant: that helper normalizes null to
  // absent, so a non-string arriving here is a broken contract rather than no tenant.
  it('rejects a non-string tenantId', () => {
    expect(() => assertIdentityIsNotBlank(untyped({ userId: 'u1', tenantId: 7 }))).toThrow(
      BLANK_TENANT,
    )
  })

  // The userId check runs first: a result blank in both traits names the userId,
  // which is the one with no valid absent form.
  it('names the userId when both traits are blank', () => {
    expect(() => assertIdentityIsNotBlank({ userId: '', tenantId: '' })).toThrow(BLANK_USER)
  })
})

describe('resolveAuthTenant', () => {
  // No resolver configured: the auth result's own tenant is what routes.
  it('falls back to the auth tenantId when no resolver is configured', () => {
    expect(resolveAuthTenant({}, { userId: 'u1', tenantId: 't1' })).toEqual({
      userId: 'u1',
      tenantId: 't1',
    })
  })

  // The resolver wins, which is the whole reason it exists.
  it('prefers the resolver result over the auth tenantId', () => {
    const out = resolveAuthTenant(
      { tenantResolver: () => 't-resolved' },
      { userId: 'u1', tenantId: 't1' },
    )
    expect(out.tenantId).toBe('t-resolved')
  })

  // A resolver returning undefined falls through rather than erasing the tenant.
  it('falls back when the resolver returns undefined', () => {
    const out = resolveAuthTenant(
      { tenantResolver: () => undefined },
      { userId: 'u1', tenantId: 't1' },
    )
    expect(out.tenantId).toBe('t1')
  })

  // The key normalization: null is absent, not a tenant. ConnectionRegistry guards on
  // `!== undefined`, so a null reaching it would index under null and compose the room
  // `tenant:null` — the shared-bucket defect in a value a JWT claim produces routinely.
  it('normalizes a null tenantId to absent', () => {
    const out = resolveAuthTenant({}, untyped({ userId: 'u1', tenantId: null }))
    expect('tenantId' in out).toBe(false)
  })

  // A resolver returning null falls back rather than erasing, because `??` treats it
  // as nullish exactly like undefined. The declared return type is `string | undefined`,
  // where undefined already means "no opinion, keep the auth tenant"; null is off
  // contract and gets the same reading rather than a second, contradictory one.
  it('falls back when the resolver returns null, as it does for undefined', () => {
    const out = resolveAuthTenant({ tenantResolver: () => null }, { userId: 'u1', tenantId: 't1' })
    expect(out.tenantId).toBe('t1')
  })

  // An absent tenant stays absent rather than becoming an explicit undefined key,
  // which `exactOptionalPropertyTypes` treats as a different shape.
  it('leaves an absent tenantId absent', () => {
    const out = resolveAuthTenant({}, { userId: 'u1' })
    expect('tenantId' in out).toBe(false)
  })

  // Other traits survive the rewrite: the helper resolves one field, not the object.
  it('preserves roles and metadata', () => {
    const out = resolveAuthTenant(
      {},
      { userId: 'u1', tenantId: 't1', roles: ['admin'], metadata: { traceId: 'x' } },
    )
    expect(out).toEqual({
      userId: 'u1',
      tenantId: 't1',
      roles: ['admin'],
      metadata: { traceId: 'x' },
    })
  })
})
