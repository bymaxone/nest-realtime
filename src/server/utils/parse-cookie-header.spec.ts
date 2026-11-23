/**
 * @fileoverview Unit tests for the cookie header parser.
 * @layer utils
 */
import { parseCookieHeader } from './parse-cookie-header'

describe('parseCookieHeader', () => {
  // Empty input yields an empty object.
  it('returns {} for empty input', () => {
    expect(parseCookieHeader('')).toEqual({})
  })

  // Multiple cookies are split and trimmed.
  it('parses multiple cookies', () => {
    expect(parseCookieHeader('access_token=eyJ; theme=dark')).toEqual({
      access_token: 'eyJ',
      theme: 'dark',
    })
  })

  // A pair without an "=" is ignored.
  it('ignores a pair without "="', () => {
    expect(parseCookieHeader('flag; theme=dark')).toEqual({ theme: 'dark' })
  })

  // A pair with an empty name is ignored.
  it('ignores a cookie without a name', () => {
    expect(parseCookieHeader('=value')).toEqual({})
  })

  // Values containing "=" (e.g. base64) are preserved intact.
  it('preserves "=" inside a value', () => {
    expect(parseCookieHeader('t=YQ==')).toEqual({ t: 'YQ==' })
  })

  // Leading and trailing whitespace in a cookie value is trimmed.
  it('trims whitespace from cookie values', () => {
    expect(parseCookieHeader('key= trimmed ')).toEqual({ key: 'trimmed' })
  })

  // Whitespace-only value after trimming is stored as empty string.
  it('stores an empty string when the value is only whitespace', () => {
    expect(parseCookieHeader('key=   ')).toEqual({ key: '' })
  })

  // Kills L22 ConditionalExpression mutation (condition → false).
  // The guard `if (!cookieHeader) return out` handles undefined inputs that callers may
  // pass despite the string signature (e.g. missing header coerced through ?? '').
  // With the mutation the guard never runs so undefined.split(';') throws a TypeError.
  // Note: '' is NOT a distinguishing input — the normal split path also yields {} for ''.
  it('returns {} for undefined without throwing (guard-only path)', () => {
    expect(parseCookieHeader(undefined as unknown as string)).toEqual({})
  })
})

describe('parseCookieHeader, with a symbol-keyed method planted on String.prototype', () => {
  // Scenario: `split` with a string separator asks the separator for `Symbol.split`, and a string primitive answers from
  // `String.prototype`. A function planted there decides what the header is split into: here, a session cookie that was
  // never sent. Expected: the header is refused, not parsed, so no forged cookie reaches authentication.
  it('refuses to parse while Symbol.split is planted', () => {
    Object.defineProperty(String.prototype, Symbol.split, {
      value: () => ['session=FORGED'],
      configurable: true,
      writable: true,
    })
    let parsed: unknown
    let code: unknown
    try {
      parsed = parseCookieHeader('theme=dark')
    } catch (error) {
      code = (error as { code?: unknown }).code
    } finally {
      Reflect.deleteProperty(String.prototype, Symbol.split)
    }

    expect([parsed, code]).toStrictEqual([undefined, 'REALTIME_TRANSPORT_UNAVAILABLE'])
  })
})
