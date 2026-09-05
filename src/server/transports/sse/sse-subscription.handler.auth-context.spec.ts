/**
 * @fileoverview Unit tests for SseSubscriptionHandler — auth context and connection registration.
 * @layer transport
 *
 * Covers everything the handler derives from the HTTP request before the stream exists:
 * the client IP, header normalization, cookie and query parsing, the tenant resolver,
 * and the parameters handed to `registerConnection`.
 *
 * Shared builders live in `test/fixtures/sse/subscription-harness.ts` — the suite is
 * split by area and every part needs the same fakes.
 */
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common'
import {
  mkRecord,
  mkTransport,
  mkHeartbeat,
  mkOptions,
  mkReq,
  mkRes,
  build,
} from '../../../../test/fixtures/sse/subscription-harness'

describe('SseSubscriptionHandler — auth context and registration', () => {
  // A failed authentication throws 401 with the canonical error code.
  it('throws UnauthorizedException when authentication fails', async () => {
    const transport = mkTransport({ authenticate: jest.fn().mockResolvedValue(null) })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(UnauthorizedException)
  })

  // A blank identity is refused at bootstrap rather than registered: an empty userId
  // indexes every such connection under one key and joins them to the room `user:`,
  // and on a long-lived subscription that is a stream rather than one response.
  it('refuses a connection whose authenticator returns a blank userId', async () => {
    const transport = mkTransport({ authenticate: jest.fn().mockResolvedValue({ userId: '' }) })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )
    expect(transport.registerConnection).not.toHaveBeenCalled()
  })

  // Same for an empty tenant, which is a shared bucket rather than an absent one.
  it('refuses a connection whose authenticator returns a blank tenantId', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: '  ' }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )
    expect(transport.registerConnection).not.toHaveBeenCalled()
  })

  // The check runs on the RESOLVED auth: a resolver that returns a blank tenant is
  // what routes the connection, so it is the value that has to carry an identity.
  it('refuses a connection whose tenantResolver returns a blank tenantId', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 't-real' }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions({ tenantResolver: () => '' }))
    await expect(handler.handle(mkReq(), mkRes())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )
    expect(transport.registerConnection).not.toHaveBeenCalled()
  })

  // registerConnection is called with the correct parameters on subscribe.
  it('passes connection parameters to registerConnection', async () => {
    const transport = mkTransport()
    const req = mkReq({ ip: '1.2.3.4', headers: { 'user-agent': 'jest' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4', userAgent: 'jest' }),
    )
  })

  // The IP is resolved from X-Forwarded-For when present.
  it('resolves the IP from X-Forwarded-For', async () => {
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  // Without a forwarded header the request IP is used.
  it('falls back to req.ip when X-Forwarded-For is absent', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq({ ip: '9.9.9.9' }), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '9.9.9.9' }),
    )
  })

  // With neither source the IP resolves to 'unknown'.
  it('resolves IP to "unknown" when nothing is available', async () => {
    const transport = mkTransport()
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: 'unknown' }),
    )
  })

  // The authorization header is stripped from the SSE auth context.
  it('strips the authorization header from the SSE context', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { authorization: 'Bearer secret', 'x-keep': 'yes' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as {
      headers: Record<string, string | undefined>
    }
    expect(context.headers['authorization']).toBeUndefined()
    expect(context.headers['x-keep']).toBe('yes')
  })

  // Cookies are parsed and passed in the auth context.
  it('parses cookies into the auth context', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { cookie: 'token=abc' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { cookies: Record<string, string> }
    expect(context.cookies).toEqual({ token: 'abc' })
  })

  // Query parameters are flattened to strings (array values become undefined).
  it('sanitizes query parameters to flat strings', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ query: { ticket: 'abc', multi: ['a', 'b'] } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { query: Record<string, string | undefined> }
    expect(context.query['ticket']).toBe('abc')
    expect(context.query['multi']).toBeUndefined()
  })

  // The tenantResolver overrides the auth tenantId when provided.
  it('applies tenantResolver to override the auth tenantId', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 'from-auth' }),
      getConnection: jest.fn().mockReturnValue(mkRecord('c1', 'u1')),
    })
    const tenantResolver = jest.fn().mockReturnValue('from-resolver')
    const handler = build(transport, mkHeartbeat(), mkOptions({ tenantResolver }))
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(tenantResolver).toHaveBeenCalled()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ tenantId: 'from-resolver' }) }),
    )
  })

  // When tenantResolver returns undefined, the auth tenantId is preserved.
  it('preserves auth.tenantId when tenantResolver returns undefined', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1', tenantId: 'original' }),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions({ tenantResolver: () => undefined }))
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ tenantId: 'original' }) }),
    )
  })

  // When there is no tenantId in auth and no resolver, tenantId is absent.
  it('omits tenantId when auth has none and tenantResolver is absent', async () => {
    const transport = mkTransport({
      authenticate: jest.fn().mockResolvedValue({ userId: 'u1' }),
      getConnection: jest.fn().mockReturnValue(mkRecord('c1', 'u1')),
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(mkReq(), mkRes())
    stream.subscribe().unsubscribe()
    const call = (transport.registerConnection as jest.Mock).mock.calls[0]?.[0] as {
      auth: { tenantId?: string }
    }
    expect(call.auth.tenantId).toBeUndefined()
  })

  // Multi-valued headers are collapsed (array values yield undefined for single-value fields).
  it('ignores array-valued single headers (cookie, user-agent)', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate, emitConnectionEvent: false })
    const req = mkReq({
      headers: {
        cookie: ['a=1', 'b=2'],
        'user-agent': ['ua1', 'ua2'],
      },
    })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as {
      cookies: Record<string, string>
      userAgent: string | undefined
    }
    // Array cookie is ignored by singleHeader → parseCookieHeader receives ''
    expect(context.cookies).toEqual({})
    expect(context.userAgent).toBeUndefined()
  })

  it('trims whitespace from the X-Forwarded-For candidate before using it as the IP', async () => {
    // Without trim(), " 1.2.3.4 " leaks as-is into the connection ip.
    const transport = mkTransport()
    const req = mkReq({ headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    const stream = await handler.handle(req, mkRes())
    stream.subscribe().unsubscribe()
    expect(transport.registerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '1.2.3.4' }),
    )
  })

  it('joins array-valued headers with a comma separator in the auth context', async () => {
    // Kills StringLiteral mutation that changes join(',') to join('').
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const req = mkReq({ headers: { 'x-multi': ['part-a', 'part-b'] as unknown as string } })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(req, mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { headers: Record<string, string> }
    expect(context.headers['x-multi']).toBe('part-a,part-b')
  })

  it('sets transport to "sse" in the auth context passed to authenticate', async () => {
    // Kills StringLiteral mutation that blanks out the transport field.
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
    const transport = mkTransport({ authenticate })
    const handler = build(transport, mkHeartbeat(), mkOptions())
    await handler.handle(mkReq(), mkRes())
    const context = authenticate.mock.calls[0]?.[0] as { transport: string }
    expect(context.transport).toBe('sse')
  })

  // Kills L75 StringLiteral mutation ('' → "Stryker was here!").
  // When no cookie header is present singleHeader(undefined) returns undefined and
  // the ?? operator must fall back to '' — not the Stryker sentinel.
  // parseCookieHeader("Stryker was here!") and parseCookieHeader('') both yield {}
  // so the cookies field alone cannot distinguish them; we spy on the module export
  // to observe the exact argument the handler passes.
  it('calls parseCookieHeader with empty string when no cookie header is present', async () => {
    const cookieMod = require('../../utils/parse-cookie-header') as {
      parseCookieHeader: (cookieHeader: string) => Record<string, string>
    }
    const spy = jest.spyOn(cookieMod, 'parseCookieHeader')
    try {
      const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' })
      const transport = mkTransport({ authenticate, emitConnectionEvent: false })
      const req = mkReq({ headers: {} }) // no cookie header — singleHeader returns undefined
      const handler = build(transport, mkHeartbeat(), mkOptions())
      await handler.handle(req, mkRes())
      expect(spy).toHaveBeenCalledWith('')
    } finally {
      spy.mockRestore()
    }
  })
})
