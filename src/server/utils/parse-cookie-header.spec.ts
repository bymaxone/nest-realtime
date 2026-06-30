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
})
