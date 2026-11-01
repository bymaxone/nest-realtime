/**
 * @fileoverview Unit tests for describeError, and the rule that every catch in src/ uses it.
 * @layer utils
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describeError } from './describe-error'

const SRC = join(__dirname, '..', '..')

describe('describeError', () => {
  it('returns the message of an Error', () => {
    // An Error is reported by its message, as the catch sites did before.
    expect(describeError(new Error('connect ECONNREFUSED'))).toBe('connect ECONNREFUSED')
  })

  it('returns the message of an Error subclass', () => {
    expect(describeError(new TypeError('bad input'))).toBe('bad input')
  })

  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'denied', 'denied'],
    ['a number', 42, '42'],
    ['a plain object', { code: 1 }, '[object Object]'],
  ])('returns String(reason) for %s', (_label, reason, expected) => {
    // A rejection need not be an Error; reading .message from it would throw inside the catch.
    expect(describeError(reason)).toBe(expected)
  })

  it('returns the message of an object that is not an Error but carries one', () => {
    // Hooks and storages reject with plain objects shaped like errors; their message is the useful part.
    expect(describeError({ message: 'queue unavailable' })).toBe('queue unavailable')
  })

  it('returns the message of an Error created in another realm', () => {
    // instanceof Error is false across realms (a worker, a vm context); the message is still there.
    expect(describeError(runInNewContext('new Error("boom")'))).toBe('boom')
  })

  it('ignores a message that is not a string', () => {
    expect(describeError({ message: 5 })).toBe('[object Object]')
  })

  it('does not throw for an object with no prototype', () => {
    // String(Object.create(null)) throws a TypeError, which must not escape a catch.
    expect(describeError(Object.create(null))).toBe('unprintable error')
  })

  it('does not throw when toString throws', () => {
    expect(
      describeError({
        toString: () => {
          throw new Error('toString exploded')
        },
      }),
    ).toBe('unprintable error')
  })

  it('does not throw when reading message throws', () => {
    const hostile = new Error('x')
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('message getter exploded')
      },
    })
    expect(describeError(hostile)).toBe('unprintable error')
  })
})

/** Every non-spec source file under src/, relative to src/. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('catch sites describe their reason through describeError', () => {
  // The rule as a test, so it does not depend on whoever edits a catch remembering it: a read of
  // .message from an unknown reason throws for null and undefined, and String() throws for an
  // object with no prototype, either inside the handler that was reporting the failure.
  const ALLOWED = new Set([
    join('server', 'utils', 'describe-error.ts'),
    // The React hooks run in the browser, outside the shared server runtime, and wrap the value.
    join('react', 'internal', 'use-realtime-ws.ts'),
  ])

  it.each(sourceFiles(SRC).map((path) => [relative(SRC, path), path]))(
    '%s reads no .message from an unknown reason',
    (relativePath, path) => {
      if (ALLOWED.has(relativePath)) return
      const source = readFileSync(path, 'utf8')
      expect(source).not.toMatch(/\bas Error\)\.message\b/)
      expect(source).not.toMatch(/instanceof Error \? [\w.]+\.message : String\(/)
    },
  )
})
