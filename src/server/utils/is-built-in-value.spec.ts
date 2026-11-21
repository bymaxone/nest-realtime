/**
 * @fileoverview The built-in kinds that hold no options by their keys are recognised in any realm and without reading the value.
 * @layer utils
 */
import vm from 'node:vm'
import { isBuiltInValue } from './is-built-in-value'

describe('isBuiltInValue', () => {
  // Scenario: each built-in kind, of this realm and another. Expected: recognised.
  it.each([
    ['an array', () => []],
    ['a Map', () => new Map()],
    ['a Set', () => new Set()],
    ['a WeakMap', () => new WeakMap()],
    ['a WeakSet', () => new WeakSet()],
    ['a Date', () => new Date()],
    ['a RegExp', () => /x/],
    ['a Promise', () => Promise.resolve()],
    ['a Map from another realm', () => vm.runInNewContext('new Map()') as unknown],
  ])('recognises %s', (_name, build) => {
    expect(isBuiltInValue(build())).toBe(true)
  })

  // Scenario: values a host builds to hold options, including one that only reports a built-in tag, and primitives.
  // Expected: not recognised, and no property is read.
  it.each([
    ['a literal', () => ({})],
    ['a null-prototype object', () => Object.create(null) as unknown],
    ['an object tagged as a Map', () => ({ [Symbol.toStringTag]: 'Map' })],
    ['a string', () => 'x'],
    ['null', () => null],
  ])('does not recognise %s', (_name, build) => {
    expect(isBuiltInValue(build())).toBe(false)
  })

  it('reads no property of a proxy', () => {
    const reads = jest.fn()
    const proxy = new Proxy({}, { get: reads, has: reads, ownKeys: reads })

    expect(isBuiltInValue(proxy)).toBe(false)
    expect(reads).not.toHaveBeenCalled()
  })
})
