/**
 * @fileoverview Tests for realtimeError, the error every coded failure of this library is built with.
 * @layer utils
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REALTIME_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { realtimeError } from './realtime-error'

describe('realtimeError', () => {
  // Scenario: a failure with a raiser. Expected: the code is both a property and the lead of the
  // message, after the raiser in brackets. Why: callers branch on `code`, operators read the text,
  // and building both from one value is what keeps them from disagreeing.
  it('carries the code as a property and leads the message with it, after the raiser', () => {
    const error = realtimeError(REALTIME_ERROR_CODES.INVALID_OPTIONS, 'transport is wrong', {
      who: 'BymaxRealtimeModule',
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('REALTIME_INVALID_OPTIONS')
    expect(error.message).toBe('[BymaxRealtimeModule] REALTIME_INVALID_OPTIONS: transport is wrong')
  })

  // Scenario: a failure with no raiser. Expected: the message starts with the code. Why: some
  // failures come from a function with no class to name.
  it('leads the message with the code when there is no raiser', () => {
    const error = realtimeError(REALTIME_ERROR_CODES.AUTH_FAILED, 'blank userId')

    expect(error.code).toBe('REALTIME_AUTH_FAILED')
    expect(error.message).toBe('REALTIME_AUTH_FAILED: blank userId')
    expect('cause' in error).toBe(false)
  })

  // Scenario: a failure with a cause, including one that is not an Error. Expected: it is kept as
  // `cause`, whatever it is. Why: the original failure is what an operator needs next.
  it.each([
    ['an error', new Error('redis down')],
    ['a string', 'plain reason'],
    ['undefined', undefined],
  ])('keeps %s as the cause', (_label, cause) => {
    const error = realtimeError(REALTIME_ERROR_CODES.PUBSUB_UNAVAILABLE, 'could not publish', {
      cause,
    })

    expect(error.cause).toBe(cause)
    expect('cause' in error).toBe(true)
  })

  // Scenario: the code is an own, enumerable property like the `code` on a Node error. Expected: it
  // survives a spread and shows in the keys. Why: a log serializer that copies own properties keeps it.
  it('makes the code an own enumerable property', () => {
    const error = realtimeError(REALTIME_ERROR_CODES.TRANSPORT_UNAVAILABLE, 'detached')

    expect(Object.keys(error)).toContain('code')
    expect({ ...error }.code).toBe('REALTIME_TRANSPORT_UNAVAILABLE')
  })
})

// The rule, as a test: a message that leads with a REALTIME code must be built by realtimeError, so
// the code is a property too. A scan tells a new site apart from an old one where a review of the
// diff cannot, since the construction is a template literal spread over several lines.
describe('coded errors are built by realtimeError', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : []
    })

  it('finds no new Error whose message carries a REALTIME error code', () => {
    const offenders = sources(join(__dirname, '..', '..')).flatMap((path) => {
      const text = readFileSync(path, 'utf8')
      // From each `new Error(` to the end of its argument list, kept to the first closing paren at
      // depth zero so a later site in the same file is not blamed for this one.
      const hits: string[] = []
      for (const match of text.matchAll(/new Error\(/g)) {
        let depth = 1
        let end = (match.index ?? 0) + match[0].length
        while (depth > 0 && end < text.length) {
          if (text[end] === '(') depth++
          else if (text[end] === ')') depth--
          end++
        }
        const call = text.slice(match.index, end)
        // The one exception: Socket.IO's refusal of a connection, which carries its code as `data.code`
        // on the wire, where a client reads it.
        const wireRefusal = path.endsWith('realtime.gateway.ts')
        if (!wireRefusal && /REALTIME_ERROR_CODES\.|REALTIME_[A-Z_]+:/.test(call)) {
          hits.push(call.slice(0, 80))
        }
      }
      return hits.map((hit) => `${path.split('/src/')[1]}: ${hit.replace(/\s+/g, ' ')}`)
    })

    expect(offenders).toEqual([])
  })
})
