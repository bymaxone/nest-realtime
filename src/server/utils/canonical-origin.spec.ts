/**
 * @fileoverview The spelling an entry of `websocket.allowedOrigins` may have.
 * @layer utils
 *
 * Constraint under test: an entry is accepted only in the form a browser sends in `Origin`, because the list is compared
 * byte for byte; a spelling no browser sends, or one a browser sends in another form, would match nothing.
 */
import { isCanonicalOrigin } from './canonical-origin'

describe('isCanonicalOrigin', () => {
  // Scenario: the forms a browser, a mobile shell or an extension sends. Expected: accepted as written.
  it.each([
    'https://app.example',
    'http://localhost:3000',
    'https://app.example:8443',
    'http://app.example:8080',
    'https://sub.app.example',
    'https://xn--bcher-kva.example',
    'http://[::1]:3000',
    'https://[2001:db8::1]',
    'capacitor://localhost',
    'ionic://localhost',
    'myapp://localhost',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'https://a-b.example',
    'https://a--b.example',
    'http://127.0.0.1:3000',
    'http://192.168.1.10',
    'http://10.0.0.255:8080',
    'https://app.example.1password',
    'https://a_b.example',
    'https://-a.example',
    'https://a-.example',
    'chrome-extension://AbCd',
    'myapp://Local_Host.',
    'myapp://-x-:8080',
  ])('accepts %s', (origin) => {
    expect(isCanonicalOrigin(origin)).toBe(true)
  })

  // Scenario: a spelling a browser never sends, or sends differently. Expected: refused, never corrected.
  it.each([
    ['a wildcard', '*'],
    ['a wildcard host', 'https://*.app.example'],
    ['the string null', 'null'],
    ['an empty string', ''],
    ['no scheme', 'app.example'],
    ['a trailing slash', 'https://app.example/'],
    ['a path', 'https://app.example/path'],
    ['a query', 'https://app.example?x=1'],
    ['a fragment', 'https://app.example#x'],
    ['userinfo', 'https://user@app.example'],
    ['an uppercase scheme', 'HTTPS://app.example'],
    ['an uppercase host', 'https://App.example'],
    ['a trailing dot', 'https://app.example.'],
    ['a default https port', 'https://app.example:443'],
    ['a default http port', 'http://app.example:80'],
    ['port 0', 'https://app.example:0'],
    ['a port above 65535', 'https://app.example:65536'],
    ['a leading-zero port', 'https://app.example:080'],
    ['an empty port', 'https://app.example:'],
    ['a space', 'https://app .example'],
    ['an empty host', 'https://'],
    ['a ws scheme', 'ws://app.example'],
    ['a wss scheme', 'wss://app.example'],
    ['an ftp scheme', 'ftp://app.example'],
    ['a trailing dot over http', 'http://app.example.'],
    ['an empty label', 'https://a..example'],
    ['a percent escape on another scheme', 'myapp://a%20b'],
    ['an IPv6 on another scheme', 'myapp://[::1]'],
    ['a path on another scheme', 'myapp://host/path'],
    ['a name ending in a hexadecimal label', 'http://a.0x1'],
    ['a non-ASCII host', 'https://bücher.example'],
    ['an unbracketed IPv6 host', 'http://::1'],
    ['a scheme starting with a digit', '1http://app.example'],
    ['a newline', 'https://app.example\n'],
    ['an IPv4 shorthand a browser expands', 'http://127.1'],
    ['an IPv4 in hexadecimal', 'http://0x7f.1'],
    ['an IPv4 with three parts', 'http://1.2.3'],
    ['an IPv4 with a leading zero', 'http://127.0.0.01'],
    ['an IPv4 part above 255', 'http://256.0.0.1'],
    ['a single decimal number host', 'http://2130706433'],
    ['an IPv6 a browser compresses', 'http://[0:0:0:0:0:0:0:1]'],
    ['an uppercase IPv6', 'http://[::A]'],
    ['brackets that are not an address', 'http://[abc]'],
  ])('refuses %s', (_name, origin) => {
    expect(isCanonicalOrigin(origin)).toBe(false)
  })

  // Scenario: an https default port is refused but the same number on another scheme is a real port. Expected: accepted.
  it('keeps 443 on a scheme that has no default and 80 on https', () => {
    expect(isCanonicalOrigin('myapp://localhost:443')).toBe(true)
    expect(isCanonicalOrigin('https://app.example:80')).toBe(true)
    expect(isCanonicalOrigin('http://app.example:443')).toBe(true)
  })

  // Scenario: the largest port and an origin at the length bound. Expected: 65535 accepted, 256 characters refused.
  it('bounds the port and the length', () => {
    expect(isCanonicalOrigin('https://app.example:65535')).toBe(true)
    const host = `${'a'.repeat(63)}.`.repeat(4)
    const origin = `https://${host}example`
    expect(origin.length).toBeGreaterThan(255)
    expect(isCanonicalOrigin(origin)).toBe(false)
  })

  // Scenario: an origin of exactly 255 characters. Expected: accepted, the bound being inclusive.
  it('accepts an origin of 255 characters', () => {
    const origin = `https://${'a'.repeat(247)}`
    expect(origin.length).toBe(255)
    expect(isCanonicalOrigin(origin)).toBe(true)
    expect(isCanonicalOrigin(`${origin}a`)).toBe(false)
  })

  // Scenario: not a string. Expected: refused.
  it.each([undefined, null, 7, {}, [], true])('refuses %p', (value) => {
    expect(isCanonicalOrigin(value)).toBe(false)
  })
})
