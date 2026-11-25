/**
 * @fileoverview The `websocket.allowedOrigins` and `websocket.websocketOnly` options are checked at boot and copied once.
 * @layer composition
 *
 * Constraint under test: an entry that is not an origin as a browser sends it, an empty or oversized list, and a list set
 * beside a `cors.origin` are each refused with `REALTIME_INVALID_OPTIONS` naming the option; a list is copied, so a
 * change to the caller's array after boot decides nothing.
 */
import { dropUnset } from './drop-unset'
import { validateOptions } from './validate-options'

const authenticator = { authenticate: async () => null }

/** Options for the websocket transport with `websocket` as the host wrote it. */
const withWebsocket = (websocket: unknown): never =>
  ({ transport: 'websocket', authenticator, websocket }) as never

const LISTED = 'https://app.example'

describe('websocket.allowedOrigins', () => {
  // Scenario: a list of valid origins, with or without websocketOnly. Expected: accepted.
  it('accepts a list of origins in the browser spelling', () => {
    expect(() =>
      validateOptions(withWebsocket({ allowedOrigins: [LISTED, 'capacitor://localhost'] })),
    ).not.toThrow()
    expect(() =>
      validateOptions(withWebsocket({ allowedOrigins: [LISTED], websocketOnly: true })),
    ).not.toThrow()
  })

  // Scenario: an entry that is not that spelling. Expected: refused, naming the option and the index.
  it.each(['*', 'null', `${LISTED}/`, 'https://App.example', 'https://app.example:443', 7, null])(
    'refuses the entry %p',
    (entry) => {
      expect(() => validateOptions(withWebsocket({ allowedOrigins: [LISTED, entry] }))).toThrow(
        /REALTIME_INVALID_OPTIONS: options\.websocket\.allowedOrigins\[1\] must be an origin as a browser sends it/,
      )
    },
  )

  // Scenario: not a list, an empty list, a list over the bound. Expected: refused naming the option.
  it.each([
    ['a string', LISTED],
    ['an object', { 0: LISTED, length: 1 }],
    ['an empty list', []],
    ['a list of 1001 entries', Array.from({ length: 1001 }, (_, n) => `https://a${n}.example`)],
  ])('refuses %s', (_name, value) => {
    expect(() => validateOptions(withWebsocket({ allowedOrigins: value }))).toThrow(
      /options\.websocket\.allowedOrigins must be a list of 1 to 1000 origins/,
    )
  })

  it('accepts a list of exactly 1000 entries', () => {
    const list = Array.from({ length: 1000 }, (_, n) => `https://a${n}.example`)
    expect(() => validateOptions(withWebsocket({ allowedOrigins: list }))).not.toThrow()
  })

  // Scenario: a cors block that could answer an origin beside the list. Expected: refused. A block with origin false,
  // which is what the gateway's own decorator carries, or with no origin key, is not in conflict.
  it.each([
    ['a string', { origin: '*' }],
    ['true', { origin: true }],
    ['a list', { origin: [LISTED] }],
    ['a function', { origin: () => true }],
  ])('refuses a cors origin that is %s', (_name, cors) => {
    expect(() => validateOptions(withWebsocket({ allowedOrigins: [LISTED], cors }))).toThrow(
      /allowedOrigins cannot be set together with options\.websocket\.cors\.origin/,
    )
  })

  it.each([
    ['origin false', { origin: false }],
    ['no origin', { methods: ['GET'] }],
  ])('accepts a cors block with %s', (_name, cors) => {
    expect(() => validateOptions(withWebsocket({ allowedOrigins: [LISTED], cors }))).not.toThrow()
  })

  // Scenario: the caller changes the array after the options were read. Expected: the copy is unchanged and frozen.
  it('copies the list once', () => {
    const list = [LISTED]
    const kept = dropUnset({ websocket: { allowedOrigins: list } } as never) as {
      websocket: { allowedOrigins: readonly string[] }
    }
    list.push('https://evil.example')
    list[0] = 'https://evil.example'
    expect(kept.websocket.allowedOrigins).toStrictEqual([LISTED])
    expect(Object.isFrozen(kept.websocket.allowedOrigins)).toBe(true)
  })

  // Scenario: a list whose length is not an honest integer. Expected: refused instead of read.
  it('refuses a list whose length cannot be read as a count', () => {
    const list = new Proxy([LISTED], {
      get: (target, key, receiver) => (key === 'length' ? 1.5 : Reflect.get(target, key, receiver)),
    })
    expect(() => dropUnset({ websocket: { allowedOrigins: list } } as never)).toThrow(
      /options\.websocket\.allowedOrigins must be a list of 1 to 1000 origins/,
    )
  })
})

describe('websocket.websocketOnly', () => {
  it.each([true, false])('accepts %p', (value) => {
    expect(() => validateOptions(withWebsocket({ websocketOnly: value }))).not.toThrow()
  })

  it.each(['yes', 1, {}])('refuses %p', (value) => {
    expect(() => validateOptions(withWebsocket({ websocketOnly: value }))).toThrow(
      /options\.websocket\.websocketOnly must be a boolean/,
    )
  })
})

describe('a policy option the host set to nothing', () => {
  // Scenario: `allowedOrigins: env?.split(',')` with the variable unset. Expected: refused, not read as no policy.
  it.each([
    ['allowedOrigins', undefined],
    ['allowedOrigins', null],
    ['websocketOnly', null],
  ])('refuses %s: %p', (key, value) => {
    expect(() => validateOptions(withWebsocket({ [key]: value }))).toThrow(
      new RegExp(`REALTIME_INVALID_OPTIONS: options\\.websocket\\.${key} must be`),
    )
  })

  // Scenario: a config class whose getter reads a value that was never set. Expected: refused like the own key, since
  // reading it as unset would serve every origin.
  it.each([
    ['allowedOrigins', undefined],
    ['allowedOrigins', null],
    ['websocketOnly', null],
  ])('refuses a class getter %s that returns %p', (name, value) => {
    class Websocket {}
    Object.defineProperty(Websocket.prototype, name, { get: () => value })
    expect(() => validateOptions(dropUnset(withWebsocket(new Websocket())))).toThrow(
      new RegExp(`options\\.websocket\\.${name} `),
    )
  })

  // Scenario: a class that has neither option. Expected: accepted, the options are unset.
  it('accepts a class that holds neither option', () => {
    class Websocket {
      readonly namespace = '/rt'
    }
    expect(() => validateOptions(dropUnset(withWebsocket(new Websocket())))).not.toThrow()
  })

  it('reads websocketOnly: undefined as unset', () => {
    expect(() => validateOptions(withWebsocket({ websocketOnly: undefined }))).not.toThrow()
  })
})
