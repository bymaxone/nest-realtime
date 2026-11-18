/**
 * @fileoverview What `isPlainObject` accepts as an object a host built to hold options, one row for each kind of value.
 * @layer utils
 */
import { isPlainObject } from './is-plain-object'

/** A callable that claims to be a plain object through its tag. */
const taggedFunction = Object.assign(() => undefined, { [Symbol.toStringTag]: 'Object' })

class HostOptions {
  readonly heartbeatMs = 10_000
}

describe('isPlainObject', () => {
  // Scenario: a value that is not an object a host built. Expected: refused, whichever way it is built, because
  // reading its keys for an option finds none and the value would be accepted for nothing.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'x'],
    ['a boolean', true],
    ['a symbol', Symbol('x')],
    ['a bigint', 10n],
    ['a function', () => undefined],
    ['a function that tags itself as an object', taggedFunction],
    ['an array', []],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a RegExp', /x/],
    ['a Promise', Promise.resolve()],
    [
      'a proxy whose reads throw',
      new Proxy(
        {},
        {
          get: () => {
            throw new Error('host')
          },
        },
      ),
    ],
  ])('refuses %s', (_kind, value) => {
    expect(isPlainObject(value)).toBe(false)
  })

  // Scenario: the shapes a host writes. Expected: accepted, an instance of its own class included.
  it.each([
    ['a literal', {}],
    ['a null-prototype object', Object.create(null)],
    ['an instance of a host class', new HostOptions()],
  ])('accepts %s', (_kind, value) => {
    expect(isPlainObject(value)).toBe(true)
  })
})
